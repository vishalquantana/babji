import { Bot } from "grammy";
import type { ChannelAdapter } from "./types.js";
import type { BabjiMessage, OutboundMessage } from "@babji/types";
import { MessageNormalizer } from "../message-normalizer.js";
import { TenantResolver } from "../tenant-resolver.js";
import { logger } from "../logger.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class TelegramAdapter implements ChannelAdapter {
  name = "telegram";
  private bot: Bot;
  private messageHandler: ((msg: BabjiMessage) => Promise<void>) | null = null;

  constructor(
    private botToken: string,
    private tenantResolver: TenantResolver,
    private googleApiKey?: string,
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

    // Handle voice messages — transcribe and process as text
    this.bot.on("message:voice", async (ctx) => {
      const telegramUserId = String(ctx.from.id);

      try {
        if (!this.googleApiKey) {
          await ctx.reply("Voice messages aren't configured yet. Please send a text message instead.");
          return;
        }

        const tenant = await this.tenantResolver.resolveByTelegramId(telegramUserId);
        const tenantId = tenant?.id || "onboarding:tg:" + telegramUserId;

        // Send a "thinking" indicator
        await ctx.reply("🎙️ Transcribing your voice note...");

        // Download voice file from Telegram
        const file = await ctx.api.getFile(ctx.message.voice.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
        const audioResponse = await fetch(fileUrl);
        if (!audioResponse.ok) {
          throw new Error(`Failed to download voice file: HTTP ${audioResponse.status}`);
        }
        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
        const base64Audio = audioBuffer.toString("base64");

        // Transcribe using Gemini Flash Lite (most cost-effective)
        const transcribeResponse = await fetch(
          `${GEMINI_API_BASE}/models/gemini-3.1-flash-lite-preview:generateContent?key=${this.googleApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inlineData: { mimeType: "audio/ogg", data: base64Audio } },
                  { text: "Transcribe this voice message exactly as spoken. Output ONLY the transcription, nothing else. If you cannot understand the audio, output: [inaudible]" },
                ],
              }],
            }),
          },
        );

        if (!transcribeResponse.ok) {
          const errText = await transcribeResponse.text();
          throw new Error(`Transcription failed: HTTP ${transcribeResponse.status} — ${errText.slice(0, 200)}`);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await transcribeResponse.json()) as any;
        const transcribedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!transcribedText || transcribedText === "[inaudible]") {
          await ctx.reply("Sorry, I couldn't understand the voice message. Could you try again or send a text?");
          return;
        }

        // Show the user what was transcribed so they can verify
        await ctx.reply(`🗣️ You said: "${transcribedText}"`);

        logger.info({ tenantId, duration: ctx.message.voice.duration, textLength: transcribedText.length }, "Voice note transcribed");

        // Process the transcribed text as a normal message
        const normalized = MessageNormalizer.fromTelegram(
          {
            message_id: ctx.message.message_id,
            from: ctx.from,
            text: transcribedText,
            date: ctx.message.date,
          },
          tenantId,
        );

        if (this.messageHandler) {
          await this.messageHandler(normalized);
        }
      } catch (err) {
        logger.error({ err, telegramUserId }, "Error processing voice message");
        try {
          await ctx.reply("Sorry, I had trouble processing that voice message. Please try sending a text instead.");
        } catch { /* ignore reply error */ }
      }
    });

    // Reply to non-text messages (photos, stickers, etc.)
    this.bot.on("message", async (ctx) => {
      // Skip text and voice messages — handled above
      if (ctx.message.text || ctx.message.voice) return;

      try {
        await ctx.reply("I can only read text and voice messages for now. Send me a text and I'll get right on it!");
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

    // Telegram has a 4096-character limit per message — split if needed
    const chunks = splitTelegramMessage(message.text);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(message.recipient, chunk);
    }
  }
}

const TELEGRAM_MAX_LENGTH = 4096;

/** Split text into chunks that fit Telegram's 4096-char limit, preferring paragraph/line boundaries */
function splitTelegramMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point: prefer double newline, then single newline, then space
    let splitAt = -1;
    const searchWindow = remaining.slice(0, TELEGRAM_MAX_LENGTH);

    // Try paragraph break
    splitAt = searchWindow.lastIndexOf("\n\n");
    if (splitAt < TELEGRAM_MAX_LENGTH * 0.3) {
      // Too early — try line break
      splitAt = searchWindow.lastIndexOf("\n");
    }
    if (splitAt < TELEGRAM_MAX_LENGTH * 0.3) {
      // Too early — try space
      splitAt = searchWindow.lastIndexOf(" ");
    }
    if (splitAt < TELEGRAM_MAX_LENGTH * 0.3) {
      // Force split at limit
      splitAt = TELEGRAM_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
