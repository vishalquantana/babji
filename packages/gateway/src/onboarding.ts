import type { BabjiMessage, OutboundMessage } from "@babji/types";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import type { MemoryManager } from "@babji/memory";
import type { CreditLedger } from "@babji/credits";
import { randomUUID } from "node:crypto";

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

    // Simple heuristic: treat as a name if 2-50 chars and contains at least one letter
    if (this.looksLikeName(trimmed)) {
      const tenantId = randomUUID();
      const name = trimmed;

      // Create tenant in DB
      await this.deps.db.insert(schema.tenants).values({
        id: tenantId,
        name,
        phone: channel === "whatsapp" ? message.sender : null,
        telegramUserId: channel === "telegram" ? message.sender : null,
        plan: "free",
        timezone: "UTC", // default — can be changed later
        containerStatus: "provisioning",
      });

      // Initialize memory files and credits in parallel
      await Promise.all([
        this.deps.memory.initialize(tenantId),
        this.deps.credits.initializeForTenant(tenantId),
      ]);

      return this.reply(message, this.onboardedMessage(name));
    }

    // Could not understand the input — ask again
    return this.reply(message, this.welcomeMessage());
  }

  private looksLikeName(value: string): boolean {
    return value.length >= 2 && value.length <= 50 && /[a-zA-Z]/.test(value);
  }

  private welcomeMessage(): string {
    return [
      "Hey there! I'm Babji, your AI business assistant.",
      "",
      "I can help you manage your email, calendar, social media, ads, and more — all through this chat!",
      "",
      "To get started, what should I call you?",
    ].join("\n");
  }

  private onboardedMessage(name: string): string {
    return [
      `Nice to meet you, ${name}!`,
      "",
      "You're all set up with 5 free daily credits (I call them 'juice').",
      "",
      "Here's what I can help with:",
      "- Email: read, send, block, unsubscribe",
      "- Calendar: view, create, reschedule events",
      "- Social media: post to Instagram, Facebook, LinkedIn, X",
      "- Ads: manage Google Ads and Meta Ads campaigns",
      "",
      "To get started, just connect a service by saying something like 'connect my Gmail'.",
      "",
      "What would you like to do first?",
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
