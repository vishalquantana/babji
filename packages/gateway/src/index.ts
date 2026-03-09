import { loadConfig, validateConfig } from "./config.js";
import { createServer } from "./server.js";
import { createDb, schema } from "@babji/db";
import { eq } from "drizzle-orm";
import { MemoryManager, SessionStore } from "@babji/memory";
import { CreditLedger } from "@babji/credits";
import { TokenVault } from "@babji/crypto";
import { MultiModelLlmClient } from "@babji/agent";
import { SkillRequestManager, loadSkillDefinitions } from "@babji/skills";
import { TenantResolver } from "./tenant-resolver.js";
import { OnboardingHandler } from "./onboarding.js";
import { MessageHandler } from "./message-handler.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { WhatsAppAdapter } from "./adapters/whatsapp.js";
import type { ChannelAdapter } from "./adapters/types.js";
import { JobRunner } from "./job-runner.js";
import { AdminNotifier } from "./admin-notifier.js";
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

  // Lightweight LLM for background tasks (memory extraction, summaries)
  const llmLite = new MultiModelLlmClient({
    primaryProvider: "google",
    fallbackProviders: [],
    googleApiKey: config.googleApiKey,
    googleModelOverride: process.env.GOOGLE_LITE_MODEL || "gemini-2.0-flash-lite",
  });

  const tenantResolver = new TenantResolver(db);

  // Onboarding handler for new users
  const onboarding = new OnboardingHandler({ db, memory, credits });

  // Skill request manager for "check with my teacher" flow
  const skillRequests = new SkillRequestManager(db);

  // Admin notifier for skill requests
  if (config.adminBot.enabled) {
    const jiraConfig = config.jira.enabled ? {
      host: config.jira.host,
      email: config.jira.email,
      apiToken: config.jira.apiToken,
      projectKey: config.jira.projectKey,
    } : undefined;
    const adminNotifier = new AdminNotifier(config.adminBot.botToken, config.adminBot.chatId, jiraConfig);
    skillRequests.onCreated(async (tenantId, skillName, context) => {
      const tenant = await db.query.tenants.findFirst({
        where: eq(schema.tenants.id, tenantId),
      });
      await adminNotifier.notifySkillRequest(
        tenant?.name || tenantId,
        skillName,
        context,
      );
    });
    logger.info("Admin bot notifications enabled");
  }

  // Load skill definitions
  const availableSkills = loadSkillDefinitions();
  logger.info({ skills: availableSkills.map((s) => s.name) }, "Loaded skill definitions");

  // Create message handler (end-to-end pipeline)
  const handler = new MessageHandler({
    memory,
    sessions,
    credits,
    llm,
    llmLite,
    availableSkills,
    tenantResolver,
    onboarding,
    skillRequests,
    db,
    vault,
    oauthPortalUrl: process.env.OAUTH_PORTAL_URL || "https://babji.quantana.top",
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleAdsDeveloperToken: config.googleAdsDeveloperToken,
    peopleConfig: config.people,
    googleApiKey: config.googleApiKey,
    googleModel: process.env.GOOGLE_MODEL || "gemini-3-flash-preview",
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

  // Start the scheduled job runner
  const jobRunner = new JobRunner({ db, vault, adapters });
  jobRunner.start();

  // Create and start HTTP server
  const server = createServer({ config, db, handler, adapters });
  await server.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port, channels: adapters.map((a) => a.name) }, "Babji Gateway running");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    jobRunner.stop();
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
