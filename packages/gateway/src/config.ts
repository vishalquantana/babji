export interface GatewayConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  memoryBaseDir: string;
  encryptionKey: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  googleApiKey: string;
  whatsapp: {
    enabled: boolean;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
  };
}

export function loadConfig(): GatewayConfig {
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl:
      process.env.DATABASE_URL ||
      "postgres://babji:babji_dev@localhost:5432/babji",
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
    memoryBaseDir: process.env.MEMORY_BASE_DIR || "./data/tenants",
    encryptionKey: process.env.ENCRYPTION_KEY || "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    googleApiKey: process.env.GOOGLE_API_KEY || "",
    whatsapp: {
      enabled: process.env.WHATSAPP_ENABLED !== "false",
    },
    telegram: {
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    },
  };
}
