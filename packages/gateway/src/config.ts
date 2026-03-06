export interface GatewayConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
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
    whatsapp: {
      enabled: process.env.WHATSAPP_ENABLED !== "false",
    },
    telegram: {
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    },
  };
}
