import { Bot } from "grammy";
import type { ChannelAdapter } from "./types.js";
import type { BabjiMessage, OutboundMessage } from "@babji/types";
import { MessageNormalizer } from "../message-normalizer.js";
import { TenantResolver } from "../tenant-resolver.js";
import { logger } from "../logger.js";

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
    // Global error handler for grammy
    this.bot.catch((err) => {
      logger.error({ err: err.error, ctx: err.ctx?.update?.update_id }, "Telegram bot error");
    });

    // Handle text messages
    this.bot.on("message:text", async (ctx) => {
      const telegramUserId = String(ctx.from.id);

      try {
        const tenant = await this.tenantResolver.resolveByTelegramId(telegramUserId);
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
      } catch (err) {
        logger.error({ err, telegramUserId }, "Error processing Telegram message");
      }
    });

    // Reply to non-text messages (photos, stickers, voice, etc.)
    this.bot.on("message", async (ctx) => {
      // Skip text messages — handled above
      if (ctx.message.text) return;

      try {
        await ctx.reply("I can only read text messages for now. Send me a text and I'll get right on it!");
      } catch (err) {
        logger.error({ err }, "Error sending non-text reply");
      }
    });

    this.bot.start();
    logger.info("Telegram bot started (long polling)");
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    logger.info("Telegram bot stopped");
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    // Send image if media is attached
    if (message.media?.type === "image" && message.media.url) {
      try {
        if (message.media.url.startsWith("data:")) {
          // Base64 data URI — decode and send as buffer
          const base64 = message.media.url.split(",")[1];
          if (base64) {
            const buffer = Buffer.from(base64, "base64");
            const { InputFile } = await import("grammy");
            await this.bot.api.sendPhoto(
              message.recipient,
              new InputFile(buffer, "image.png"),
              { caption: message.text?.slice(0, 1024) || undefined },
            );
            return;
          }
        } else {
          // URL — let Telegram fetch it
          await this.bot.api.sendPhoto(
            message.recipient,
            message.media.url,
            { caption: message.text?.slice(0, 1024) || undefined },
          );
          return;
        }
      } catch (err) {
        logger.error({ err }, "Failed to send photo, falling back to text");
        // Fall through to text message
      }
    }

    await this.bot.api.sendMessage(message.recipient, message.text);
  }
}
