import { Bot } from "grammy";
import { logger } from "./logger.js";
import { eq } from "drizzle-orm";
import { schema } from "@babji/db";
import { PeopleHandler } from "@babji/skills";

interface JiraConfig {
  host: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

interface RecentAttendee {
  email: string;
  displayName: string;
  meeting: string;
  tenantName: string;
  notifiedAt: Date;
}

interface PendingDisambiguation {
  linkedinUrl: string;
  candidates: Array<{ email: string; displayName: string }>;
  expiresAt: Date;
}

interface AdminReplyDeps {
  db: any;
  peopleConfig: {
    scrapinApiKey: string;
    dataforseoLogin: string;
    dataforseoPassword: string;
  };
  llmLite: { chat: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => Promise<{ content: string }> };
}

export class AdminNotifier {
  private bot: Bot;
  private chatId: string;
  private jira: JiraConfig | null;
  private recentAttendees: RecentAttendee[] = [];
  private pendingDisambiguation: PendingDisambiguation | null = null;
  private replyDeps: AdminReplyDeps | null = null;

  constructor(botToken: string, chatId: string, jira?: JiraConfig) {
    this.bot = new Bot(botToken);
    this.chatId = chatId;
    this.jira = jira ?? null;
  }

  startListening(deps: AdminReplyDeps): void {
    this.replyDeps = deps;

    this.bot.on("message:text", async (ctx) => {
      // Only process messages from the admin chat
      if (String(ctx.chat.id) !== this.chatId) return;

      try {
        await this.handleReply(ctx.message.text);
      } catch (err) {
        logger.error({ err }, "Failed to handle admin reply");
      }
    });

    this.bot.start({
      onStart: () => logger.info("Admin bot listening for replies"),
    });
  }

  stop(): void {
    this.bot.stop();
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
    // Track notified attendees for reply matching
    const now = new Date();
    for (const p of profiles) {
      this.recentAttendees.push({
        email: p.email,
        displayName: p.displayName,
        meeting: p.meeting,
        tenantName: p.tenantName,
        notifiedAt: now,
      });
    }
    // Prune: keep max 50 entries, remove older than 48 hours
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    this.recentAttendees = this.recentAttendees
      .filter(a => a.notifiedAt > cutoff)
      .slice(-50);

    const lines = [`New meeting attendees discovered (${dateStr}):\n`];

    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[i];
      lines.push(`${i + 1}. ${p.email} -> ${p.displayName}`);
      lines.push(`   Meeting: "${p.meeting}" (for ${p.tenantName})`);
    }

    lines.push("");
    lines.push("Reply with a LinkedIn URL to update a profile.");

    await this.notify(lines.join("\n"));
  }

  async handleReply(text: string): Promise<void> {
    if (!this.replyDeps) return;

    const trimmed = text.trim();

    // 1. Check for pending disambiguation (admin replies with a number)
    if (this.pendingDisambiguation) {
      const disambig = this.pendingDisambiguation;
      if (disambig.expiresAt < new Date()) {
        this.pendingDisambiguation = null;
      } else {
        const num = parseInt(trimmed, 10);
        if (num >= 1 && num <= disambig.candidates.length) {
          this.pendingDisambiguation = null;
          const chosen = disambig.candidates[num - 1];
          await this.updateProfile(chosen.email, disambig.linkedinUrl);
          return;
        }
      }
    }

    // 2. Extract LinkedIn URL from text
    const linkedinMatch = trimmed.match(
      /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+\/?/i,
    );
    if (!linkedinMatch) return; // Not a profile correction -- ignore silently

    const linkedinUrl = linkedinMatch[0].startsWith("http")
      ? linkedinMatch[0]
      : `https://${linkedinMatch[0]}`;

    // 3. Check for email + LinkedIn URL format
    const emailMatch = trimmed.match(
      /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/,
    );
    if (emailMatch) {
      const email = emailMatch[1].toLowerCase();
      await this.updateProfile(email, linkedinUrl);
      return;
    }

    // 4. Bare LinkedIn URL -- use LLM to match against recent attendees
    if (this.recentAttendees.length === 0) {
      await this.notify("No recent attendees to match against. Include the email address with the URL.");
      return;
    }

    await this.matchWithLlm(linkedinUrl);
  }

  private async matchWithLlm(linkedinUrl: string): Promise<void> {
    if (!this.replyDeps) return;

    const attendeeList = this.recentAttendees
      .map((a, i) => `${i + 1}. ${a.email} -> ${a.displayName} (Meeting: "${a.meeting}")`)
      .join("\n");

    const system = `You match LinkedIn URLs to meeting attendees. Reply ONLY with valid JSON, no markdown.`;
    const prompt = `Recent meeting attendees:\n${attendeeList}\n\nLinkedIn URL: ${linkedinUrl}\n\nWhich attendee does this URL most likely belong to? Consider the name in the URL slug vs attendee names.\nReply with JSON: { "email": "<matched-email>", "confidence": "high" }\nIf genuinely ambiguous between 2+ people, reply: { "email": null, "confidence": "ambiguous", "candidates": ["email1", "email2"] }`;

    try {
      const result = await this.replyDeps.llmLite.chat([
        { role: "system", content: system },
        { role: "user", content: prompt },
      ]);

      const cleaned = result.content.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned) as {
        email: string | null;
        confidence: string;
        candidates?: string[];
      };

      if (parsed.confidence === "high" && parsed.email) {
        await this.updateProfile(parsed.email, linkedinUrl);
      } else if (parsed.confidence === "ambiguous" && parsed.candidates) {
        this.pendingDisambiguation = {
          linkedinUrl,
          candidates: parsed.candidates.map(email => {
            const attendee = this.recentAttendees.find(a => a.email === email);
            return { email, displayName: attendee?.displayName || email };
          }),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        };
        const options = this.pendingDisambiguation.candidates
          .map((c, i) => `${i + 1}. ${c.displayName} (${c.email})`)
          .join("\n");
        await this.notify(`Which attendee?\n${options}\n\nReply with the number.`);
      } else {
        await this.notify("Could not match that URL to a recent attendee. Include the email address.");
      }
    } catch (err) {
      logger.error({ err }, "LLM match failed for admin reply");
      await this.notify("Could not process that URL. Try: email linkedin-url");
    }
  }

  private async updateProfile(email: string, linkedinUrl: string): Promise<void> {
    if (!this.replyDeps) return;

    const normalizedEmail = email.toLowerCase();
    const { db, peopleConfig } = this.replyDeps;

    // Check if profile exists in directory
    const existing = await db.query.profileDirectory.findFirst({
      where: eq(schema.profileDirectory.email, normalizedEmail),
    });

    const displayName = existing?.displayName
      || this.recentAttendees.find(a => a.email === normalizedEmail)?.displayName
      || normalizedEmail;

    // Re-scrape via Scrapin
    let scrapedData: Record<string, unknown> | null = null;
    let scrapeError = false;

    try {
      const people = new PeopleHandler(
        { login: peopleConfig.dataforseoLogin, password: peopleConfig.dataforseoPassword },
        { apiKey: peopleConfig.scrapinApiKey },
      );
      const result = await people.execute("lookup_profile", { linkedin_url: linkedinUrl });
      if (result && typeof result === "object" && (result as any).found) {
        scrapedData = result as Record<string, unknown>;
      } else {
        scrapeError = true;
      }
    } catch (err) {
      logger.error({ err, email: normalizedEmail, linkedinUrl }, "Scrapin enrichment failed for admin correction");
      scrapeError = true;
    }

    // Upsert profile_directory
    const now = new Date();
    const values = {
      email: normalizedEmail,
      displayName,
      linkedinUrl,
      scrapedData,
      status: "corrected" as const,
      scrapedAt: scrapeError ? existing?.scrapedAt : now,
      verifiedBy: "admin-telegram",
      verifiedAt: now,
    };

    if (existing) {
      await db.update(schema.profileDirectory)
        .set(values)
        .where(eq(schema.profileDirectory.email, normalizedEmail));
    } else {
      await db.insert(schema.profileDirectory).values(values);
    }

    // Confirm to admin
    if (scrapeError) {
      await this.notify(`Updated LinkedIn URL for ${displayName} (${normalizedEmail}) but enrichment failed -- will retry on next briefing.`);
    } else {
      await this.notify(`Updated ${displayName} (${normalizedEmail}) with ${linkedinUrl}`);
    }

    logger.info({ email: normalizedEmail, linkedinUrl, scrapeError }, "Admin corrected profile via Telegram");
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
