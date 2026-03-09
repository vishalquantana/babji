import { Bot } from "grammy";
import { logger } from "./logger.js";

interface JiraConfig {
  host: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

export class AdminNotifier {
  private bot: Bot;
  private chatId: string;
  private jira: JiraConfig | null;

  constructor(botToken: string, chatId: string, jira?: JiraConfig) {
    this.bot = new Bot(botToken);
    this.chatId = chatId;
    this.jira = jira ?? null;
  }

  async notify(text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(this.chatId, text);
    } catch (err) {
      logger.error({ err }, "Failed to send admin notification");
    }
  }

  async notifySkillRequest(tenantName: string, skillName: string, context: string): Promise<void> {
    // Create Jira ticket
    let jiraKey: string | null = null;
    if (this.jira) {
      jiraKey = await this.createJiraTicket(tenantName, skillName, context);
    }

    // Send Telegram notification
    const lines = [
      `New skill request`,
      ``,
      `From: ${tenantName}`,
      `Skill: ${skillName}`,
      `Context: ${context}`,
    ];
    if (jiraKey) {
      lines.push(``);
      lines.push(`Jira: https://${this.jira!.host}/browse/${jiraKey}`);
    }
    await this.notify(lines.join("\n"));
  }

  async notifyNewProfiles(
    profiles: Array<{ email: string; displayName: string; meeting: string; tenantName: string }>,
    dateStr: string,
  ): Promise<void> {
    const lines = [`New meeting attendees discovered (${dateStr}):\n`];

    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[i];
      lines.push(`${i + 1}. ${p.email} -> ${p.displayName}`);
      lines.push(`   Meeting: "${p.meeting}" (for ${p.tenantName})`);
    }

    lines.push("");
    lines.push("Review & correct: babji.quantana.top/admin -> Profile Directory");

    await this.notify(lines.join("\n"));
  }

  private async createJiraTicket(tenantName: string, skillName: string, context: string): Promise<string | null> {
    if (!this.jira) return null;

    const auth = Buffer.from(`${this.jira.email}:${this.jira.apiToken}`).toString("base64");

    try {
      const res = await fetch(`https://${this.jira.host}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            project: { key: this.jira.projectKey },
            summary: `Skill request: ${skillName} (from ${tenantName})`,
            description: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: `Requested by: ${tenantName}` },
                  ],
                },
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: context },
                  ],
                },
              ],
            },
            issuetype: { name: "Task" },
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        logger.error({ status: res.status, body }, "Failed to create Jira ticket");
        return null;
      }

      const data = await res.json() as { key: string };
      logger.info({ jiraKey: data.key, skillName }, "Created Jira ticket for skill request");
      return data.key;
    } catch (err) {
      logger.error({ err }, "Failed to create Jira ticket");
      return null;
    }
  }
}
