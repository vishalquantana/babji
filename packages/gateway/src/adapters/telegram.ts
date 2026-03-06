import { Bot } from "grammy";
import type { ChannelAdapter } from "./types.js";
import type { BabjiMessage, OutboundMessage } from "@babji/types";
import { MessageNormalizer } from "../message-normalizer.js";
import { TenantResolver } from "../tenant-resolver.js";

export class TelegramAdapter implements ChannelAdapter {
  name = "telegram";
  private bot: Bot;
  private messageHandler: ((msg: BabjiMessage) => Promise<void>) | null = null;

  constructor(
    botToken: string,
    private tenantResolver: TenantResolver
  ) {
    this.bot = new Bot(botToken);
  }

  onMessage(handler: (message: BabjiMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    this.bot.on("message:text", async (ctx) => {
      const telegramUserId = String(ctx.from.id);
      let tenant = await this.tenantResolver.resolveByTelegramId(telegramUserId);
      const tenantId = tenant?.id || "onboarding:tg:" + telegramUserId;

      const normalized = MessageNormalizer.fromTelegram(
        {
          message_id: ctx.message.message_id,
          from: ctx.from,
          text: ctx.message.text,
          date: ctx.message.date,
        },
        tenantId
      );

      if (this.messageHandler) {
        await this.messageHandler(normalized);
      }
    });

    this.bot.start();
    console.log("Telegram bot started.");
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    await this.bot.api.sendMessage(message.recipient, message.text);
  }
}
