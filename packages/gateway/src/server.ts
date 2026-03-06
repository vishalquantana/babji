import Fastify from "fastify";
import { sql } from "drizzle-orm";
import type { GatewayConfig } from "./config.js";
import type { Database } from "@babji/db";

const startedAt = Date.now();

export function createServer(config: GatewayConfig, db?: Database) {
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

  return app;
}
