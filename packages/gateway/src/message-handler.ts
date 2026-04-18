import { randomBytes } from "node:crypto";
import { eq, and, isNull, gte, sql } from "drizzle-orm";
import type { BabjiMessage, OutboundMessage, SkillDefinition } from "@babji/types";
import { Brain, PromptBuilder, ToolExecutor, skillsToAiTools, MemoryExtractor } from "@babji/agent";
import type { LlmClient, PersonFact } from "@babji/agent";
import { MemoryManager, SessionStore } from "@babji/memory";

import { TokenVault } from "@babji/crypto";
import { GmailHandler, GoogleCalendarHandler, GoogleAdsHandler, GoogleAnalyticsHandler, GoogleDocsHandler, JiraHandler, LinkedInHandler, InstagramHandler, FacebookPagesHandler, PostizHandler, PeopleHandler, TodosHandler, GeneralResearchHandler, ImageGenHandler, ImageStore } from "@babji/skills";
import type { S3Config } from "@babji/skills";
import type { SkillRequestManager } from "@babji/skills";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import { TenantResolver } from "./tenant-resolver.js";
import { OnboardingHandler } from "./onboarding.js";
import { RateLimiter } from "./rate-limiter.js";
import { logger } from "./logger.js";
import { timezoneFromText } from "./city-timezone.js";
import { timezoneFromPhone } from "./phone-timezone.js";
import { ensureValidToken } from "./token-refresh.js";
import { nextUtcForLocalTime } from "./job-runner.js";
import type { UsageTracker } from "./usage-tracker.js";

/** Pattern to detect "connect <something>" commands */
const CONNECT_PREFIX_RE = /^connect\s+(?:my\s+|to\s+(?:my\s+)?)?(.+?)\s*$/i;

/** Pattern to detect "disconnect/logout/remove <something>" commands */
const DISCONNECT_PREFIX_RE = /^(?:disconnect|logout|log\s*out|remove|unlink)\s+(?:my\s+|from\s+(?:my\s+)?)?(.+?)\s*$/i;

/** Known provider names and common misspellings/aliases */
const PROVIDER_ALIASES: Record<string, string> = {
  gmail: "gmail",
  email: "gmail",
  mail: "gmail",
  "google mail": "gmail",
  calendar: "google_calendar",
  "google calendar": "google_calendar",
  gcal: "google_calendar",
  ads: "google_ads",
  "google ads": "google_ads",
  adwords: "google_ads",
  "google adwords": "google_ads",
  analytics: "google_analytics",
  "google analytics": "google_analytics",
  ga: "google_analytics",
  ga4: "google_analytics",
  meta: "meta",
  facebook: "meta",
  instagram: "meta",
  linkedin: "linkedin",
  x: "x",
  twitter: "x",
  jira: "jira",
  atlassian: "jira",
};

/**
 * Attempt to match a user-typed provider string to a known provider.
 * Uses exact lookup first, then Levenshtein distance for typo tolerance.
 */
function matchProvider(input: string): string | null {
  const normalized = input.toLowerCase().trim();

  // Exact match
  if (PROVIDER_ALIASES[normalized]) return PROVIDER_ALIASES[normalized];

  // Fuzzy match: find the closest alias within edit distance 2
  let bestMatch: string | null = null;
  let bestDist = 3; // threshold: max 2 edits allowed
  for (const alias of Object.keys(PROVIDER_ALIASES)) {
    const dist = levenshtein(normalized, alias);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = PROVIDER_ALIASES[alias];
    }
  }
  return bestMatch;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export interface MessageHandlerDeps {
  memory: MemoryManager;
  sessions: SessionStore;
  llm: LlmClient;
  llmLite: LlmClient;
  availableSkills: SkillDefinition[];
  tenantResolver: TenantResolver;
  onboarding: OnboardingHandler;
  skillRequests: SkillRequestManager;
  db: Database;
  vault: TokenVault;
  oauthPortalUrl: string;
  googleClientId: string;
  atlassianClientId: string;
  linkedinClientId: string;
  metaClientId: string;
  googleAdsDeveloperToken: string;
  peopleConfig?: {
    enabled: boolean;
    scrapinApiKey: string;
    dataforseoLogin: string;
    dataforseoPassword: string;
  };
  googleApiKey: string;
  googleModel: string;
  usageTracker?: UsageTracker;
  s3Config?: S3Config;
}

export class MessageHandler {
  private rateLimiter: RateLimiter;
  /** Pending phone numbers awaiting user confirmation: tenantId -> phone */
  private pendingPhones = new Map<string, string>();
  /** Tenants who have been asked for their phone number (prevents intercepting unrelated numbers) */
  private askedForPhone = new Set<string>();

  constructor(private deps: MessageHandlerDeps) {
    this.rateLimiter = new RateLimiter();
  }

  async handle(message: BabjiMessage): Promise<OutboundMessage> {
    const { channel, sender } = message;

    // Rate limit by sender
    const rateLimitKey = `${channel}:${sender}`;
    const rateCheck = this.rateLimiter.check(rateLimitKey);
    if (!rateCheck.allowed) {
      const retrySeconds = Math.ceil((rateCheck.retryAfterMs ?? 0) / 1000);
      logger.warn({ sender, channel, retrySeconds }, "Rate limited");
      return {
        tenantId: message.tenantId || "unknown",
        channel,
        recipient: sender,
        text: `You're sending messages too quickly. Please wait ${retrySeconds} seconds and try again.`,
      };
    }

    try {
      // Resolve tenant from channel-specific identifier
      let tenant = channel === "whatsapp"
        ? await this.deps.tenantResolver.resolveByPhone(sender)
        : null;

      if (!tenant && channel === "telegram") {
        tenant = await this.deps.tenantResolver.resolveByTelegramId(sender);
      }

      // New user — run onboarding
      if (!tenant) {
        logger.info({ sender, channel }, "New sender — routing to onboarding");
        const result = await this.deps.onboarding.handle(message);
        return result;
      }

      const tenantId = tenant.id;

      // ── Handle onboarding phases ──
      if (tenant.onboardingPhase === "role") {
        const roleText = message.text.trim();

        // Store the role in memory
        await this.deps.memory.appendMemory(tenantId, `Work/business: ${roleText}`);

        // Detect timezone from role text (e.g., "I run a shop in Mumbai")
        const currentTz = tenant.timezone ?? "UTC";
        if (currentTz === "UTC") {
          const detectedTz = timezoneFromText(roleText);
          if (detectedTz) {
            await this.deps.db.update(schema.tenants)
              .set({ timezone: detectedTz })
              .where(eq(schema.tenants.id, tenantId));
          }
        }

        // Update phase to "ready"
        await this.deps.db.update(schema.tenants)
          .set({ onboardingPhase: "ready" })
          .where(eq(schema.tenants.id, tenantId));

        // Generate tailored suggestions based on role
        const suggestions = this.generateOnboardingSuggestions(roleText);

        return {
          tenantId,
          channel,
          recipient: sender,
          text: [
            `Got it -- ${roleText}, that's interesting!`,
            "",
            "Let me show you what I can do right away. Try asking me something like:",
            "",
            ...suggestions.map((s) => `- "${s}"`),
            "",
            "Just type one of those, or ask me anything you're curious about.",
          ].join("\n"),
        };
      }

      // ── Handle phone number collection (Telegram users without phone) ──
      if (!tenant.phone && channel === "telegram") {
        const trimmedText = message.text.trim().toLowerCase();
        const pendingPhone = this.pendingPhones.get(tenantId);

        // Step 2: User is confirming or rejecting a pending phone number
        if (pendingPhone) {
          const isYes = ["yes", "y", "yeah", "yep", "correct", "ok", "okay", "sure", "right", "confirm", "👍"].includes(trimmedText);
          const isNo = ["no", "n", "nope", "wrong", "nah", "change"].includes(trimmedText);

          if (isYes) {
            this.pendingPhones.delete(tenantId);
            this.askedForPhone.delete(tenantId);
            const detectedTz = timezoneFromPhone(pendingPhone);
            const updates: Record<string, string> = { phone: pendingPhone };
            if (detectedTz) updates.timezone = detectedTz;

            await this.deps.db.update(schema.tenants)
              .set(updates)
              .where(eq(schema.tenants.id, tenantId));

            logger.info({ tenantId, phone: pendingPhone, timezone: detectedTz }, "Saved phone number from Telegram user");

            const tzNote = detectedTz
              ? `I've set your timezone based on your number.`
              : "";

            return {
              tenantId, channel, recipient: sender,
              text: `Saved! ${tzNote}\n\nWhat can I help you with?`,
            };
          }

          if (isNo) {
            this.pendingPhones.delete(tenantId);
            return {
              tenantId, channel, recipient: sender,
              text: "No problem! Please type your phone number again with country code (e.g. +91 98765 43210), or type 'skip' to skip.",
            };
          }
          // If neither yes nor no, fall through — might be a new phone number or regular message
        }

        // If user types "skip", proceed without phone
        if (trimmedText === "skip") {
          this.pendingPhones.delete(tenantId);
          this.askedForPhone.delete(tenantId);
          return {
            tenantId, channel, recipient: sender,
            text: "No worries! What can I help you with?",
          };
        }

        // Step 1: Check if the message looks like a phone number — but ONLY if we recently asked for one
        const phoneDigits = message.text.replace(/[\s\-\(\)]/g, "");
        if (this.askedForPhone.has(tenantId) && /^\+?\d{7,15}$/.test(phoneDigits)) {
          let normalizedPhone: string;
          if (phoneDigits.startsWith("+")) {
            normalizedPhone = phoneDigits;
          } else if (phoneDigits.length === 10) {
            normalizedPhone = `+91${phoneDigits}`;
          } else {
            normalizedPhone = `+${phoneDigits}`;
          }

          // Store pending and ask for confirmation
          this.pendingPhones.set(tenantId, normalizedPhone);

          return {
            tenantId, channel, recipient: sender,
            text: `I have your number as ${normalizedPhone} — is that correct? (yes/no)`,
          };
        }
        // User sent something that isn't a phone number and isn't "skip" — they're moving on.
        // Clear the phone-ask flag so future numbers aren't intercepted.
        this.askedForPhone.delete(tenantId);
      }

      // ── Handle "connect <provider>" command ──
      const connectMatch = message.text.trim().match(CONNECT_PREFIX_RE);
      if (connectMatch) {
        const provider = matchProvider(connectMatch[1]);
        if (provider) {
          return this.handleConnect(tenantId, provider, channel, sender);
        }
        // If "connect" was typed but we can't match the provider, fall through to Brain
      }

      // ── Handle "disconnect/logout <provider>" command ──
      const disconnectMatch = message.text.trim().match(DISCONNECT_PREFIX_RE);
      if (disconnectMatch) {
        const provider = matchProvider(disconnectMatch[1]);
        if (provider) {
          return this.handleDisconnect(tenantId, provider, channel, sender);
        }
      }

      // ── Handle "stop reminding" intent for connect reminders ──
      const stopReminderRe = /\b(stop\s+remind|don'?t\s+remind|no\s+more\s+remind|stop\s+nag)/i;
      if (stopReminderRe.test(message.text)) {
        const reminderJob = await this.deps.db.query.scheduledJobs.findFirst({
          where: and(
            eq(schema.scheduledJobs.tenantId, tenantId),
            eq(schema.scheduledJobs.jobType, "connect_reminder"),
            eq(schema.scheduledJobs.status, "active"),
          ),
        });
        if (reminderJob) {
          const tz = tenant.timezone || "UTC";
          const nextRun = new Date(nextUtcForLocalTime("18:00", tz).getTime() + 6 * 86_400_000);
          const payload = (reminderJob.payload || {}) as { reminderCount?: number; maxReminders?: number };
          await this.deps.db.update(schema.scheduledJobs)
            .set({
              scheduledAt: nextRun,
              lastRunAt: new Date(),
              payload: { reminderCount: payload.reminderCount ?? 0, maxReminders: payload.maxReminders ?? 4 },
            })
            .where(eq(schema.scheduledJobs.id, reminderJob.id));
          await this.deps.db.update(schema.tenants)
            .set({ connectReminderStatus: "snoozed" } as Record<string, unknown>)
            .where(eq(schema.tenants.id, tenantId));
          logger.info({ tenantId }, "Connect reminder snoozed by user request");
          // Don't return — let the message also flow through Brain for a natural response
        }
      }

      // Build a unique session identifier per channel + sender
      const sessionId = `${channel}-${sender}`;

      // Store incoming message in session history
      await this.deps.sessions.append(tenantId, sessionId, {
        role: "user",
        content: message.text,
        timestamp: new Date(),
      });

      // Load tenant context: soul personality, long-term memory, recent history
      const soul = await this.deps.memory.readSoul(tenantId);
      const memoryContent = await this.deps.memory.readMemory(tenantId);
      const history = await this.deps.sessions.getHistory(tenantId, sessionId, 20);

      // ── Load tenant's connected services from DB ──
      const connections = await this.deps.db.query.serviceConnections.findMany({
        where: eq(schema.serviceConnections.tenantId, tenantId),
      });
      const connectedProviders = connections.map((c) => c.provider);

      // ── Create per-request ToolExecutor with tenant's tokens (auto-refresh) ──
      const toolExecutor = new ToolExecutor();
      const expiredProviders: string[] = [];

      for (const conn of connections) {
        const tokenResult = await ensureValidToken(tenantId, conn.provider, this.deps.vault, this.deps.db);

        if (!tokenResult) {
          logger.warn({ tenantId, provider: conn.provider }, "No token found for connection");
          continue;
        }

        if (tokenResult.status === "expired") {
          expiredProviders.push(conn.provider);
          logger.warn({ tenantId, provider: conn.provider }, "Token expired and refresh failed");

          // Register a stub handler so the Brain gets a clear error instead of
          // the tool silently disappearing (which causes confabulated responses)
          const displayName = (MessageHandler.PROVIDER_CONFIGS[conn.provider]?.displayName) ?? conn.provider.replace(/_/g, " ");
          const skillName = conn.provider;
          toolExecutor.registerSkill(skillName, {
            execute: async () => ({
              error: true,
              message: `Your ${displayName} connection has expired. Please reconnect by saying "connect ${skillName}".`,
            }),
          });

          continue;
        }

        const accessToken = tokenResult.accessToken;

        if (conn.provider === "gmail") {
          toolExecutor.registerSkill("gmail", new GmailHandler(accessToken, this.deps.db, tenantId));
        }
        if (conn.provider === "google_calendar") {
          toolExecutor.registerSkill("google_calendar", new GoogleCalendarHandler(accessToken));
        }
        if (conn.provider === "google_ads") {
          toolExecutor.registerSkill("google_ads", new GoogleAdsHandler(accessToken, this.deps.googleAdsDeveloperToken, (issue, context) => {
            this.deps.skillRequests.create(tenantId, `google_ads:${issue}`, context).catch((err) => {
              logger.error({ err, issue }, "Failed to report Google Ads issue");
            });
          }));
        }
        if (conn.provider === "google_analytics") {
          toolExecutor.registerSkill("google_analytics", new GoogleAnalyticsHandler(accessToken));
        }
        if (conn.provider === "google_docs") {
          toolExecutor.registerSkill("google_docs", new GoogleDocsHandler(accessToken, {
            getReportMarkdown: async (reportId: string) => {
              const report = await this.deps.db.query.reports.findFirst({
                where: eq(schema.reports.id, reportId),
              });
              if (!report) return null;
              try {
                const { readFile } = await import("node:fs/promises");
                return await readFile(report.filePath, "utf-8");
              } catch {
                return null;
              }
            },
          }));
        }
        if (conn.provider === "jira") {
          // Retrieve cloudId stored alongside the token during OAuth callback
          const tokenBlob = await this.deps.vault.retrieve(tenantId, "jira") as { cloud_id?: string } | null;
          const cloudId = tokenBlob?.cloud_id;
          if (cloudId) {
            toolExecutor.registerSkill("jira", new JiraHandler(accessToken, cloudId));
          } else {
            logger.warn({ tenantId }, "Jira connected but no cloudId found — cannot register handler");
            toolExecutor.registerSkill("jira", {
              execute: async () => ({
                error: true,
                message: "Your Jira connection is missing the site identifier. Please reconnect by saying \"connect jira\".",
              }),
            });
          }
        }

        if (conn.provider === "linkedin") {
          toolExecutor.registerSkill("linkedin", new LinkedInHandler(accessToken, {
            countTodayPosts: async () => {
              const startOfDay = new Date();
              startOfDay.setHours(0, 0, 0, 0);
              const rows = await this.deps.db
                .select({ count: sql<number>`count(*)::int` })
                .from(schema.auditLog)
                .where(
                  and(
                    eq(schema.auditLog.tenantId, tenantId),
                    eq(schema.auditLog.action, "message_processed"),
                    gte(schema.auditLog.createdAt, startOfDay),
                    sql`${schema.auditLog.metadata}::jsonb -> 'toolCalls' @> '["linkedin.create_post"]'::jsonb`,
                  ),
                );
              return rows[0]?.count ?? 0;
            },
            dailyPostLimit: 2,
            schedulePost: async (scheduledAt, payload) => {
              const [row] = await this.deps.db.insert(schema.scheduledJobs).values({
                tenantId,
                jobType: "scheduled_linkedin_post",
                scheduleType: "once",
                scheduledAt,
                payload: payload as unknown as Record<string, unknown>,
                status: "active",
              }).returning({ id: schema.scheduledJobs.id });
              return row.id;
            },
            listScheduledPosts: async () => {
              const jobs = await this.deps.db.query.scheduledJobs.findMany({
                where: and(
                  eq(schema.scheduledJobs.tenantId, tenantId),
                  eq(schema.scheduledJobs.jobType, "scheduled_linkedin_post"),
                  eq(schema.scheduledJobs.status, "active"),
                ),
              });
              return jobs.map((j) => {
                const p = (j.payload || {}) as Record<string, string | undefined>;
                return {
                  jobId: j.id,
                  scheduledAt: j.scheduledAt.toISOString(),
                  text: (p.text || "").substring(0, 100),
                  hasImage: !!p.image_url,
                  hasArticle: !!p.article_url,
                };
              });
            },
            cancelScheduledPost: async (jobId) => {
              const job = await this.deps.db.query.scheduledJobs.findFirst({
                where: and(
                  eq(schema.scheduledJobs.id, jobId),
                  eq(schema.scheduledJobs.tenantId, tenantId),
                  eq(schema.scheduledJobs.jobType, "scheduled_linkedin_post"),
                  eq(schema.scheduledJobs.status, "active"),
                ),
              });
              if (!job) return false;
              await this.deps.db.update(schema.scheduledJobs)
                .set({ status: "completed", lastRunAt: new Date() })
                .where(eq(schema.scheduledJobs.id, jobId));
              return true;
            },
          }));
        }

        if (conn.provider === "meta") {
          // Register Instagram skill
          toolExecutor.registerSkill("instagram", new InstagramHandler(accessToken, {
            schedulePost: async (scheduledAt, payload) => {
              const [row] = await this.deps.db.insert(schema.scheduledJobs).values({
                tenantId,
                jobType: "scheduled_instagram_post",
                scheduleType: "once",
                scheduledAt,
                payload: payload as unknown as Record<string, unknown>,
                status: "active",
              }).returning({ id: schema.scheduledJobs.id });
              return row.id;
            },
            listScheduledPosts: async () => {
              const jobs = await this.deps.db.query.scheduledJobs.findMany({
                where: and(
                  eq(schema.scheduledJobs.tenantId, tenantId),
                  eq(schema.scheduledJobs.jobType, "scheduled_instagram_post"),
                  eq(schema.scheduledJobs.status, "active"),
                ),
              });
              return jobs.map((j) => {
                const p = (j.payload || {}) as Record<string, string | undefined>;
                return {
                  jobId: j.id,
                  scheduledAt: j.scheduledAt.toISOString(),
                  caption: (p.caption || "").substring(0, 100),
                  hasImage: !!p.image_url,
                };
              });
            },
            cancelScheduledPost: async (jobId: string) => {
              const job = await this.deps.db.query.scheduledJobs.findFirst({
                where: and(
                  eq(schema.scheduledJobs.id, jobId),
                  eq(schema.scheduledJobs.tenantId, tenantId),
                  eq(schema.scheduledJobs.jobType, "scheduled_instagram_post"),
                  eq(schema.scheduledJobs.status, "active"),
                ),
              });
              if (!job) return false;
              await this.deps.db.update(schema.scheduledJobs)
                .set({ status: "completed", lastRunAt: new Date() })
                .where(eq(schema.scheduledJobs.id, jobId));
              return true;
            },
          }));

          // Register Facebook Pages skill
          toolExecutor.registerSkill("facebook_pages", new FacebookPagesHandler(accessToken, {
            schedulePost: async (scheduledAt: Date, payload: { page_id: string; message: string; link?: string }) => {
              const [row] = await this.deps.db.insert(schema.scheduledJobs).values({
                tenantId,
                jobType: "scheduled_facebook_post",
                scheduleType: "once",
                scheduledAt,
                payload: payload as unknown as Record<string, unknown>,
                status: "active",
              }).returning({ id: schema.scheduledJobs.id });
              return row.id;
            },
            listScheduledPosts: async () => {
              const jobs = await this.deps.db.query.scheduledJobs.findMany({
                where: and(
                  eq(schema.scheduledJobs.tenantId, tenantId),
                  eq(schema.scheduledJobs.jobType, "scheduled_facebook_post"),
                  eq(schema.scheduledJobs.status, "active"),
                ),
              });
              return jobs.map((j) => {
                const p = (j.payload || {}) as Record<string, string | undefined>;
                return {
                  jobId: j.id,
                  scheduledAt: j.scheduledAt.toISOString(),
                  message: (p.message || "").substring(0, 100),
                  hasLink: !!p.link,
                };
              });
            },
            cancelScheduledPost: async (jobId: string) => {
              const job = await this.deps.db.query.scheduledJobs.findFirst({
                where: and(
                  eq(schema.scheduledJobs.id, jobId),
                  eq(schema.scheduledJobs.tenantId, tenantId),
                  eq(schema.scheduledJobs.jobType, "scheduled_facebook_post"),
                  eq(schema.scheduledJobs.status, "active"),
                ),
              });
              if (!job) return false;
              await this.deps.db.update(schema.scheduledJobs)
                .set({ status: "completed", lastRunAt: new Date() })
                .where(eq(schema.scheduledJobs.id, jobId));
              return true;
            },
          }));
        }
      }

      // If any tokens are expired, handle gracefully
      if (expiredProviders.length > 0) {
        const providerNames = expiredProviders.map((p) => p.replace(/_/g, " ")).join(", ");
        const reconnectCmds = expiredProviders.map((p) => `"connect ${p.replace("google_", "")}"`).join(" or ");
        const validProviders = connectedProviders.filter((p) => !expiredProviders.includes(p));

        // If ALL providers are expired and the user's message likely needs them, warn immediately
        if (validProviders.length === 0 && connections.length > 0) {
          return {
            tenantId,
            channel,
            recipient: sender,
            text: `Your ${providerNames} connection has expired. Please reconnect by typing ${reconnectCmds} so I can help you.`,
          };
        }

        // Some expired — keep them in connectedProviders so the Brain can still
        // call the stub handlers and receive a clear error message instead of
        // the tools silently disappearing (which causes confabulated responses).
        // The stub handlers registered above will return actionable error messages.
      }

      // ── Register "babji" skill handler (check_with_teacher, connect_service, task actions) ──
      const todosHandler = new TodosHandler(this.deps.db, tenantId, tenant.timezone ?? "UTC");

      toolExecutor.registerSkill("babji", {
        execute: async (actionName: string, params: Record<string, unknown>) => {
          if (actionName === "check_with_teacher") {
            const result = await this.deps.skillRequests.create(
              tenantId,
              params.skill_name as string,
              params.context as string,
            );
            return { submitted: true, requestId: result.id };
          }
          if (actionName === "connect_service") {
            const raw = (params.service_name as string || "").toLowerCase().trim();
            const provider = matchProvider(raw);
            if (!provider) {
              return { success: false, error: `Unknown service "${raw}". Available: gmail, google_calendar, google_ads, google_analytics, jira` };
            }
            const link = await this.generateConnectLink(tenantId, provider, channel, sender);
            return link;
          }
          // Task actions: add_task, list_tasks, complete_task, update_task, delete_task
          const taskActions = ["add_task", "list_tasks", "complete_task", "update_task", "delete_task"];
          if (taskActions.includes(actionName)) {
            return todosHandler.execute(actionName, params);
          }
          if (actionName === "enable_meeting_briefings") {
            const timing = params.timing as string;
            if (timing !== "morning" && timing !== "pre_meeting") {
              return { success: false, error: "timing must be 'morning' or 'pre_meeting'" };
            }
            await this.deps.db.update(schema.tenants)
              .set({ meetingBriefingPref: timing })
              .where(eq(schema.tenants.id, tenantId));
            const timingDesc = timing === "morning" ? "with your morning calendar summary" : "1 hour before each meeting";
            return { success: true, message: `Meeting briefings enabled. I will research external attendees and send you a briefing ${timingDesc}.` };
          }
          if (actionName === "disable_meeting_briefings") {
            await this.deps.db.update(schema.tenants)
              .set({ meetingBriefingPref: "disabled" })
              .where(eq(schema.tenants.id, tenantId));
            return { success: true, message: "Meeting briefings disabled. You can re-enable them anytime." };
          }
          if (actionName === "research_meeting_attendees") {
            return this.handleOnDemandBriefing(tenantId, tenant, params.meeting_query as string);
          }
          if (actionName === "configure_briefing") {
            const mode = params.mode as string;
            const validModes = ["morning", "minimal", "off"];
            if (!validModes.includes(mode)) {
              return { success: false, error: "mode must be one of: " + validModes.join(", ") };
            }

            // Update tenant preference
            await this.deps.db.update(schema.tenants)
              .set({ briefingPref: mode } as Record<string, unknown>)
              .where(eq(schema.tenants.id, tenantId));

            const existingJob = await this.deps.db.query.scheduledJobs.findFirst({
              where: and(
                eq(schema.scheduledJobs.tenantId, tenantId),
                eq(schema.scheduledJobs.jobType, "daily_briefing"),
              ),
            });

            if (mode === "off") {
              if (existingJob) {
                await this.deps.db.update(schema.scheduledJobs)
                  .set({ status: "paused" })
                  .where(eq(schema.scheduledJobs.id, existingJob.id));
              }
              return { success: true, message: "Morning briefing turned off. Say 'turn on my briefing' to re-enable anytime." };
            }

            // Update or create the job
            const customTime = params.time as string | undefined;
            const tz = tenant.timezone || "UTC";

            if (existingJob) {
              const updates: Record<string, unknown> = { status: "active" };
              if (customTime) {
                updates.recurrenceRule = customTime;
                updates.scheduledAt = nextUtcForLocalTime(customTime, tz);
              }
              await this.deps.db.update(schema.scheduledJobs)
                .set(updates)
                .where(eq(schema.scheduledJobs.id, existingJob.id));
            } else {
              const time = customTime || "08:00";
              await this.deps.db.insert(schema.scheduledJobs).values({
                tenantId,
                jobType: "daily_briefing",
                scheduleType: "daily",
                scheduledAt: nextUtcForLocalTime(time, tz),
                recurrenceRule: time,
                payload: {},
                status: "active",
              });
            }

            const modeDesc: Record<string, string> = {
              morning: "full briefing (calendar, emails, tasks, dates, follow-ups)",
              minimal: "minimal briefing (calendar + tasks only)",
            };
            const timeMsg = customTime ? ` at ${customTime}` : "";
            return {
              success: true,
              message: `Morning briefing set to ${modeDesc[mode]}${timeMsg}.`,
            };
          }
          if (actionName === "configure_email_digest") {
            const frequency = params.frequency as string;
            const validFreqs = ["morning_only", "morning_evening", "three_times", "off"];
            if (!validFreqs.includes(frequency)) {
              return { success: false, error: "frequency must be one of: " + validFreqs.join(", ") };
            }

            const freqToRule: Record<string, string> = {
              morning_only: "08:00",
              morning_evening: "08:00,17:00",
              three_times: "08:00,12:00,17:00",
            };

            const customTimes = params.times as string | undefined;
            const recurrenceRule = customTimes || freqToRule[frequency];

            if (frequency === "off") {
              const existingJob = await this.deps.db.query.scheduledJobs.findFirst({
                where: and(
                  eq(schema.scheduledJobs.tenantId, tenantId),
                  eq(schema.scheduledJobs.jobType, "email_digest"),
                ),
              });
              if (existingJob) {
                await this.deps.db.update(schema.scheduledJobs)
                  .set({ status: "paused" })
                  .where(eq(schema.scheduledJobs.id, existingJob.id));
              }
              return { success: true, message: "Email digests turned off. You can re-enable them anytime." };
            }

            const existingJob = await this.deps.db.query.scheduledJobs.findFirst({
              where: and(
                eq(schema.scheduledJobs.tenantId, tenantId),
                eq(schema.scheduledJobs.jobType, "email_digest"),
              ),
            });

            if (existingJob) {
              await this.deps.db.update(schema.scheduledJobs)
                .set({ recurrenceRule, status: "active" })
                .where(eq(schema.scheduledJobs.id, existingJob.id));
            } else {
              const tz = tenant.timezone || "UTC";
              const firstTime = recurrenceRule!.split(",")[0].trim();
              await this.deps.db.insert(schema.scheduledJobs).values({
                tenantId,
                jobType: "email_digest",
                scheduleType: "daily",
                scheduledAt: nextUtcForLocalTime(firstTime, tz),
                recurrenceRule: recurrenceRule!,
                payload: { lastCheckedAt: null },
                status: "active",
              });
            }

            const freqDesc: Record<string, string> = {
              morning_only: "once each morning at 8 AM",
              morning_evening: "morning (8 AM) and evening (5 PM)",
              three_times: "three times daily (8 AM, 12 PM, 5 PM)",
            };
            return {
              success: true,
              message: "Email digests set to " + (customTimes ? "custom times: " + customTimes : freqDesc[frequency]) + ". I will triage your inbox and send a summary with draft replies.",
            };
          }
          if (actionName === "configure_jira_report") {
            const mode = params.mode as string;
            const validModes = ["on", "off"];
            if (!validModes.includes(mode)) {
              return { success: false, error: "mode must be one of: " + validModes.join(", ") };
            }

            // Update tenant preference
            await this.deps.db.update(schema.tenants)
              .set({ jiraReportPref: mode === "on" ? "morning" : "off" } as Record<string, unknown>)
              .where(eq(schema.tenants.id, tenantId));

            const existingJob = await this.deps.db.query.scheduledJobs.findFirst({
              where: and(
                eq(schema.scheduledJobs.tenantId, tenantId),
                eq(schema.scheduledJobs.jobType, "daily_jira_report"),
              ),
            });

            if (mode === "off") {
              if (existingJob) {
                await this.deps.db.update(schema.scheduledJobs)
                  .set({ status: "paused" })
                  .where(eq(schema.scheduledJobs.id, existingJob.id));
              }
              return { success: true, message: "Daily Jira report turned off. Say 'turn on my Jira report' to re-enable anytime." };
            }

            // Update or create the job
            const customTime = params.time as string | undefined;
            const tz = tenant.timezone || "UTC";

            if (existingJob) {
              const updates: Record<string, unknown> = { status: "active" };
              if (customTime) {
                updates.recurrenceRule = customTime;
                updates.scheduledAt = nextUtcForLocalTime(customTime, tz);
              }
              await this.deps.db.update(schema.scheduledJobs)
                .set(updates)
                .where(eq(schema.scheduledJobs.id, existingJob.id));
            } else {
              const time = customTime || "09:00";
              await this.deps.db.insert(schema.scheduledJobs).values({
                tenantId,
                jobType: "daily_jira_report",
                scheduleType: "daily",
                scheduledAt: nextUtcForLocalTime(time, tz),
                recurrenceRule: time,
                payload: {},
                status: "active",
              });
            }

            const effectiveTime = customTime || existingJob?.recurrenceRule || "09:00";
            return {
              success: true,
              message: `Daily Jira report ${mode === "on" ? "enabled" : "updated"} -- you'll get it at ${effectiveTime} every morning. Say 'change my Jira report time' to adjust.`,
            };
          }
          if (actionName === "draft_linkedin_message") {
            const recipientName = params.recipient_name as string;
            const messageIntent = params.message_intent as string;
            const tone = (params.tone as string) || "professional";
            const linkedinUrl = params.recipient_linkedin_url as string | undefined;
            const extraContext = params.context as string | undefined;

            // Check memory for any info about the recipient
            const slug = MemoryManager.slugifyName(recipientName);
            const personMemory = await this.deps.memory.readPerson(tenantId, slug);
            const memoryContext = personMemory
              ? `Known info about ${recipientName}: ${JSON.stringify(personMemory)}`
              : "";

            const draftPrompt =
              `Draft a LinkedIn message from ${tenant.name} to ${recipientName}.\n` +
              `Intent: ${messageIntent}\n` +
              `Tone: ${tone}\n` +
              (extraContext ? `Context: ${extraContext}\n` : "") +
              (memoryContext ? `${memoryContext}\n` : "") +
              `\nRules:\n` +
              `- Keep it concise (2-4 sentences for connection requests, up to 6 for InMail)\n` +
              `- Be genuine and specific, avoid generic templates\n` +
              `- Match the requested tone\n` +
              `- Do NOT include subject lines unless it's an InMail\n` +
              `- Output ONLY the message text, nothing else`;

            const { Brain, ToolExecutor } = await import("@babji/agent");
            const brain = new Brain(this.deps.llm, new ToolExecutor());
            const result = await brain.process({
              systemPrompt: "You are an expert LinkedIn message writer. Output only the message text.",
              messages: [{ role: "user", content: draftPrompt }],
              maxTurns: 1,
              tools: {},
            });

            const response: Record<string, unknown> = {
              success: true,
              draft_message: result.content,
              recipient: recipientName,
              instructions: "Here's your drafted LinkedIn message. Copy it and send it directly on LinkedIn.",
            };
            if (linkedinUrl) {
              response.linkedin_url = linkedinUrl;
              response.instructions = `Here's your drafted LinkedIn message. Open ${linkedinUrl} and send it directly.`;
            }
            return response;
          }
          if (actionName === "configure_internal_domains") {
            const domains = params.domains as string[];
            const action = (params.action as string) || "add";

            if (!Array.isArray(domains) || domains.length === 0) {
              return { success: false, error: "Please provide at least one domain." };
            }

            // Validate domain format
            const validDomains: string[] = [];
            for (const d of domains) {
              const cleaned = d.toLowerCase().trim();
              if (!cleaned.includes(".") || cleaned.includes(" ") || cleaned.startsWith("http")) {
                return { success: false, error: `Invalid domain format: "${d}". Use format like "example.com".` };
              }
              validDomains.push(cleaned);
            }

            const current = ((tenant as Record<string, unknown>).internalDomains as string[]) || [];
            let updated: string[];

            if (action === "set") {
              updated = [...new Set(validDomains)];
            } else if (action === "remove") {
              updated = current.filter(d => !validDomains.includes(d));
            } else {
              // add (default)
              updated = [...new Set([...current, ...validDomains])];
            }

            await this.deps.db.update(schema.tenants)
              .set({ internalDomains: updated } as Record<string, unknown>)
              .where(eq(schema.tenants.id, tenantId));

            const domainList = updated.length > 0 ? updated.join(", ") : "(none)";
            return {
              success: true,
              message: `Updated. Your internal domains are now: ${domainList}. Attendees from these domains will be treated as teammates in meeting briefings.`,
            };
          }
          if (actionName === "recall_person") {
            const name = params.name as string;
            const email = params.email as string | undefined;

            // Try by email first (exact match)
            if (email) {
              const person = await this.deps.memory.findPersonByEmail(tenantId, email);
              if (person) {
                return { found: true, ...person };
              }
            }

            // Try by name slug
            const slug = MemoryManager.slugifyName(name);
            const person = await this.deps.memory.readPerson(tenantId, slug);
            if (person) {
              return { found: true, ...person };
            }

            // Fuzzy: search all people for partial name match
            const allPeople = await this.deps.memory.listPeople(tenantId);
            const lower = name.toLowerCase();
            const match = allPeople.find(p =>
              p.name.toLowerCase().includes(lower) ||
              p.aliases.some(a => a.toLowerCase().includes(lower))
            );
            if (match) {
              return { found: true, ...match };
            }

            return { found: false, message: `No information found about "${name}". I'll start remembering details about them from our future conversations.` };
          }
          throw new Error(`Unknown babji action: ${actionName}`);
        },
      });

      // ── Register people research handler (server-side keys, always available) ──
      if (this.deps.peopleConfig?.enabled) {
        const peopleHandler = new PeopleHandler(
          { login: this.deps.peopleConfig.dataforseoLogin, password: this.deps.peopleConfig.dataforseoPassword },
          { apiKey: this.deps.peopleConfig.scrapinApiKey },
        );

        if (this.deps.usageTracker) {
          const tracker = this.deps.usageTracker;
          toolExecutor.registerSkill("people", {
            execute: async (actionName: string, params: Record<string, unknown>) => {
              const result = await peopleHandler.execute(actionName, params);
              const success = !(result as Record<string, unknown>).error;
              // research_person uses both DataForSEO + Scrapin; lookup_profile uses Scrapin only
              if (actionName === "research_person") {
                tracker.logExternalApi({ tenantId, apiName: "dataforseo", action: actionName, success }).catch(() => {});
                tracker.logExternalApi({ tenantId, apiName: "scrapin", action: actionName, success }).catch(() => {});
              } else if (actionName === "lookup_profile") {
                tracker.logExternalApi({ tenantId, apiName: "scrapin", action: actionName, success }).catch(() => {});
              }
              return result;
            },
          });
        } else {
          toolExecutor.registerSkill("people", peopleHandler);
        }
      }

      // ── Register general research handler (server-side keys, always available) ──
      if (this.deps.googleApiKey) {
        const insertJob = async (jobTenantId: string, payload: Record<string, unknown>) => {
          const [job] = await this.deps.db.insert(schema.scheduledJobs).values({
            tenantId: jobTenantId,
            jobType: "deep_research",
            scheduleType: "once",
            scheduledAt: new Date(),
            payload,
            status: "active",
          }).returning();
          return job.id;
        };

        toolExecutor.registerSkill("general_research", new GeneralResearchHandler(
          this.deps.googleApiKey,
          this.deps.googleModel || "gemini-3-flash-preview",
          { insertJob, tenantId, channel },
        ));
      }

      // ── Register image generation handler (no OAuth needed, uses platform API key) ──
      if (this.deps.googleApiKey) {
        const imageStore = this.deps.s3Config
          ? new ImageStore(this.deps.s3Config)
          : null;

        toolExecutor.registerSkill("image_gen", new ImageGenHandler(
          this.deps.googleApiKey,
          { name: tenant.name, memory: memoryContent },
          imageStore,
          {
            tenantId,
            insertGeneratedImage: async (row) => {
              await this.deps.db.insert(schema.generatedImages).values(row);
            },
            createShortLink: async (url: string) => {
              try {
                const shortId = randomBytes(6).toString("base64url");
                await this.deps.db.insert(schema.shortLinks).values({ id: shortId, url });
                return `${this.deps.oauthPortalUrl}/link/${shortId}`;
              } catch {
                return null;
              }
            },
          },
        ));
      }

      // ── Register social media handler (Postiz, no OAuth needed — uses platform API key) ──
      const postizApiKey = process.env.POSTIZ_API_KEY;
      if (postizApiKey) {
        toolExecutor.registerSkill("social_media", new PostizHandler({
          apiKey: postizApiKey,
          baseUrl: process.env.POSTIZ_BASE_URL,
        }));
      }

      // ── Build AI SDK tool definitions only for connected skills ──
      const connectedSkills = this.deps.availableSkills.filter(
        (s) => {
          // social_media needs POSTIZ_API_KEY, not OAuth
          if (s.name === "social_media") return !!postizApiKey;
          return !s.requiresAuth || connectedProviders.includes(s.name);
        }
      );
      const aiTools = skillsToAiTools(connectedSkills);

      // ── Query completed-but-unnotified skill requests for next-conversation fallback ──
      const completedRequests = await this.deps.db.select()
        .from(schema.skillRequests)
        .where(
          and(
            eq(schema.skillRequests.tenantId, tenantId),
            eq(schema.skillRequests.status, "completed"),
            isNull(schema.skillRequests.notifiedAt),
          )
        );

      const completedSkillRequests = completedRequests.map((r) => ({
        skillName: r.skillName,
        context: r.context,
      }));


      // Read pending email drafts for prompt injection
      const memoryBaseDir = process.env.MEMORY_BASE_DIR || "./data/tenants";
      const { EmailDigestRunner } = await import("./email-digest.js");
      const pendingDraftsFile = await EmailDigestRunner.readPendingDrafts(memoryBaseDir, tenantId);
      const pendingDrafts = pendingDraftsFile ? {
        items: pendingDraftsFile.items.map((d) => ({
          index: d.index,
          to: d.to,
          subject: d.subject,
          draftReply: d.draftReply,
        })),
      } : undefined;
      const gmailConnected = connectedProviders.includes("gmail");
      // Build system prompt from soul + memory + skills
      const systemPrompt = PromptBuilder.build({
        soul,
        memory: memoryContent,
        skills: this.deps.availableSkills,
        connections: connectedProviders,
        userName: tenant.name,
        timezone: tenant.timezone ?? "UTC",
        completedSkillRequests,
        pendingDrafts,
        gmailConnected,
      });

      // Create per-request Brain with the tenant's ToolExecutor
      const brain = new Brain(this.deps.llm, toolExecutor);

      // Run the ReAct loop through the Brain
      const result = await brain.process({
        systemPrompt,
        messages: history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        maxTurns: 10,
        tools: aiTools,
      });

      const creditCost = 0;

      // Log usage (fire-and-forget)
      if (this.deps.usageTracker) {
        this.deps.usageTracker.logMessageProcessed({
          tenantId,
          channel,
          toolCallsMade: result.toolCallsMade.map(t => ({
            skillName: t.skillName,
            actionName: t.actionName,
          })),
          usage: result.usage,
          creditCost,
        }).catch(() => {});
      }

      // Store outbound response in session history
      await this.deps.sessions.append(tenantId, sessionId, {
        role: "assistant",
        content: result.content,
        timestamp: new Date(),
      });

      logger.info(
        { tenantId, channel, toolCalls: result.toolCallsMade.length },
        "Message processed",
      );

      // ── Mark completed skill requests as notified ──
      if (completedRequests.length > 0) {
        for (const req of completedRequests) {
          await this.deps.db.update(schema.skillRequests)
            .set({ notifiedAt: new Date() })
            .where(eq(schema.skillRequests.id, req.id));
        }
        logger.info({ tenantId, count: completedRequests.length }, "Marked skill requests as notified");
      }

      // Fire-and-forget memory extraction — don't block the response
      const currentTz = tenant.timezone ?? "UTC";
      setImmediate(async () => {
        try {
          const extractor = new MemoryExtractor(this.deps.llmLite);

          // Build people context for dedup
          const existingPeople = await this.deps.memory.listPeople(tenantId);
          const peopleSummary = existingPeople.map(p =>
            `${p.name}${p.email ? ` <${p.email}>` : ""}: ${p.facts.slice(-3).join("; ") || "no facts yet"}`
          );

          const extraction = await extractor.extractWithPeople({
            existingMemory: memoryContent,
            existingPeople: peopleSummary,
            conversationMessages: [
              { role: "user", content: message.text },
              { role: "assistant", content: result.content },
            ],
            source: "chat",
          });

          // Store general facts in MEMORY.md (same as before)
          if (extraction.generalFacts.length > 0) {
            for (const fact of extraction.generalFacts) {
              await this.deps.memory.appendMemory(tenantId, fact);
            }
            logger.info({ tenantId, facts: extraction.generalFacts.length }, "Extracted general memories");
          }

          // Store people facts in person files
          if (extraction.peopleFacts.length > 0) {
            await this.storePeopleFacts(tenantId, extraction.peopleFacts);
            logger.info({ tenantId, people: extraction.peopleFacts.length }, "Extracted people memories");
          }

          // Timezone auto-detect from general facts (same as before)
          if (currentTz === "UTC") {
            for (const fact of extraction.generalFacts) {
              const detectedTz = timezoneFromText(fact);
              if (detectedTz) {
                await this.deps.db.update(schema.tenants)
                  .set({ timezone: detectedTz })
                  .where(eq(schema.tenants.id, tenantId));
                logger.info({ tenantId, timezone: detectedTz, fact }, "Auto-detected timezone from conversation");
                break;
              }
            }
          }
        } catch (err) {
          logger.error({ err, tenantId }, "Memory extraction failed");
        }
      });

      // ── Complete onboarding after first Brain interaction ──
      let responseText = result.content;
      if (tenant.onboardingPhase === "ready") {
        await this.deps.db.update(schema.tenants)
          .set({ onboardingPhase: "done" })
          .where(eq(schema.tenants.id, tenantId));

        // Seed daily_briefing + memory_scan jobs for new tenant
        const tz = tenant.timezone || "UTC";
        setImmediate(async () => {
          try {
            await this.deps.db.insert(schema.scheduledJobs).values({
              tenantId,
              jobType: "daily_briefing",
              scheduleType: "daily",
              scheduledAt: nextUtcForLocalTime("08:00", tz),
              recurrenceRule: "08:00",
              payload: {},
              status: "active",
            });
            // Weekly memory scan (Wednesday 10 AM local)
            const nextRun = nextUtcForLocalTime("10:00", tz);
            const dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(nextRun);
            const daysMap: Record<string, number> = { Sun: 3, Mon: 2, Tue: 1, Wed: 0, Thu: 6, Fri: 5, Sat: 4 };
            const scheduledAt = new Date(nextRun.getTime() + (daysMap[dayOfWeek] || 0) * 86_400_000);
            await this.deps.db.insert(schema.scheduledJobs).values({
              tenantId,
              jobType: "memory_scan",
              scheduleType: "daily",
              scheduledAt,
              recurrenceRule: "10:00",
              payload: {},
              status: "active",
            });
            // Seed connect_reminder (will fire in 7 days at 6 PM local)
            await this.deps.db.insert(schema.scheduledJobs).values({
              tenantId,
              jobType: "connect_reminder",
              scheduleType: "daily",
              scheduledAt: new Date(nextUtcForLocalTime("18:00", tz).getTime() + 6 * 86_400_000),
              recurrenceRule: "18:00",
              payload: { reminderCount: 0, maxReminders: 4 },
              status: "active",
            });
            logger.info({ tenantId }, "Seeded daily_briefing + memory_scan + connect_reminder for new tenant");
          } catch (err) {
            logger.error({ err, tenantId }, "Failed to seed jobs for new tenant");
          }
        });

        responseText += [
          "",
          "",
          "By the way -- I can also help manage your emails, calendar, and even ads if you use Google.",
          "Want me to connect to any of these? Just say the word.",
        ].join("\n");
      }

      // Check if the Brain produced any image media from tool results
      const imageMedia = result.media?.[0];
      const media = imageMedia
        ? {
            type: "image" as const,
            url: imageMedia.url || `data:${imageMedia.mimeType};base64,${imageMedia.base64 || ""}`,
            mimeType: imageMedia.mimeType,
          }
        : undefined;

      return {
        tenantId,
        channel,
        recipient: sender,
        text: responseText,
        media,
      };
    } catch (err) {
      logger.error({ err, sender, channel }, "Error handling message");
      return {
        tenantId: message.tenantId || "unknown",
        channel,
        recipient: sender,
        text: "Oops! Something went wrong on my end. Please try again in a moment.",
      };
    }
  }

  private static readonly PROVIDER_CONFIGS: Record<string, {
    displayName: string;
    scopes: string[];
    authUrl: string;
  }> = {
    gmail: {
      displayName: "Gmail",
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
      ],
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    },
    google_calendar: {
      displayName: "Google Calendar",
      scopes: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    },
    google_ads: {
      displayName: "Google Ads",
      scopes: [
        "https://www.googleapis.com/auth/adwords",
      ],
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    },
    google_analytics: {
      displayName: "Google Analytics",
      scopes: [
        "https://www.googleapis.com/auth/analytics.readonly",
        "https://www.googleapis.com/auth/analytics.manage.users.readonly",
      ],
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    },
    google_docs: {
      displayName: "Google Docs",
      scopes: [
        "https://www.googleapis.com/auth/drive.file",
      ],
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    },
    jira: {
      displayName: "Jira",
      scopes: [
        "read:jira-work",
        "write:jira-work",
        "read:jira-user",
        "read:servicedesk-request",
        "write:servicedesk-request",
        "offline_access",
      ],
      authUrl: "https://auth.atlassian.com/authorize",
    },
    linkedin: {
      displayName: "LinkedIn",
      scopes: ["openid", "profile", "w_member_social"],
      authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    },
    meta: {
      displayName: "Instagram & Facebook",
      scopes: ["pages_manage_posts", "instagram_basic", "instagram_content_publish"],
      authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    },
  };

  /**
   * Generate an OAuth short link for a provider.
   * Used by both the "connect <provider>" command and the connect_service tool.
   */
  private async generateConnectLink(
    tenantId: string,
    provider: string,
    channel: string,
    sender: string,
  ): Promise<{ success: boolean; shortUrl?: string; fullUrl?: string; displayName: string; error?: string }> {
    const config = MessageHandler.PROVIDER_CONFIGS[provider];
    if (!config) {
      return { success: false, displayName: provider, error: `Connection for "${provider}" is not yet supported.` };
    }

    const state = Buffer.from(JSON.stringify({ tenantId, provider, channel, sender })).toString("base64url");
    const redirectUri = `${this.deps.oauthPortalUrl}/api/callback/${provider}`;

    // Build provider-specific OAuth params
    const isAtlassian = provider === "jira";
    const isLinkedIn = provider === "linkedin";
    const isMeta = provider === "meta";
    const clientId = isAtlassian
      ? this.deps.atlassianClientId
      : isLinkedIn
        ? this.deps.linkedinClientId
        : isMeta
          ? this.deps.metaClientId
          : this.deps.googleClientId;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: config.scopes.join(" "),
      prompt: "consent",
      state,
    });
    if (isAtlassian) {
      params.set("audience", "api.atlassian.com");
    } else if (!isLinkedIn && !isMeta) {
      params.set("access_type", "offline");
    }

    const fullUrl = `${config.authUrl}?${params.toString()}`;

    const shortId = randomBytes(6).toString("base64url");
    try {
      await this.deps.db.insert(schema.shortLinks).values({
        id: shortId,
        url: fullUrl,
      });
    } catch (err) {
      logger.error({ err }, "Failed to create short link, falling back to full URL");
      return { success: true, fullUrl, displayName: config.displayName };
    }

    const shortUrl = `${this.deps.oauthPortalUrl}/link/${shortId}`;
    return { success: true, shortUrl, displayName: config.displayName };
  }

  /**
   * Generate an OAuth authorization URL and send it as a clickable link.
   */
  private async handleConnect(
    tenantId: string,
    provider: string,
    channel: string,
    sender: string,
  ): Promise<OutboundMessage> {
    const link = await this.generateConnectLink(tenantId, provider, channel, sender);
    const url = link.shortUrl || link.fullUrl;

    if (!link.success || !url) {
      return {
        tenantId,
        channel: channel as "telegram" | "whatsapp" | "app",
        recipient: sender,
        text: link.error || `Connection for "${provider}" is not yet supported.`,
      };
    }

    return {
      tenantId,
      channel: channel as "telegram" | "whatsapp" | "app",
      recipient: sender,
      text: `Click the link below to connect your ${link.displayName}:\n\n${url}`,
    };
  }

  private async handleDisconnect(
    tenantId: string,
    provider: string,
    channel: string,
    sender: string,
  ): Promise<OutboundMessage> {
    const displayName = provider.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    // Check if the connection exists
    const existing = await this.deps.db.query.serviceConnections.findFirst({
      where: and(
        eq(schema.serviceConnections.tenantId, tenantId),
        eq(schema.serviceConnections.provider, provider),
      ),
    });

    if (!existing) {
      return {
        tenantId,
        channel: channel as "telegram" | "whatsapp" | "app",
        recipient: sender,
        text: `You don't have ${displayName} connected, so there's nothing to disconnect.`,
      };
    }

    // Delete the service connection from DB
    await this.deps.db.delete(schema.serviceConnections)
      .where(and(
        eq(schema.serviceConnections.tenantId, tenantId),
        eq(schema.serviceConnections.provider, provider),
      ));

    // Remove stored tokens from vault
    try {
      await this.deps.vault.delete(tenantId, provider);
    } catch {
      // Vault removal is best-effort
    }

    logger.info({ tenantId, provider }, "User disconnected service");

    return {
      tenantId,
      channel: channel as "telegram" | "whatsapp" | "app",
      recipient: sender,
      text: `Done — I've disconnected your ${displayName} account. I no longer have access to it. You can reconnect anytime by saying "connect ${provider.replace(/_/g, " ")}".`,
    };
  }

  /**
   * Handle on-demand meeting briefing: find a matching meeting, extract
   * external attendees, research them, and return a formatted briefing.
   */
  private async handleOnDemandBriefing(
    tenantId: string,
    tenant: typeof schema.tenants.$inferSelect,
    meetingQuery?: string,
  ): Promise<Record<string, unknown>> {
    if (!this.deps.peopleConfig?.enabled) {
      return { success: false, error: "People research is not configured." };
    }

    // Get calendar token
    const tokenResult = await ensureValidToken(tenantId, "google_calendar", this.deps.vault, this.deps.db);
    if (!tokenResult || tokenResult.status === "expired") {
      return { success: false, error: "Google Calendar is not connected or the token has expired. Please reconnect by saying 'connect calendar'." };
    }

    // Fetch today's events
    const now = new Date();
    const timezone = tenant.timezone || "UTC";
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dateStr = formatter.format(now);
    const timeMinISO = new Date(`${dateStr}T00:00:00+00:00`).toISOString();
    const timeMaxISO = new Date(`${dateStr}T23:59:59+00:00`).toISOString();

    const calHandler = new GoogleCalendarHandler(tokenResult.accessToken);
    const result = await calHandler.execute("list_events", {
      time_min: timeMinISO,
      time_max: timeMaxISO,
      max_results: 20,
    }) as { events: Array<Record<string, unknown>>; count: number };

    if (result.count === 0) {
      return { success: false, error: "No events on your calendar today." };
    }

    // Fuzzy-match meeting by query
    let matchedEvents = result.events;
    if (meetingQuery) {
      const queryWords = meetingQuery.toLowerCase().split(/\s+/).filter(Boolean);
      matchedEvents = result.events.filter((ev) => {
        const summary = ((ev.summary as string) || "").toLowerCase();
        const start = ((ev.start as string) || "").toLowerCase();
        return queryWords.some((w) => summary.includes(w) || start.includes(w));
      });
      if (matchedEvents.length === 0) {
        // Fall back to all events
        matchedEvents = result.events;
      }
    }

    // Determine tenant domain
    let tenantDomain = tenant.emailDomain as string | null;
    if (!tenantDomain) {
      tenantDomain = this.inferDomainFromEvents(result.events);
      if (tenantDomain) {
        await this.deps.db.update(schema.tenants)
          .set({ emailDomain: tenantDomain })
          .where(eq(schema.tenants.id, tenantId));
      }
    }

    if (!tenantDomain) {
      return { success: false, error: "Could not determine your email domain from calendar events. Please try again after your calendar has events with attendees." };
    }

    // Extract external attendees
    const { MeetingBriefingService } = await import("./meeting-briefing.js");
    const briefingService = new MeetingBriefingService({
      db: this.deps.db,
      vault: this.deps.vault,
      llm: this.deps.llm,
      memory: this.deps.memory,
      availableSkills: this.deps.availableSkills,
      peopleConfig: {
        scrapinApiKey: this.deps.peopleConfig.scrapinApiKey,
        dataforseoLogin: this.deps.peopleConfig.dataforseoLogin,
        dataforseoPassword: this.deps.peopleConfig.dataforseoPassword,
      },
    });

    const internalDomains = ((tenant as Record<string, unknown>).internalDomains as string[]) || [];
    const meetings = briefingService.extractExternalAttendees(matchedEvents, tenantDomain, undefined, internalDomains);
    if (meetings.length === 0) {
      return { success: true, message: "No external attendees found in the matching meeting(s). All attendees appear to be from your organization." };
    }

    const briefing = await briefingService.generateBriefing(meetings, tenantId, tenant.name, timezone);
    return { success: true, briefing };
  }

  /**
   * Infer the tenant's email domain from calendar events by checking
   * organizer or creator email. Skips calendar.google.com domains.
   */
  private inferDomainFromEvents(events: Array<Record<string, unknown>>): string | null {
    for (const event of events) {
      for (const field of ["organizer", "creator"] as const) {
        const entity = event[field] as { email?: string } | undefined;
        if (!entity?.email) continue;

        const domain = entity.email.split("@")[1]?.toLowerCase();
        if (
          domain &&
          domain !== "calendar.google.com" &&
          domain !== "group.calendar.google.com"
        ) {
          return domain;
        }
      }
    }
    return null;
  }

  /**
   * Store people-specific facts into individual person files.
   */
  private async storePeopleFacts(tenantId: string, peopleFacts: PersonFact[]): Promise<void> {
    const datestamp = new Date().toISOString().split("T")[0];
    for (const pf of peopleFacts) {
      const slug = MemoryManager.slugifyName(pf.person);
      const existing = await this.deps.memory.readPerson(tenantId, slug)
        ?? await this.deps.memory.findPersonByEmail(tenantId, pf.email);

      const person = existing ?? {
        name: pf.person, email: pf.email, company: pf.company,
        role: pf.role, aliases: [], facts: [], dates: [], interactions: [],
      };

      for (const fact of pf.facts) person.facts.push(`[${datestamp}] ${fact}`);
      for (const date of pf.dates) person.dates.push(`[${date}]`);
      if (pf.company && !person.company) person.company = pf.company;
      if (pf.role && !person.role) person.role = pf.role;
      if (pf.email && !person.email) person.email = pf.email;

      await this.deps.memory.writePerson(tenantId, person);
    }
  }

  /**
   * Generate 3 tailored suggestions based on the user's role/business.
   * Uses keyword matching — no LLM call needed.
   */
  private generateOnboardingSuggestions(role: string): string[] {
    const lower = role.toLowerCase();

    if (/rice|grain|commodity|agri|farm|crop/.test(lower)) {
      return [
        "What is the current market price of basmati rice?",
        "Remind me to call the supplier tomorrow at 10am",
        "Research top rice exporters in India",
      ];
    }
    if (/market|advertis|ads|digital|seo|social media|agency/.test(lower)) {
      return [
        "Research the latest Google Ads best practices",
        "Remind me to send the campaign report by Friday",
        "Find the marketing head at [competitor company]",
      ];
    }
    if (/real estate|property|broker|construction/.test(lower)) {
      return [
        "Research current real estate trends in my city",
        "Remind me to follow up with the buyer tomorrow",
        "Find contact info for [a developer or agency]",
      ];
    }
    if (/restaurant|food|cafe|hotel|hospitality/.test(lower)) {
      return [
        "Research food delivery trends in 2026",
        "Remind me to order supplies by Thursday",
        "Find contact info for [a food supplier]",
      ];
    }
    if (/retail|shop|store|ecommerce|e-commerce/.test(lower)) {
      return [
        "Research trending products in my category",
        "Remind me to restock inventory this week",
        "Find the supplier for [a product you sell]",
      ];
    }
    if (/consult|freelance|coach|train/.test(lower)) {
      return [
        "Research industry benchmarks for my field",
        "Remind me about the client call tomorrow at 3pm",
        "Find the LinkedIn profile of [a potential client]",
      ];
    }
    if (/doctor|clinic|health|medical|pharma/.test(lower)) {
      return [
        "Research recent developments in [your specialty]",
        "Remind me to review patient files before rounds",
        "Find contact info for [a medical supplier]",
      ];
    }
    if (/law|legal|advocate|attorney/.test(lower)) {
      return [
        "Research recent changes in [area of law]",
        "Remind me about the court hearing on Friday",
        "Find the LinkedIn profile of [opposing counsel]",
      ];
    }
    if (/teach|school|education|tutor|professor/.test(lower)) {
      return [
        "Research new teaching methods for [your subject]",
        "Remind me to prepare lesson plans by Sunday",
        "Find educational resources on [topic]",
      ];
    }

    // Default suggestions that work for anyone
    return [
      "What are the latest trends in my industry?",
      "Remind me to follow up with a client tomorrow at 10am",
      "Find contact info for [a company you're interested in]",
    ];
  }
}
