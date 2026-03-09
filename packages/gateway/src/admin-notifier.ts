import { Bot } from "grammy";
import { logger } from "./logger.js";

export class AdminNotifier {
  private bot: Bot;
  private chatId: string;

  constructor(botToken: string, chatId: string) {
    this.bot = new Bot(botToken);
    this.chatId = chatId;
  }

  async notify(text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(this.chatId, text);
    } catch (err) {
      logger.error({ err }, "Failed to send admin notification");
    }
  }

  async notifySkillRequest(tenantName: string, skillName: string, context: string): Promise<void> {
    const text = [
      `New skill request`,
      ``,
      `From: ${tenantName}`,
      `Skill: ${skillName}`,
      `Context: ${context}`,
    ].join("\n");
    await this.notify(text);
  }
}
