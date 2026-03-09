import { randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import type { BabjiMessage, OutboundMessage, SkillDefinition } from "@babji/types";
import { Brain, PromptBuilder, ToolExecutor, skillsToAiTools, MemoryExtractor } from "@babji/agent";
import type { LlmClient } from "@babji/agent";
import { MemoryManager, SessionStore } from "@babji/memory";
import { CreditLedger } from "@babji/credits";
import { TokenVault } from "@babji/crypto";
import { GmailHandler, GoogleCalendarHandler, GoogleAdsHandler, GoogleAnalyticsHandler, PeopleHandler, TodosHandler, GeneralResearchHandler } from "@babji/skills";
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

/** Pattern to detect "connect <something>" commands */
const CONNECT_PREFIX_RE = /^connect\s+(?:my\s+|to\s+(?:my\s+)?)?(.+?)\s*$/i;

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
  credits: CreditLedger;
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
  googleAdsDeveloperToken: string;
  peopleConfig?: {
    enabled: boolean;
    scrapinApiKey: string;
    dataforseoLogin: string;
    dataforseoPassword: string;
  };
  googleApiKey: string;
  googleModel: string;
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
        // If onboarding just created a Telegram user, it asked for their phone number.
        // Flag this so we know to intercept the next numeric message as a phone number.
        if (channel === "telegram" && result.tenantId !== "onboarding") {
          this.askedForPhone.add(result.tenantId);
        }
        return result;
      }

      const tenantId = tenant.id;

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
              text: [
                `Saved! ${tzNote}`,
                "",
                "Here's what I can help with:",
                "- Email: read, send, block, unsubscribe",
                "- Calendar: view, create, reschedule events",
                "- Social media: post to Instagram, Facebook, LinkedIn, X",
                "- Ads: manage Google Ads and Meta Ads campaigns",
                "",
                "To get started, just connect a service by saying something like 'connect my Gmail'.",
                "",
                "What would you like to do first?",
              ].join("\n"),
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
            text: [
              "No worries! Here's what I can help with:",
              "- Email: read, send, block, unsubscribe",
              "- Calendar: view, create, reschedule events",
              "- Social media: post to Instagram, Facebook, LinkedIn, X",
              "- Ads: manage Google Ads and Meta Ads campaigns",
              "",
              "To get started, just connect a service by saying something like 'connect my Gmail'.",
              "",
              "What would you like to do first?",
            ].join("\n"),
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
          continue;
        }

        const accessToken = tokenResult.accessToken;

        if (conn.provider === "gmail") {
          toolExecutor.registerSkill("gmail", new GmailHandler(accessToken));
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
      }

      // If any tokens are expired, tell the user before proceeding
      if (expiredProviders.length > 0) {
        const providerNames = expiredProviders.map((p) => p.replace(/_/g, " ")).join(", ");
        const reconnectCmds = expiredProviders.map((p) => `"connect ${p.replace("google_", "")}"`).join(" or ");

        // Remove expired providers from connected list so the Brain doesn't try to use them
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

        // Some expired — prepend a warning to the response later
        // Update connectedProviders to only include valid ones
        connectedProviders.length = 0;
        connectedProviders.push(...validProviders);
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
              return { success: false, error: `Unknown service "${raw}". Available: gmail, google_calendar, google_ads, google_analytics` };
            }
            const link = await this.generateConnectLink(tenantId, provider, channel, sender);
            return link;
          }
          // Task actions: add_task, list_tasks, complete_task, update_task, delete_task
          const taskActions = ["add_task", "list_tasks", "complete_task", "update_task", "delete_task"];
          if (taskActions.includes(actionName)) {
            return todosHandler.execute(actionName, params);
          }
          throw new Error(`Unknown babji action: ${actionName}`);
        },
      });

      // ── Register people research handler (server-side keys, always available) ──
      if (this.deps.peopleConfig?.enabled) {
        toolExecutor.registerSkill("people", new PeopleHandler(
          { login: this.deps.peopleConfig.dataforseoLogin, password: this.deps.peopleConfig.dataforseoPassword },
          { apiKey: this.deps.peopleConfig.scrapinApiKey },
        ));
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

      // ── Build AI SDK tool definitions only for connected skills ──
      const connectedSkills = this.deps.availableSkills.filter(
        (s) => !s.requiresAuth || connectedProviders.includes(s.name)
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

      // Build system prompt from soul + memory + skills
      const systemPrompt = PromptBuilder.build({
        soul,
        memory: memoryContent,
        skills: this.deps.availableSkills,
        connections: connectedProviders,
        userName: tenant.name,
        timezone: tenant.timezone ?? "UTC",
        completedSkillRequests,
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

      // Deduct credits when the brain invoked tool actions
      if (result.toolCallsMade.length > 0) {
        const hasCredits = await this.deps.credits.hasCredits(tenantId, 1);
        if (hasCredits) {
          await this.deps.credits.deduct(
            tenantId,
            1,
            `Action: ${result.toolCallsMade.map((t) => t.actionName).join(", ")}`,
          );
        } else {
          logger.warn({ tenantId }, "Insufficient credits for tool call deduction");
        }
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
          const facts = await extractor.extract({
            existingMemory: memoryContent,
            conversationMessages: [
              { role: "user", content: message.text },
              { role: "assistant", content: result.content },
            ],
          });
          if (facts.length > 0) {
            for (const fact of facts) {
              await this.deps.memory.appendMemory(tenantId, fact);
            }
            logger.info({ tenantId, facts: facts.length }, "Extracted new memories");

            // If timezone is still UTC, try to detect from extracted location facts
            if (currentTz === "UTC") {
              for (const fact of facts) {
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
          }
        } catch (err) {
          logger.error({ err, tenantId }, "Memory extraction failed");
        }
      });

      return {
        tenantId,
        channel,
        recipient: sender,
        text: result.content,
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
    const params = new URLSearchParams({
      client_id: this.deps.googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: config.scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });

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
}
