import { loadConfig, validateConfig } from "./config.js";
import { createServer } from "./server.js";
import { createDb } from "@babji/db";
import { MemoryManager, SessionStore } from "@babji/memory";
import { CreditLedger } from "@babji/credits";
import { TokenVault } from "@babji/crypto";
import { MultiModelLlmClient } from "@babji/agent";
import { SkillRequestManager } from "@babji/skills";
import { TenantResolver } from "./tenant-resolver.js";
import { OnboardingHandler } from "./onboarding.js";
import { MessageHandler } from "./message-handler.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { WhatsAppAdapter } from "./adapters/whatsapp.js";
import type { ChannelAdapter } from "./adapters/types.js";
import { logger } from "./logger.js";

async function main() {
  const config = loadConfig();
  validateConfig(config);

  // Initialize shared services
  const { db, close } = createDb(config.databaseUrl);
  const memory = new MemoryManager(config.memoryBaseDir);
  const sessions = new SessionStore(config.memoryBaseDir);
  const credits = new CreditLedger(db);
  const vault = new TokenVault(config.memoryBaseDir, config.encryptionKey);

  const llm = new MultiModelLlmClient({
    primaryProvider: "google",
    fallbackProviders: ["anthropic", "openai"],
    anthropicApiKey: config.anthropicApiKey,
    openaiApiKey: config.openaiApiKey,
    googleApiKey: config.googleApiKey,
  });

  const tenantResolver = new TenantResolver(db);

  // Onboarding handler for new users
  const onboarding = new OnboardingHandler({ db, memory, credits });

  // Skill request manager for "check with my teacher" flow
  const skillRequests = new SkillRequestManager(db);

  // Create message handler (end-to-end pipeline)
  const handler = new MessageHandler({
    memory,
    sessions,
    credits,
    llm,
    availableSkills: [], // TODO: load from skill registry
    tenantResolver,
    onboarding,
    skillRequests,
  });

  // Start channel adapters
  const adapters: ChannelAdapter[] = [];

  if (config.telegram.enabled) {
    const telegram = new TelegramAdapter(config.telegram.botToken, tenantResolver);
    telegram.onMessage(async (msg) => {
      const response = await handler.handle(msg);
      await telegram.sendMessage(response);
    });
    await telegram.start();
    adapters.push(telegram);
  }

  if (config.whatsapp.enabled) {
    const whatsapp = new WhatsAppAdapter(tenantResolver, db);
    whatsapp.onMessage(async (msg) => {
      const response = await handler.handle(msg);
      await whatsapp.sendMessage(response);
    });
    await whatsapp.start();
    adapters.push(whatsapp);
  }

  if (adapters.length === 0) {
    logger.warn("No channel adapters enabled. Set TELEGRAM_BOT_TOKEN or WHATSAPP_ENABLED=true.");
  }

  // Create and start HTTP server
  const server = createServer(config, db);
  await server.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port, channels: adapters.map((a) => a.name) }, "Babji Gateway running");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    for (const adapter of adapters) {
      await adapter.stop();
    }
    await server.close();
    await close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, "Gateway startup failed");
  process.exit(1);
});
