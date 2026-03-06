import Fastify from "fastify";
import type { GatewayConfig } from "./config.js";

export function createServer(config: GatewayConfig) {
  const app = Fastify({ logger: true });
  app.get("/health", async () => ({ status: "ok" }));
  return app;
}
