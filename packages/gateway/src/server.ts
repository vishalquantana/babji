import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import type { GatewayConfig } from "./config.js";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import type { MessageHandler } from "./message-handler.js";
import type { ChannelAdapter } from "./adapters/types.js";
import { nextUtcForLocalTime } from "./job-runner.js";
import { logger } from "./logger.js";

const startedAt = Date.now();

interface ServerDeps {
  config: GatewayConfig;
  db?: Database;
  handler?: MessageHandler;
  adapters?: ChannelAdapter[];
}

export function createServer({ config, db, handler, adapters }: ServerDeps) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({
    status: "ok",
    version: "0.1.0",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  }));

  app.get("/ready", async (_request, reply) => {
    if (!db) {
      return reply.status(503).send({ status: "not_ready", reason: "no db configured" });
    }

    try {
      await db.execute(sql`SELECT 1`);
      return { status: "ready" };
    } catch (err) {
      return reply.status(503).send({ status: "not_ready", reason: "db unreachable" });
    }
  });

  // Called by the OAuth portal after a successful connection
  app.post("/api/connect-complete", async (request, reply) => {
    const { tenantId, provider, channel, sender } = request.body as {
      tenantId: string;
      provider: string;
      channel: string;
      sender: string;
    };

    if (!tenantId || !provider || !channel || !sender) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    if (!handler || !adapters) {
      return reply.status(503).send({ error: "Gateway not ready" });
    }

    // Find the adapter for this channel
    const adapter = adapters.find((a) => a.name === channel);
    if (!adapter) {
      return reply.status(400).send({ error: `No adapter for channel: ${channel}` });
    }

    logger.info({ tenantId, provider, channel }, "Post-connect: sending confirmation and inbox summary");

    // Provider display names and post-connect prompts
    const providerMeta: Record<string, { displayName: string; prompt: string }> = {
      gmail: {
        displayName: "Gmail",
        prompt: "I just connected my Gmail. Give me a quick summary of my inbox — how many unread emails, and briefly mention the most recent 3-5 messages.",
      },
      google_calendar: {
        displayName: "Google Calendar",
        prompt: "I just connected my Google Calendar. Show me what's on my calendar for the rest of today and tomorrow.",
      },
    };
    const meta = providerMeta[provider] || {
      displayName: provider,
      prompt: `I just connected ${provider}. Give me a quick summary of what you can see.`,
    };

    // Auto-seed scheduled jobs for newly connected services
    if (provider === "google_calendar" && db) {
      try {
        // Check if a daily_calendar_summary job already exists for this tenant
        const existing = await db.query.scheduledJobs.findFirst({
          where: and(
            eq(schema.scheduledJobs.tenantId, tenantId),
            eq(schema.scheduledJobs.jobType, "daily_calendar_summary"),
          ),
        });

        if (!existing) {
          // Look up tenant timezone
          const tenant = await db.query.tenants.findFirst({
            where: eq(schema.tenants.id, tenantId),
          });
          const timezone = tenant?.timezone || "UTC";
          const scheduledAt = nextUtcForLocalTime("07:30", timezone);

          await db.insert(schema.scheduledJobs).values({
            tenantId,
            jobType: "daily_calendar_summary",
            scheduleType: "daily",
            scheduledAt,
            recurrenceRule: "07:30",
            payload: {},
            status: "active",
          });

          logger.info({ tenantId, scheduledAt: scheduledAt.toISOString() }, "Seeded daily calendar summary job");
        }
      } catch (err) {
        logger.error({ err, tenantId }, "Failed to seed calendar summary job");
      }
    }

    // Fire and forget — don't block the OAuth callback
    setImmediate(async () => {
      try {
        // 1. Send immediate confirmation
        await adapter.sendMessage({
          tenantId,
          channel: channel as "telegram" | "whatsapp" | "app",
          recipient: sender,
          text: `${meta.displayName} connected! Let me take a look...`,
        });

        // 2. Trigger summary through the Brain
        const syntheticMessage = {
          id: randomUUID(),
          tenantId,
          channel: channel as "telegram" | "whatsapp" | "app",
          sender,
          text: meta.prompt,
          timestamp: new Date(),
        };

        const response = await handler.handle(syntheticMessage);
        await adapter.sendMessage(response);
        logger.info({ tenantId, provider }, "Post-connect summary sent");
      } catch (err) {
        logger.error({ err, tenantId }, "Post-connect summary failed");
      }
    });

    return { ok: true };
  });

  // Called by the admin dashboard when a skill request is completed
  app.post("/api/notify-skill-ready", async (request, reply) => {
    const { skillRequestId } = request.body as { skillRequestId: string };

    if (!skillRequestId) {
      return reply.status(400).send({ error: "Missing skillRequestId" });
    }
    if (!db || !handler || !adapters) {
      return reply.status(503).send({ error: "Gateway not ready" });
    }

    // Look up the skill request
    const skillRequest = await db.query.skillRequests.findFirst({
      where: eq(schema.skillRequests.id, skillRequestId),
    });
    if (!skillRequest) {
      return reply.status(404).send({ error: "Skill request not found" });
    }

    // Look up the tenant to get their Telegram ID
    const tenant = await db.query.tenants.findFirst({
      where: eq(schema.tenants.id, skillRequest.tenantId),
    });
    if (!tenant || !tenant.telegramUserId) {
      return reply.status(400).send({ error: "Tenant has no Telegram ID" });
    }

    // Find the Telegram adapter
    const adapter = adapters.find((a) => a.name === "telegram");
    if (!adapter) {
      return reply.status(503).send({ error: "Telegram adapter not available" });
    }

    // Fire and forget — send notification through Brain
    setImmediate(async () => {
      try {
        const syntheticMessage = {
          id: randomUUID(),
          tenantId: skillRequest.tenantId,
          channel: "telegram" as const,
          sender: tenant.telegramUserId!,
          text: `[SYSTEM] A skill the user previously requested is now ready. Skill: "${skillRequest.skillName}". Their original request was: "${skillRequest.context}". Let them know this capability is now available, remind them what they asked for, and offer to help them try it out. Be brief and conversational.`,
          timestamp: new Date(),
        };

        const response = await handler.handle(syntheticMessage);
        await adapter.sendMessage(response);

        // Mark as notified
        await db
          .update(schema.skillRequests)
          .set({ notifiedAt: new Date() })
          .where(eq(schema.skillRequests.id, skillRequestId));

        logger.info(
          { skillRequestId, tenantId: skillRequest.tenantId },
          "Skill-ready notification sent"
        );
      } catch (err) {
        logger.error({ err, skillRequestId }, "Skill-ready notification failed");
      }
    });

    return { ok: true };
  });

  // Admin endpoint: get all conversation sessions for a tenant
  app.get("/api/admin/sessions/:tenantId", async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };

    if (!tenantId) {
      return reply.status(400).send({ error: "Missing tenantId" });
    }

    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const baseDir = process.env.MEMORY_BASE_DIR || "./data/tenants";
      const sessionsDir = path.join(baseDir, tenantId, "sessions");

      let files: string[];
      try {
        files = await fs.readdir(sessionsDir);
      } catch {
        return reply.send({ sessions: [] });
      }

      const sessions = [];
      for (const file of files.filter((f) => f.endsWith(".jsonl"))) {
        const sessionId = file.replace(".jsonl", "");
        const content = await fs.readFile(path.join(sessionsDir, file), "utf-8");
        const messages = content
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        if (messages.length > 0) {
          sessions.push({
            sessionId,
            messageCount: messages.length,
            lastMessage: messages[messages.length - 1]?.timestamp,
            messages,
          });
        }
      }

      // Sort by most recent activity
      sessions.sort(
        (a, b) => new Date(b.lastMessage || 0).getTime() - new Date(a.lastMessage || 0).getTime(),
      );

      return reply.send({ sessions });
    } catch (err) {
      logger.error({ err, tenantId }, "Failed to read sessions");
      return reply.status(500).send({ error: "Failed to read sessions" });
    }
  });

  return app;
}
