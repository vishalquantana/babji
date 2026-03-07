import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { GatewayConfig } from "./config.js";
import type { Database } from "@babji/db";
import type { MessageHandler } from "./message-handler.js";
import type { ChannelAdapter } from "./adapters/types.js";
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

  return app;
}
