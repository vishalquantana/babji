import type { BabjiMessage, OutboundMessage } from "@babji/types";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import type { MemoryManager } from "@babji/memory";
import type { CreditLedger } from "@babji/credits";
import { randomUUID } from "node:crypto";
import { timezoneFromPhone } from "./phone-timezone.js";

export interface OnboardingDeps {
  db: Database;
  memory: MemoryManager;
  credits: CreditLedger;
}

export class OnboardingHandler {
  constructor(private deps: OnboardingDeps) {}

  /**
   * Handle a message from an unknown sender (no tenant record).
   *
   * Stateless flow:
   *   - Empty / unrecognizable text  -> welcome prompt asking for name
   *   - Valid name (2-50 chars, has a letter) -> create tenant, init memory + credits
   */
  async handle(message: BabjiMessage): Promise<OutboundMessage> {
    const { channel, text } = message;

    // First message or empty text — welcome and ask for name
    if (!text || text.trim().length === 0) {
      return this.reply(message, this.welcomeMessage());
    }

    const trimmed = text.trim();

    // Treat Telegram /commands (e.g. /start) as a greeting, not a name
    if (trimmed.startsWith("/")) {
      return this.reply(message, this.welcomeMessage());
    }

    // Simple heuristic: treat as a name if 2-50 chars and contains at least one letter
    if (this.looksLikeName(trimmed)) {
      const tenantId = randomUUID();
      const name = trimmed;

      // Detect timezone from phone country code (WhatsApp users)
      const phone = channel === "whatsapp" ? message.sender : null;
      const detectedTz = timezoneFromPhone(phone);

      // Create tenant in DB
      await this.deps.db.insert(schema.tenants).values({
        id: tenantId,
        name,
        phone,
        telegramUserId: channel === "telegram" ? message.sender : null,
        plan: "free",
        timezone: detectedTz ?? "UTC",
        containerStatus: "provisioning",
        onboardingPhase: "role",
      });

      // Initialize memory files and credits in parallel
      await Promise.all([
        this.deps.memory.initialize(tenantId),
        this.deps.credits.initializeForTenant(tenantId),
      ]);

      return this.reply(message, this.onboardedMessage(name, channel));
    }

    // Could not understand the input — ask again
    return this.reply(message, this.welcomeMessage());
  }

  private looksLikeName(value: string): boolean {
    if (value.length < 2 || value.length > 50 || !/[a-zA-Z]/.test(value)) {
      return false;
    }

    // Common greetings and phrases that aren't names
    const notNames = new Set([
      "hello", "hi", "hey", "hiya", "howdy", "sup",
      "yo", "hola", "help", "start", "begin",
      "yes", "no", "ok", "okay", "sure", "thanks",
      "thank you", "good morning", "good evening",
      "good afternoon", "good night", "what", "who",
      "how", "why", "test", "testing",
    ]);

    return !notNames.has(value.toLowerCase());
  }

  private welcomeMessage(): string {
    return [
      "Hey there! I'm Babji -- think of me as your business helper who lives right here in this chat.",
      "",
      "What should I call you?",
    ].join("\n");
  }

  private onboardedMessage(name: string, _channel: string): string {
    return [
      `Nice to meet you, ${name}!`,
      "",
      "Quick question -- what kind of work do you do?",
      "Just tell me in a line, like \"I run a rice shop\" or \"I do digital marketing\".",
    ].join("\n");
  }

  private reply(original: BabjiMessage, text: string): OutboundMessage {
    return {
      tenantId: "onboarding",
      channel: original.channel,
      recipient: original.sender,
      text,
    };
  }
}
