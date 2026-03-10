import { eq, and, lte, gte, sql } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import { TokenVault } from "@babji/crypto";
import { GoogleCalendarHandler } from "@babji/skills";
import type { LlmClient } from "@babji/agent";
import { Brain, PromptBuilder, ToolExecutor } from "@babji/agent";
import { MemoryManager } from "@babji/memory";
import type { SkillDefinition } from "@babji/types";
import type { ChannelAdapter } from "./adapters/types.js";
import { ensureValidToken } from "./token-refresh.js";
import { logger } from "./logger.js";
import { AdminNotifier } from "./admin-notifier.js";
import { MeetingBriefingService } from "./meeting-briefing.js";
import type { UsageTracker } from "./usage-tracker.js";

/** Converts a local time string like "07:30" + IANA timezone to the next UTC timestamp for that local time */
function nextUtcForLocalTime(localTime: string, timezone: string): Date {
  const [hours, minutes] = localTime.split(":").map(Number);

  // Get "today" in the tenant's timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";

  const localYear = Number(get("year"));
  const localMonth = Number(get("month"));
  const localDay = Number(get("day"));
  const localHour = Number(get("hour"));
  const localMinute = Number(get("minute"));

  // Build target date in the tenant's timezone for today
  // If the target time has already passed today, schedule for tomorrow
  let targetDay = localDay;
  if (localHour > hours || (localHour === hours && localMinute >= minutes)) {
    targetDay += 1;
  }

  // Create a date string in the target timezone and convert to UTC
  // Use a temporary date to find the UTC offset
  const targetLocal = new Date(localYear, localMonth - 1, targetDay, hours, minutes, 0);

  // Calculate UTC offset by comparing local time representation
  const utcStr = targetLocal.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = targetLocal.toLocaleString("en-US", { timeZone: timezone });
  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  const offsetMs = utcDate.getTime() - tzDate.getTime();

  return new Date(targetLocal.getTime() + offsetMs);
}

/** Format calendar events into a plain text summary */
function formatEventsSummary(events: Array<Record<string, unknown>>, timezone: string): string {
  if (events.length === 0) {
    return "No events on your calendar today. Enjoy a free day!";
  }

  const lines = [`You have ${events.length} event${events.length > 1 ? "s" : ""} today:\n`];

  for (const event of events) {
    const start = event.start as string;
    const summary = event.summary as string || "(No title)";

    let timeStr = "";
    if (start) {
      // If it's a date-time (not all-day), format the time
      if (start.includes("T")) {
        const d = new Date(start);
        timeStr = d.toLocaleString("en-US", {
          timeZone: timezone,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
      } else {
        timeStr = "All day";
      }
    }

    let line = `- ${timeStr}: ${summary}`;
    if (event.location) {
      line += ` (${event.location})`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

export interface JobRunnerDeps {
  db: Database;
  vault: TokenVault;
  adapters: ChannelAdapter[];
  googleApiKey: string;
  llm: LlmClient;
  memory: MemoryManager;
  availableSkills: SkillDefinition[];
  peopleConfig?: {
    scrapinApiKey: string;
    dataforseoLogin: string;
    dataforseoPassword: string;
  };
  adminNotifier?: AdminNotifier;
  usageTracker?: UsageTracker;
}

export class JobRunner {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: JobRunnerDeps) {}

  start(): void {
    // Tick every 30 seconds
    this.intervalHandle = setInterval(() => this.tick(), 30_000);
    // Also run immediately on start
    this.tick();
    logger.info("JobRunner started (30s interval)");
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    logger.info("JobRunner stopped");
  }

  private async tick(): Promise<void> {
    try {
      // Find jobs that are due
      const now = new Date();
      const dueJobs = await this.deps.db.query.scheduledJobs.findMany({
        where: and(
          eq(schema.scheduledJobs.status, "active"),
          lte(schema.scheduledJobs.scheduledAt, now),
        ),
        limit: 10,
      });

      if (dueJobs.length === 0) return;

      logger.info({ count: dueJobs.length }, "Processing due jobs");

      for (const job of dueJobs) {
        try {
          await this.executeJob(job);
        } catch (err) {
          logger.error({ err, jobId: job.id, jobType: job.jobType }, "Job execution failed");
          await this.deps.db.update(schema.scheduledJobs)
            .set({ status: "failed", lastRunAt: now })
            .where(eq(schema.scheduledJobs.id, job.id));
        }
      }
    } catch (err) {
      logger.error({ err }, "JobRunner tick failed");
    }
  }

  private async executeJob(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    switch (job.jobType) {
      case "daily_calendar_summary":
        await this.runCalendarSummary(job);
        break;
      case "reminder":
        await this.runReminder(job);
        break;
      case "todo_reminder":
        await this.runTodoReminder(job);
        break;
      case "deep_research":
        await this.runDeepResearch(job);
        break;
      case "meeting_briefing":
        await this.runMeetingBriefing(job);
        break;
      case "profile_scan":
        await this.runProfileScan(job);
        break;
      case "daily_usage_report":
        await this.runDailyUsageReport(job);
        break;
      default:
        logger.warn({ jobType: job.jobType }, "Unknown job type, skipping");
        return;
    }
  }

  private async runCalendarSummary(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const tenantId = job.tenantId;

    // Look up tenant for timezone and channel info
    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) {
      logger.warn({ tenantId }, "Tenant not found for calendar summary job");
      return;
    }

    const timezone = tenant.timezone || "UTC";

    // Get google_calendar token (auto-refreshes if expired)
    const tokenResult = await ensureValidToken(tenantId, "google_calendar", this.deps.vault, this.deps.db);

    if (!tokenResult || tokenResult.status === "expired") {
      logger.warn({ tenantId, status: tokenResult?.status }, "Calendar token expired for daily summary, skipping");
      // Still reschedule for tomorrow
      await this.rescheduleDaily(job, timezone);
      return;
    }

    const accessToken = tokenResult.accessToken;

    // Calculate today's date range in tenant's timezone
    const now = new Date();
    const startOfDay = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    // Convert back to UTC for the API
    // Use Intl to get the current date in the tenant's timezone
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dateStr = formatter.format(now); // e.g. "2026-03-09"

    const timeMin = `${dateStr}T00:00:00`;
    const timeMax = `${dateStr}T23:59:59`;

    // Convert to ISO with timezone offset
    const timeMinISO = new Date(`${timeMin}+00:00`).toISOString();
    const timeMaxISO = new Date(`${timeMax}+00:00`).toISOString();

    try {
      const calHandler = new GoogleCalendarHandler(accessToken);
      const result = await calHandler.execute("list_events", {
        time_min: timeMinISO,
        time_max: timeMaxISO,
        max_results: 20,
      }) as { events: Array<Record<string, unknown>>; count: number };

      const summary = formatEventsSummary(result.events, timezone);
      const greeting = this.getGreeting(timezone);
      const messageText = `${greeting}, ${tenant.name}!\n\nHere's your day:\n\n${summary}`;

      // Determine recipient channel
      const recipient = tenant.telegramUserId || tenant.phone;
      const channel = tenant.telegramUserId ? "telegram" : "whatsapp";

      if (!recipient) {
        logger.warn({ tenantId }, "No recipient channel for calendar summary");
        await this.rescheduleDaily(job, timezone);
        return;
      }

      // Find the right adapter
      const adapter = this.deps.adapters.find((a) => a.name === channel);
      if (!adapter) {
        logger.warn({ tenantId, channel }, "No adapter found for calendar summary");
        await this.rescheduleDaily(job, timezone);
        return;
      }

      await adapter.sendMessage({
        tenantId,
        channel: channel as "telegram" | "whatsapp" | "app",
        recipient,
        text: messageText,
      });

      logger.info({ tenantId, events: result.count }, "Sent daily calendar summary");

      // Log background job usage
      if (this.deps.usageTracker) {
        this.deps.usageTracker.logBackgroundJob({ tenantId, jobType: "daily_calendar_summary" }).catch(() => {});
      }

      // ── Meeting briefing integration ──
      if (this.deps.peopleConfig) {
        const briefingService = new MeetingBriefingService({
          db: this.deps.db,
          vault: this.deps.vault,
          llm: this.deps.llm,
          memory: this.deps.memory,
          availableSkills: this.deps.availableSkills,
          peopleConfig: this.deps.peopleConfig,
        });

        // Infer and store email domain if not yet known
        let tenantDomain = tenant.emailDomain as string | null;
        if (!tenantDomain) {
          tenantDomain = briefingService.inferDomainFromEvents(result.events);
          if (tenantDomain) {
            await this.deps.db.update(schema.tenants)
              .set({ emailDomain: tenantDomain })
              .where(eq(schema.tenants.id, tenantId));
            logger.info({ tenantId, emailDomain: tenantDomain }, "Inferred and stored tenant email domain");
          }
        }

        if (tenantDomain) {
          const meetings = briefingService.extractExternalAttendees(result.events, tenantDomain);

          if (meetings.length > 0) {
            const pref = tenant.meetingBriefingPref as string | null;
            const totalExternals = meetings.reduce((sum, m) => sum + m.attendees.length, 0);

            if (pref === "morning") {
              try {
                const briefing = await briefingService.generateBriefing(meetings, tenantId, tenant.name, timezone);
                await adapter.sendMessage({
                  tenantId,
                  channel: channel as "telegram" | "whatsapp" | "app",
                  recipient: recipient!,
                  text: briefing,
                });
                logger.info({ tenantId, meetings: meetings.length, attendees: totalExternals }, "Sent morning meeting briefing");
              } catch (err) {
                logger.error({ err, tenantId }, "Failed to generate/send morning briefing");
              }
            } else if (pref === "pre_meeting") {
              for (const meeting of meetings) {
                if (!meeting.startTime || !meeting.startTime.includes("T")) continue;
                const meetingTime = new Date(meeting.startTime);
                const briefingTime = new Date(meetingTime.getTime() - 60 * 60 * 1000);
                if (briefingTime <= new Date()) continue;

                await this.deps.db.insert(schema.scheduledJobs).values({
                  tenantId,
                  jobType: "meeting_briefing",
                  scheduleType: "once",
                  scheduledAt: briefingTime,
                  payload: {
                    eventId: meeting.eventId,
                    eventSummary: meeting.summary,
                    startTime: meeting.startTime,
                    attendees: meeting.attendees,
                    tenantDomain,
                  },
                });
                logger.info({ tenantId, meeting: meeting.summary, briefingAt: briefingTime.toISOString() }, "Scheduled pre-meeting briefing");
              }
            } else {
              // Not enabled — suggest organically
              const suggestionText = `\nYou have ${totalExternals} external attendee${totalExternals > 1 ? "s" : ""} across today's meetings. Want me to research them and send you a briefing before your meetings?`;
              await adapter.sendMessage({
                tenantId,
                channel: channel as "telegram" | "whatsapp" | "app",
                recipient: recipient!,
                text: suggestionText,
              });
              logger.info({ tenantId, externals: totalExternals }, "Suggested meeting briefings to tenant");
            }
          }
        }

        // Schedule evening profile scan for tomorrow's meetings
        try {
          const existingScan = await this.deps.db.query.scheduledJobs.findFirst({
            where: and(
              eq(schema.scheduledJobs.tenantId, tenantId),
              eq(schema.scheduledJobs.jobType, "profile_scan"),
              eq(schema.scheduledJobs.status, "active"),
            ),
          });

          if (!existingScan) {
            const scanTime = nextUtcForLocalTime("18:00", timezone);
            await this.deps.db.insert(schema.scheduledJobs).values({
              tenantId,
              jobType: "profile_scan",
              scheduleType: "once",
              scheduledAt: scanTime,
              payload: { tenantDomain: tenantDomain },
            });
            logger.info({ tenantId, scanTime: scanTime.toISOString() }, "Scheduled evening profile scan");
          }
        } catch (err) {
          logger.error({ err, tenantId }, "Failed to schedule profile scan");
        }
      }
    } catch (err) {
      logger.error({ err, tenantId }, "Failed to fetch/send calendar summary");
    }

    // Reschedule for tomorrow
    await this.rescheduleDaily(job, timezone);
  }

  private async runReminder(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const tenantId = job.tenantId;
    const payload = job.payload as { text?: string; channel?: string } | null;

    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) return;

    const recipient = tenant.telegramUserId || tenant.phone;
    const channel = (payload?.channel || (tenant.telegramUserId ? "telegram" : "whatsapp")) as "telegram" | "whatsapp" | "app";

    if (!recipient) return;

    const adapter = this.deps.adapters.find((a) => a.name === channel);
    if (!adapter) return;

    const reminderText = payload?.text || "You asked me to remind you about something, but I lost the details!";
    await adapter.sendMessage({
      tenantId,
      channel,
      recipient,
      text: `Reminder: ${reminderText}`,
    });

    logger.info({ tenantId, text: reminderText }, "Sent reminder");

    // One-time job — mark as completed
    await this.deps.db.update(schema.scheduledJobs)
      .set({ status: "completed", lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));
  }

  private async runTodoReminder(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const tenantId = job.tenantId;
    const payload = job.payload as { todoId?: string; title?: string; recurrence?: string } | null;

    if (!payload?.todoId) {
      logger.warn({ jobId: job.id }, "todo_reminder job missing todoId in payload");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    // Check if todo is still pending
    const todo = await this.deps.db.query.todos.findFirst({
      where: and(eq(schema.todos.id, payload.todoId), eq(schema.todos.tenantId, tenantId)),
    });

    if (!todo || todo.status === "done") {
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) return;

    const recipient = tenant.telegramUserId || tenant.phone;
    const channel = (tenant.telegramUserId ? "telegram" : "whatsapp") as "telegram" | "whatsapp" | "app";
    if (!recipient) return;

    const adapter = this.deps.adapters.find((a) => a.name === channel);
    if (!adapter) return;

    // Format a friendly reminder
    const title = todo.title;
    const recurrence = payload.recurrence;
    let message: string;

    if (recurrence) {
      // Recurring reminder — simple nudge
      message = `Hey ${tenant.name}, reminder -- ${title}`;
    } else {
      // One-shot reminder — offer actions
      message = `Hey ${tenant.name}, just a heads up -- "${title}"`;
      if (todo.dueDate) {
        const formattedDate = new Date(todo.dueDate + "T00:00:00").toLocaleDateString("en-US", {
          timeZone: tenant.timezone || "UTC",
          month: "long",
          day: "numeric",
          year: "numeric",
        });
        message += ` is coming up on ${formattedDate}`;
      }
      message += `. Want to mark it done, push it back, or need help with it?`;
    }

    await adapter.sendMessage({ tenantId, channel, recipient, text: message });

    logger.info({ tenantId, todoId: payload.todoId, title, recurrence: recurrence || "once" }, "Sent todo reminder");

    // Handle rescheduling
    if (!recurrence || job.scheduleType === "once") {
      // One-time job — mark as completed
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
    } else {
      // Recurring job — reschedule for next occurrence
      const timezone = tenant.timezone || "UTC";
      await this.rescheduleRecurring(job, recurrence, timezone);
    }
  }

  private async runDeepResearch(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const payload = job.payload as {
      interactionId?: string;
      query?: string;
      tenantId?: string;
      channel?: string;
      startedAt?: string;
    } | null;

    if (!payload?.interactionId || !payload?.tenantId) {
      logger.warn({ jobId: job.id }, "deep_research job missing interactionId or tenantId");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    // Check timeout: if started more than 6 hours ago, fail
    const startedAt = payload.startedAt ? new Date(payload.startedAt) : job.createdAt;
    const elapsedMs = Date.now() - startedAt.getTime();
    const DEEP_RESEARCH_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours
    if (elapsedMs > DEEP_RESEARCH_TIMEOUT_MS) {
      logger.warn({ jobId: job.id, elapsedMs }, "deep_research timed out after 6 hours");
      await this.sendDeepResearchError(payload.tenantId, payload.channel, payload.query || "your topic");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    // Poll the Interactions API
    const url = `https://generativelanguage.googleapis.com/v1beta/interactions/${payload.interactionId}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "x-goog-api-key": this.deps.googleApiKey },
      });
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Failed to poll deep research interaction");
      // Don't fail the job — retry on next tick
      return;
    }

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body, jobId: job.id }, "Deep research poll returned error");
      if (res.status === 404) {
        await this.sendDeepResearchError(payload.tenantId, payload.channel, payload.query || "your topic");
        await this.deps.db.update(schema.scheduledJobs)
          .set({ status: "failed", lastRunAt: new Date() })
          .where(eq(schema.scheduledJobs.id, job.id));
      }
      return;
    }

    const data = await res.json() as {
      status?: string;
      outputs?: Array<{ text?: string }>;
    };

    if (data.status === "in_progress") {
      logger.debug({ jobId: job.id, interactionId: payload.interactionId }, "Deep research still in progress");
      return;
    }

    if (data.status === "failed") {
      logger.warn({ jobId: job.id }, "Deep research interaction failed");
      await this.sendDeepResearchError(payload.tenantId, payload.channel, payload.query || "your topic");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    if (data.status === "completed") {
      const report = data.outputs?.at(-1)?.text || "(No report content returned)";
      await this.deliverDeepResearchReport(payload.tenantId, payload.channel, payload.query || "your topic", report);
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      logger.info({ jobId: job.id, tenantId: payload.tenantId, query: payload.query }, "Deep research completed and delivered");
    }
  }

  private async runMeetingBriefing(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const tenantId = job.tenantId;
    const payload = job.payload as {
      eventId?: string;
      eventSummary?: string;
      startTime?: string;
      attendees?: Array<{ email: string; displayName: string }>;
      tenantDomain?: string;
    } | null;

    if (!payload?.attendees || payload.attendees.length === 0 || !payload?.tenantDomain) {
      logger.warn({ jobId: job.id }, "meeting_briefing job missing attendees or tenantDomain in payload");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) {
      logger.warn({ tenantId }, "Tenant not found for meeting briefing job");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    const recipient = tenant.telegramUserId || tenant.phone;
    const channel = (tenant.telegramUserId ? "telegram" : "whatsapp") as "telegram" | "whatsapp" | "app";
    if (!recipient) {
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    const adapter = this.deps.adapters.find((a) => a.name === channel);
    if (!adapter) {
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    if (!this.deps.peopleConfig) {
      logger.warn({ jobId: job.id }, "peopleConfig not available for meeting briefing");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    // Re-check if the meeting still exists (not cancelled)
    const tokenResult = await ensureValidToken(tenantId, "google_calendar", this.deps.vault, this.deps.db);
    if (tokenResult && tokenResult.status !== "expired" && payload.eventId) {
      try {
        const calHandler = new GoogleCalendarHandler(tokenResult.accessToken);
        const timezone = tenant.timezone || "UTC";
        const formatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const dateStr = formatter.format(new Date());
        const timeMinISO = new Date(`${dateStr}T00:00:00+00:00`).toISOString();
        const timeMaxISO = new Date(`${dateStr}T23:59:59+00:00`).toISOString();

        const result = await calHandler.execute("list_events", {
          time_min: timeMinISO,
          time_max: timeMaxISO,
          max_results: 50,
        }) as { events: Array<Record<string, unknown>>; count: number };

        const stillExists = result.events.some((e) => e.id === payload.eventId);
        if (!stillExists) {
          logger.info({ tenantId, eventId: payload.eventId }, "Meeting was cancelled, skipping briefing");
          await this.deps.db.update(schema.scheduledJobs)
            .set({ status: "completed", lastRunAt: new Date() })
            .where(eq(schema.scheduledJobs.id, job.id));
          return;
        }
      } catch (err) {
        // If we can't verify, proceed with the briefing anyway
        logger.warn({ err, tenantId }, "Could not verify meeting still exists, proceeding with briefing");
      }
    }

    const timezone = tenant.timezone || "UTC";
    const briefingService = new MeetingBriefingService({
      db: this.deps.db,
      vault: this.deps.vault,
      llm: this.deps.llm,
      memory: this.deps.memory,
      availableSkills: this.deps.availableSkills,
      peopleConfig: this.deps.peopleConfig,
    });

    const meeting = {
      eventId: payload.eventId || "",
      summary: payload.eventSummary || "(No title)",
      startTime: payload.startTime || "",
      attendees: payload.attendees,
    };

    try {
      const briefing = await briefingService.generateBriefing([meeting], tenantId, tenant.name, timezone);
      await adapter.sendMessage({
        tenantId,
        channel,
        recipient,
        text: briefing,
      });
      logger.info({ tenantId, meeting: meeting.summary, attendees: meeting.attendees.length }, "Sent pre-meeting briefing");

      // Log background job usage
      if (this.deps.usageTracker) {
        this.deps.usageTracker.logBackgroundJob({ tenantId, jobType: "meeting_briefing" }).catch(() => {});
      }
    } catch (err) {
      logger.error({ err, tenantId }, "Failed to generate/send pre-meeting briefing");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    // Mark as completed
    await this.deps.db.update(schema.scheduledJobs)
      .set({ status: "completed", lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));
  }

  private async runProfileScan(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const tenantId = job.tenantId;
    const payload = job.payload as { tenantDomain?: string } | null;

    if (!payload?.tenantDomain || !this.deps.peopleConfig) {
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) {
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    const timezone = tenant.timezone || "UTC";
    const tokenResult = await ensureValidToken(tenantId, "google_calendar", this.deps.vault, this.deps.db);
    if (!tokenResult || tokenResult.status === "expired") {
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    // Fetch TOMORROW's events
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = formatter.format(tomorrow);
    const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const dayAfterStr = formatter.format(dayAfter);

    const timeMinISO = new Date(`${tomorrowStr}T00:00:00+00:00`).toISOString();
    const timeMaxISO = new Date(`${dayAfterStr}T00:00:00+00:00`).toISOString();

    try {
      const calHandler = new GoogleCalendarHandler(tokenResult.accessToken);
      const result = await calHandler.execute("list_events", {
        time_min: timeMinISO,
        time_max: timeMaxISO,
        max_results: 50,
      }) as { events: Array<Record<string, unknown>>; count: number };

      const briefingService = new MeetingBriefingService({
        db: this.deps.db, vault: this.deps.vault, llm: this.deps.llm,
        memory: this.deps.memory, availableSkills: this.deps.availableSkills,
        peopleConfig: this.deps.peopleConfig!,
      });

      const meetings = briefingService.extractExternalAttendees(
        result.events, payload.tenantDomain,
      );

      // Research new attendees not yet in profile_directory
      const newProfiles: Array<{ email: string; displayName: string; meeting: string; tenantName: string }> = [];
      let researchCount = 0;
      const MAX_NEW_PER_SCAN = 20;

      for (const meeting of meetings) {
        for (const attendee of meeting.attendees) {
          if (researchCount >= MAX_NEW_PER_SCAN) break;

          const normalizedEmail = attendee.email.toLowerCase();
          const existing = await this.deps.db.query.profileDirectory.findFirst({
            where: eq(schema.profileDirectory.email, normalizedEmail),
          });

          if (existing) continue; // Already in directory

          // Research and insert (researchAttendee handles the upsert)
          await briefingService.researchAttendee(
            attendee.email, attendee.displayName, tenantId,
          );
          researchCount++;

          // Log external API calls for profile research
          if (this.deps.usageTracker) {
            this.deps.usageTracker.logExternalApi({ tenantId, apiName: "scrapin", action: "profile_scan", success: true }).catch(() => {});
            this.deps.usageTracker.logExternalApi({ tenantId, apiName: "dataforseo", action: "profile_scan", success: true }).catch(() => {});
          }

          newProfiles.push({
            email: attendee.email,
            displayName: attendee.displayName,
            meeting: meeting.summary,
            tenantName: tenant.name,
          });
        }
        if (researchCount >= MAX_NEW_PER_SCAN) break;
      }

      // Notify admin of new profiles
      if (newProfiles.length > 0 && this.deps.adminNotifier) {
        await this.deps.adminNotifier.notifyNewProfiles(newProfiles, tomorrowStr);
      }

      // Log background job usage
      if (this.deps.usageTracker) {
        this.deps.usageTracker.logBackgroundJob({ tenantId, jobType: "profile_scan" }).catch(() => {});
      }

      logger.info({ tenantId, newProfiles: newProfiles.length }, "Profile scan completed");
    } catch (err) {
      logger.error({ err, tenantId }, "Profile scan failed");
    }

    await this.deps.db.update(schema.scheduledJobs)
      .set({ status: "completed", lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));
  }

  private async runDailyUsageReport(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    if (!this.deps.adminNotifier) {
      logger.warn("No adminNotifier for daily usage report");
      await this.rescheduleDaily(job, "UTC");
      return;
    }

    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Aggregate usage from audit_log in the last 24h
      const rows = await this.deps.db.execute(sql`
        SELECT
          t.name AS tenant_name,
          t.id AS tenant_id,
          COUNT(*) FILTER (WHERE a.action = 'message_processed') AS messages,
          COALESCE(SUM((a.metadata->>'totalTokens')::int) FILTER (WHERE a.action = 'message_processed'), 0) AS message_tokens,
          COALESCE(SUM((a.metadata->>'totalTokens')::int) FILTER (WHERE a.action = 'background_job'), 0) AS bg_tokens,
          COUNT(*) FILTER (WHERE a.action = 'external_api_call') AS external_api_calls,
          COUNT(*) FILTER (WHERE a.action = 'background_job') AS bg_jobs,
          COALESCE(SUM(a.credit_cost), 0) AS total_credits
        FROM audit_log a
        JOIN tenants t ON t.id = a.tenant_id
        WHERE a.created_at >= ${since}
        GROUP BY t.id, t.name
        ORDER BY message_tokens DESC
      `);

      const tenantRows = rows as unknown as Array<{
        tenant_name: string;
        tenant_id: string;
        messages: string;
        message_tokens: string;
        bg_tokens: string;
        external_api_calls: string;
        bg_jobs: string;
        total_credits: string;
      }>;

      // Calculate totals
      let totalMessages = 0;
      let totalTokens = 0;
      let totalExternalApis = 0;
      let totalBgJobs = 0;
      let totalCredits = 0;

      for (const row of tenantRows) {
        totalMessages += Number(row.messages);
        totalTokens += Number(row.message_tokens) + Number(row.bg_tokens);
        totalExternalApis += Number(row.external_api_calls);
        totalBgJobs += Number(row.bg_jobs);
        totalCredits += Number(row.total_credits);
      }

      // Build report
      const lines: string[] = [
        `Daily Usage Report (last 24h)`,
        ``,
        `Total Messages: ${totalMessages}`,
        `Total Tokens: ${totalTokens.toLocaleString()}`,
        `External API Calls: ${totalExternalApis}`,
        `Background Jobs: ${totalBgJobs}`,
        `Credits Used: ${totalCredits}`,
      ];

      if (tenantRows.length > 0) {
        lines.push(``);
        lines.push(`Top users by tokens:`);
        const top10 = tenantRows.slice(0, 10);
        for (let i = 0; i < top10.length; i++) {
          const r = top10[i];
          const tokens = Number(r.message_tokens) + Number(r.bg_tokens);
          lines.push(`${i + 1}. ${r.tenant_name}: ${tokens.toLocaleString()} tokens, ${r.messages} msgs`);
        }
      } else {
        lines.push(``);
        lines.push(`No usage recorded in the last 24 hours.`);
      }

      await this.deps.adminNotifier.notify(lines.join("\n"));
      logger.info({ tenants: tenantRows.length, totalTokens }, "Sent daily usage report");
    } catch (err) {
      logger.error({ err }, "Failed to generate daily usage report");
    }

    // Reschedule for tomorrow at 08:00 UTC
    await this.rescheduleDaily(job, "UTC");
  }

  private async deliverDeepResearchReport(
    tenantId: string,
    channel: string | undefined,
    query: string,
    report: string,
  ): Promise<void> {
    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) return;

    const recipient = tenant.telegramUserId || tenant.phone;
    const resolvedChannel = (channel || (tenant.telegramUserId ? "telegram" : "whatsapp")) as "telegram" | "whatsapp" | "app";
    if (!recipient) return;

    const adapter = this.deps.adapters.find((a) => a.name === resolvedChannel);
    if (!adapter) return;

    // ── Save full report to disk ──
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const baseDir = process.env.MEMORY_BASE_DIR || "./data/tenants";
    const reportsDir = path.join(baseDir, "..", "reports", tenantId);
    await fs.mkdir(reportsDir, { recursive: true });
    const reportFilename = `${timestamp}-${slug}.md`;
    const reportPath = path.join(reportsDir, reportFilename);
    await fs.writeFile(reportPath, `# Deep Research: ${query}\n\n_Generated: ${new Date().toISOString()}_\n\n${report}`);
    logger.info({ tenantId, reportPath }, "Saved deep research report to disk");

    // ── Summarize via Brain ──
    const soul = await this.deps.memory.readSoul(tenantId);
    const memoryContent = await this.deps.memory.readMemory(tenantId);

    const systemPrompt = PromptBuilder.build({
      soul,
      memory: memoryContent,
      skills: this.deps.availableSkills,
      connections: [],
      userName: tenant.name,
      timezone: tenant.timezone ?? "UTC",
    });

    const truncatedReport = report.length > 8000 ? report.slice(0, 8000) + "\n\n...(report truncated)" : report;

    const brain = new Brain(this.deps.llm, new ToolExecutor());
    const result = await brain.process({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `Here are the results of the deep research I requested about "${query}":\n\n${truncatedReport}\n\nSummarize this research for me in a clear, conversational way. Include key findings and cite sources where available. Start with "Your deep research on '${query}' is ready!" and end with: "Would you like me to email you the full report? Just share your email address and I'll send it over."`,
        },
      ],
      maxTurns: 1,
      tools: {},
    });

    await adapter.sendMessage({
      tenantId,
      channel: resolvedChannel,
      recipient,
      text: result.content,
    });

    // Log background job usage with token counts from Brain summarization
    if (this.deps.usageTracker) {
      this.deps.usageTracker.logBackgroundJob({ tenantId, jobType: "deep_research", usage: result.usage }).catch(() => {});
    }

    // Store the report path in tenant's memory for follow-up email requests
    await this.deps.memory.appendMemory(tenantId, `Deep research report on "${query}" saved at ${reportPath}`);
  }

  private async sendDeepResearchError(
    tenantId: string,
    channel: string | undefined,
    query: string,
  ): Promise<void> {
    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) return;

    const recipient = tenant.telegramUserId || tenant.phone;
    const resolvedChannel = (channel || (tenant.telegramUserId ? "telegram" : "whatsapp")) as "telegram" | "whatsapp" | "app";
    if (!recipient) return;

    const adapter = this.deps.adapters.find((a) => a.name === resolvedChannel);
    if (!adapter) return;

    await adapter.sendMessage({
      tenantId,
      channel: resolvedChannel,
      recipient,
      text: `I wasn't able to complete the deep research on "${query}". Would you like me to try again, or do a quick search instead?`,
    });
  }

  private async rescheduleDaily(job: typeof schema.scheduledJobs.$inferSelect, timezone: string): Promise<void> {
    const localTime = job.recurrenceRule || "07:30";
    const nextRun = nextUtcForLocalTime(localTime, timezone);

    await this.deps.db.update(schema.scheduledJobs)
      .set({ scheduledAt: nextRun, lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));

    logger.info({ jobId: job.id, nextRun: nextRun.toISOString() }, "Rescheduled daily job");
  }

  private async rescheduleRecurring(
    job: typeof schema.scheduledJobs.$inferSelect,
    recurrence: string,
    timezone: string,
  ): Promise<void> {
    const localTime = job.recurrenceRule || "09:00";
    let nextRun: Date;

    switch (recurrence) {
      case "daily":
        nextRun = nextUtcForLocalTime(localTime, timezone);
        break;

      case "weekdays": {
        nextRun = nextUtcForLocalTime(localTime, timezone);
        // Check the day of week in the tenant's timezone
        const dayStr = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(nextRun);
        if (dayStr === "Sat") {
          nextRun = new Date(nextRun.getTime() + 2 * 86_400_000); // Sat -> Mon
        } else if (dayStr === "Sun") {
          nextRun = new Date(nextRun.getTime() + 1 * 86_400_000); // Sun -> Mon
        }
        break;
      }

      case "weekly":
        // nextUtcForLocalTime gives tomorrow at the same time; add 6 more days = 7 total
        nextRun = new Date(nextUtcForLocalTime(localTime, timezone).getTime() + 6 * 86_400_000);
        break;

      case "monthly": {
        const [hours, minutes] = localTime.split(":").map(Number);
        const nowParts = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(new Date());
        const getPart = (type: string) => Number(nowParts.find((p) => p.type === type)?.value || "1");
        const curYear = getPart("year");
        const curMonth = getPart("month") - 1; // 0-indexed
        const curDay = getPart("day");

        const targetMonth = curMonth + 1;
        const targetYear = targetMonth > 11 ? curYear + 1 : curYear;
        const clampedMonth = targetMonth > 11 ? 0 : targetMonth;
        // Clamp day to max days in target month
        const maxDay = new Date(targetYear, clampedMonth + 1, 0).getDate();
        const targetDay = Math.min(curDay, maxDay);

        const targetLocal = new Date(targetYear, clampedMonth, targetDay, hours, minutes, 0);
        const utcStr = targetLocal.toLocaleString("en-US", { timeZone: "UTC" });
        const tzStr = targetLocal.toLocaleString("en-US", { timeZone: timezone });
        nextRun = new Date(targetLocal.getTime() + (new Date(utcStr).getTime() - new Date(tzStr).getTime()));
        break;
      }

      case "yearly": {
        const [hours, minutes] = localTime.split(":").map(Number);
        const nowParts = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(new Date());
        const getPart = (type: string) => Number(nowParts.find((p) => p.type === type)?.value || "1");

        const targetLocal = new Date(getPart("year") + 1, getPart("month") - 1, getPart("day"), hours, minutes, 0);
        const utcStr = targetLocal.toLocaleString("en-US", { timeZone: "UTC" });
        const tzStr = targetLocal.toLocaleString("en-US", { timeZone: timezone });
        nextRun = new Date(targetLocal.getTime() + (new Date(utcStr).getTime() - new Date(tzStr).getTime()));
        break;
      }

      default:
        nextRun = nextUtcForLocalTime(localTime, timezone);
        break;
    }

    await this.deps.db.update(schema.scheduledJobs)
      .set({ scheduledAt: nextRun, lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));

    logger.info({ jobId: job.id, recurrence, nextRun: nextRun.toISOString() }, "Rescheduled recurring todo reminder");
  }

  private getGreeting(timezone: string): string {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false })
        .format(new Date())
    );
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }
}

export { nextUtcForLocalTime };
