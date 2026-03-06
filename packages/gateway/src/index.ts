import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { createDb } from "@babji/db";
import { MemoryManager, SessionStore } from "@babji/memory";
import { CreditLedger } from "@babji/credits";
import { TokenVault } from "@babji/crypto";
import { MultiModelLlmClient } from "@babji/agent";
import { TenantResolver } from "./tenant-resolver.js";
import { MessageNormalizer } from "./message-normalizer.js";
import { MessageHandler } from "./message-handler.js";

async function main() {
  const config = loadConfig();

  // Initialize shared services
  const { db, close } = createDb(config.databaseUrl);
  const memory = new MemoryManager(config.memoryBaseDir);
  const sessions = new SessionStore(config.memoryBaseDir);
  const credits = new CreditLedger(db);
  const vault = new TokenVault(config.memoryBaseDir, config.encryptionKey);

  const llm = new MultiModelLlmClient({
    primaryProvider: "anthropic",
    fallbackProviders: ["openai", "google"],
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    googleApiKey: process.env.GOOGLE_API_KEY,
  });

  const tenantResolver = new TenantResolver(db);

  // Create message handler (end-to-end pipeline)
  const handler = new MessageHandler({
    db,
    memory,
    sessions,
    credits,
    vault,
    llm,
    availableSkills: [], // TODO: load from skill registry
  });

  // Create and start HTTP server
  const server = createServer(config);
  await server.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Babji Gateway running on port ${config.port}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down...");
    await server.close();
    await close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Gateway startup failed:", err);
  process.exit(1);
});
