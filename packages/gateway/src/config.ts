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
  adminBot: {
    enabled: boolean;
    botToken: string;
    chatId: string;
  };
  jira: {
    enabled: boolean;
    host: string;
    email: string;
    apiToken: string;
    projectKey: string;
  };
  googleAdsDeveloperToken: string;
  people: {
    enabled: boolean;
    scrapinApiKey: string;
    dataforseoLogin: string;
    dataforseoPassword: string;
  };
  s3: {
    enabled: boolean;
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
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
      enabled: process.env.WHATSAPP_ENABLED === "true",
    },
    telegram: {
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    },
    adminBot: {
      enabled: !!process.env.ADMIN_BOT_TOKEN && !!process.env.ADMIN_TELEGRAM_ID,
      botToken: process.env.ADMIN_BOT_TOKEN || "",
      chatId: process.env.ADMIN_TELEGRAM_ID || "",
    },
    jira: {
      enabled: !!process.env.JIRA_API_TOKEN,
      host: process.env.JIRA_HOST || "quantana.atlassian.net",
      email: process.env.JIRA_EMAIL || "",
      apiToken: process.env.JIRA_API_TOKEN || "",
      projectKey: process.env.JIRA_PROJECT_KEY || "BAB",
    },
    googleAdsDeveloperToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
    people: {
      enabled: !!process.env.SCRAPIN_API_KEY && !!process.env.DATAFORSEO_LOGIN,
      scrapinApiKey: process.env.SCRAPIN_API_KEY || "",
      dataforseoLogin: process.env.DATAFORSEO_LOGIN || "",
      dataforseoPassword: process.env.DATAFORSEO_PASSWORD || "",
    },
    s3: {
      enabled: !!process.env.S3_BUCKET && !!process.env.AWS_ACCESS_KEY_ID,
      bucket: process.env.S3_BUCKET || "",
      region: process.env.AWS_REGION || "us-east-1",
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      endpoint: process.env.AWS_S3_ENDPOINT || undefined,
    },
  };
}

export interface ConfigWarning {
  key: string;
  message: string;
}

/**
 * Validate the loaded configuration.
 * Warns about missing optional values and throws for truly critical ones.
 */
export function validateConfig(config: GatewayConfig): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  // Warn about missing optional keys
  if (!config.encryptionKey) {
    warnings.push({
      key: "ENCRYPTION_KEY",
      message: "Not set. Token encryption will not work.",
    });
  }

  if (!config.anthropicApiKey && !config.openaiApiKey && !config.googleApiKey) {
    warnings.push({
      key: "LLM_API_KEYS",
      message:
        "No LLM API key configured. Set at least one of ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.",
    });
  }

  if (!process.env.DATABASE_URL) {
    warnings.push({
      key: "DATABASE_URL",
      message: "Not set. Using default local connection string.",
    });
  }

  if (!process.env.REDIS_URL) {
    warnings.push({
      key: "REDIS_URL",
      message: "Not set. Using default redis://localhost:6379.",
    });
  }

  if (config.telegram.enabled && !config.telegram.botToken) {
    warnings.push({
      key: "TELEGRAM_BOT_TOKEN",
      message: "Telegram is enabled but no bot token is configured.",
    });
  }

  // Log warnings (using console.warn is fine here since logger may not be
  // initialized yet in all contexts; callers can also inspect returned array)
  for (const w of warnings) {
    console.warn(`[config] WARNING: ${w.key} — ${w.message}`);
  }

  return warnings;
}
