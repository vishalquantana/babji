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
import { MessageNormalizer } from "./message-normalizer.js";
import { MessageHandler } from "./message-handler.js";
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
    primaryProvider: "anthropic",
    fallbackProviders: ["openai", "google"],
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

  // Create and start HTTP server
  const server = createServer(config, db);
  await server.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port }, "Babji Gateway running");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
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
