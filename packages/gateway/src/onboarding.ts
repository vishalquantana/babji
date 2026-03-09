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

    // User asked a question or made a request instead of providing a name
    if (this.looksLikeQuestionOrRequest(trimmed)) {
      return this.reply(message, this.deflectQuestionMessage());
    }

    // Simple heuristic: treat as a name if short, has a letter, doesn't look like a sentence
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

    const lower = value.toLowerCase();

    // Common greetings and phrases that aren't names
    const notNames = new Set([
      "hello", "hi", "hey", "hiya", "howdy", "sup",
      "yo", "hola", "help", "start", "begin",
      "yes", "no", "ok", "okay", "sure", "thanks",
      "thank you", "good morning", "good evening",
      "good afternoon", "good night", "what", "who",
      "how", "why", "test", "testing",
    ]);

    if (notNames.has(lower)) return false;

    // Questions (contains ?) or starts with question words followed by more text
    if (value.includes("?")) return false;
    if (/^(what|how|why|when|where|who|can|could|will|would|do|does|is|are|should|tell)\b/i.test(value)) return false;

    // Sentences — names rarely have 5+ words
    const wordCount = value.split(/\s+/).length;
    if (wordCount > 4) return false;

    // Contains verbs/phrases that indicate a statement, not a name
    if (/\b(make|help|want|need|like|please|work|show|give|get|find|know|think|have)\b/i.test(lower) && wordCount > 2) return false;

    return true;
  }

  /** Check if user is asking a question or making a request instead of providing their name */
  looksLikeQuestionOrRequest(value: string): boolean {
    const lower = value.toLowerCase().trim();
    if (lower.includes("?")) return true;
    if (/^(what|how|why|when|where|who|can|could|will|would|do|does|is|are|should|tell)\b/i.test(lower)) return true;
    if (/\b(help|want|need|make|show|give|find)\b/i.test(lower) && lower.split(/\s+/).length > 2) return true;
    return false;
  }

  private welcomeMessage(): string {
    return [
      "Hey there! I'm Babji -- think of me as your business helper who lives right here in this chat.",
      "",
      "What should I call you?",
    ].join("\n");
  }

  private deflectQuestionMessage(): string {
    return [
      "I can definitely help with that! But first, let me get to know you.",
      "",
      "What's your name?",
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
