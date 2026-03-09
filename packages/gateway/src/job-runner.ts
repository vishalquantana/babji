import { eq, and, lte } from "drizzle-orm";
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
    const payload = job.payload as { todoId?: string; title?: string } | null;

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
    let message = `Hey ${tenant.name}, just a heads up -- "${title}"`;
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

    await adapter.sendMessage({ tenantId, channel, recipient, text: message });

    logger.info({ tenantId, todoId: payload.todoId, title }, "Sent todo reminder");

    // Mark job as completed (one-time)
    await this.deps.db.update(schema.scheduledJobs)
      .set({ status: "completed", lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));
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

    // Check timeout: if started more than 60 minutes ago, fail
    const startedAt = payload.startedAt ? new Date(payload.startedAt) : job.createdAt;
    const elapsedMs = Date.now() - startedAt.getTime();
    if (elapsedMs > 60 * 60 * 1000) {
      logger.warn({ jobId: job.id, elapsedMs }, "deep_research timed out after 60 minutes");
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
