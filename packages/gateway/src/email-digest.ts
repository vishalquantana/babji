// packages/gateway/src/email-digest.ts
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { google } from "googleapis";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { logger } from "./logger.js";

// ── Interfaces ──

export interface EmailDigestDeps {
  googleApiKey: string;
  memoryBaseDir: string;
}

export interface TriagedEmail {
  emailId: string;
  priority: "urgent" | "reply_needed" | "action" | "fyi" | "skip";
  reason: string;
  suggestedAction: "reply" | "forward" | "archive" | "none";
  draftReply?: string;
  needsFullRead: boolean;
  from: string;
  subject: string;
  snippet: string;
  date: string;
}

export interface PendingDraft {
  index: number;
  emailId: string;
  from: string;
  to: string;
  subject: string;
  draftReply: string;
  threadId?: string;
}

export interface PendingDraftsFile {
  digestTimestamp: string;
  items: PendingDraft[];
  expiresAt: string;
}

// ── Constants ──

const MAX_EMAILS_PER_BATCH = 20;
const MAX_FULL_READS = 3;
const DRAFT_EXPIRY_HOURS = 12;
const TRIAGE_MODEL = "gemini-3.1-flash-lite-preview";

// ── Service ──

export class EmailDigestRunner {
  constructor(private deps: EmailDigestDeps) {}

  async run(
    accessToken: string,
    tenantId: string,
    userName: string,
    memoryContent: string,
    lastCheckedAt: string | null,
  ): Promise<{ message: string; draftsCount: number } | null> {
    const emails = await this.fetchUnreadEmails(accessToken, lastCheckedAt);
    if (emails.length === 0) return null;

    const triaged = await this.triageEmails(emails, userName, memoryContent);

    const needsFullRead = triaged.filter((t) => t.needsFullRead && t.priority !== "skip");
    const fullReads = needsFullRead.slice(0, MAX_FULL_READS);
    if (fullReads.length > 0) {
      await this.enrichWithFullBody(accessToken, fullReads, triaged, userName, memoryContent);
    }

    const actionable = triaged.filter((t) => t.priority !== "skip");
    if (actionable.length === 0) return null;

    const message = this.formatDigest(actionable);

    const drafts = actionable.filter((t) => t.draftReply);
    if (drafts.length > 0) {
      await this.writePendingDrafts(tenantId, actionable);
    }

    return { message, draftsCount: drafts.length };
  }

  private async fetchUnreadEmails(
    accessToken: string,
    lastCheckedAt: string | null,
  ): Promise<Array<{ id: string; from: string; subject: string; snippet: string; date: string }>> {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth });

    let query = "is:unread -category:promotions -category:social";
    if (lastCheckedAt) {
      const epochSec = Math.floor(new Date(lastCheckedAt).getTime() / 1000);
      query += ` after:${epochSec}`;
    }

    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: MAX_EMAILS_PER_BATCH,
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) return [];

    const emails = await Promise.all(
      messages.map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        const headers = detail.data.payload?.headers || [];
        return {
          id: msg.id!,
          from: headers.find((h) => h.name === "From")?.value || "",
          subject: headers.find((h) => h.name === "Subject")?.value || "(No subject)",
          snippet: detail.data.snippet || "",
          date: headers.find((h) => h.name === "Date")?.value || "",
        };
      }),
    );

    return emails;
  }

  private async triageEmails(
    emails: Array<{ id: string; from: string; subject: string; snippet: string; date: string }>,
    userName: string,
    memoryContent: string,
  ): Promise<TriagedEmail[]> {
    const googleAi = createGoogleGenerativeAI({ apiKey: this.deps.googleApiKey });

    const systemPrompt = `You are an executive assistant triaging emails for ${userName}.
Context about this person:
${memoryContent}

Classify each email and suggest actions. Return a JSON array with no additional text.

Priority categories:
- "urgent": time-sensitive, someone waiting, deadline mentioned
- "reply_needed": direct question or request, no hard deadline
- "action": needs user to do something (review, approve, sign)
- "fyi": informational, no response needed but worth knowing
- "skip": newsletters, promotions, automated notifications

Smart triage signals:
- Questions directed at the user
- Action requests ("please review", "can you send", "need your approval")
- Emails from people (not automated notifications)
- Threads the user is already participating in
- Skip: promotions, social notifications, automated alerts, newsletters

For each email return:
{
  "emailId": "the message id",
  "priority": "urgent|reply_needed|action|fyi|skip",
  "reason": "brief explanation",
  "suggestedAction": "reply|forward|archive|none",
  "draftReply": "draft reply text if suggestedAction is reply, or null",
  "needsFullRead": true/false (true if the snippet is not enough to understand the email)
}

Draft replies should be concise and professional, matching ${userName}'s communication style.
Sign replies as ${userName} -- never use placeholders like [Your Name].`;

    const emailList = emails.map((e) => ({
      id: e.id,
      from: e.from,
      subject: e.subject,
      snippet: e.snippet,
      date: e.date,
    }));

    try {
      const result = await generateText({
        model: googleAi(TRIAGE_MODEL),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(emailList) },
        ],
      });

      const text = result.text.trim();
      const jsonStr = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(jsonStr) as Array<{
        emailId: string;
        priority: string;
        reason: string;
        suggestedAction: string;
        draftReply?: string;
        needsFullRead?: boolean;
      }>;

      return parsed.map((item) => {
        const original = emails.find((e) => e.id === item.emailId);
        return {
          emailId: item.emailId,
          priority: item.priority as TriagedEmail["priority"],
          reason: item.reason,
          suggestedAction: item.suggestedAction as TriagedEmail["suggestedAction"],
          draftReply: item.draftReply || undefined,
          needsFullRead: item.needsFullRead ?? false,
          from: original?.from || "",
          subject: original?.subject || "",
          snippet: original?.snippet || "",
          date: original?.date || "",
        };
      });
    } catch (err) {
      logger.error({ err }, "Email triage LLM call failed");
      return emails.map((e) => ({
        emailId: e.id,
        priority: "fyi" as const,
        reason: "Could not classify (LLM error)",
        suggestedAction: "none" as const,
        needsFullRead: false,
        from: e.from,
        subject: e.subject,
        snippet: e.snippet,
        date: e.date,
      }));
    }
  }

  private async enrichWithFullBody(
    accessToken: string,
    fullReads: TriagedEmail[],
    allTriaged: TriagedEmail[],
    userName: string,
    memoryContent: string,
  ): Promise<void> {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth });

    for (const item of fullReads) {
      try {
        const res = await gmail.users.messages.get({
          userId: "me",
          id: item.emailId,
          format: "full",
        });

        const body = this.extractBody(res.data.payload);
        if (!body) continue;

        if (!item.draftReply && (item.priority === "urgent" || item.priority === "reply_needed")) {
          const googleAi = createGoogleGenerativeAI({ apiKey: this.deps.googleApiKey });
          const result = await generateText({
            model: googleAi(TRIAGE_MODEL),
            messages: [
              {
                role: "system",
                content: `You are an executive assistant for ${userName}. Based on the full email body below, draft a concise, professional reply. Sign as ${userName}. Context: ${memoryContent}. Return ONLY the reply text, nothing else.`,
              },
              {
                role: "user",
                content: `From: ${item.from}\nSubject: ${item.subject}\n\n${body.slice(0, 3000)}`,
              },
            ],
          });
          const idx = allTriaged.findIndex((t) => t.emailId === item.emailId);
          if (idx !== -1) {
            allTriaged[idx].draftReply = result.text.trim();
          }
        }
      } catch (err) {
        logger.warn({ err, emailId: item.emailId }, "Failed to fetch full email body");
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractBody(payload: any): string | null {
    if (!payload) return null;

    if (payload.mimeType === "text/plain" && payload.body?.data) {
      return Buffer.from(payload.body.data, "base64").toString("utf-8");
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        const result = this.extractBody(part);
        if (result) return result;
      }
    }

    return null;
  }

  private formatDigest(actionable: TriagedEmail[]): string {
    const priorityLabel: Record<string, string> = {
      urgent: "URGENT",
      reply_needed: "REPLY NEEDED",
      action: "ACTION",
      fyi: "FYI",
    };

    const lines: string[] = [];
    lines.push(`You have ${actionable.length} email${actionable.length > 1 ? "s" : ""} that need${actionable.length === 1 ? "s" : ""} attention:\n`);

    actionable.forEach((item, i) => {
      const idx = i + 1;
      const label = priorityLabel[item.priority] || item.priority.toUpperCase();
      const timeAgo = this.formatTimeAgo(item.date);
      const fromShort = item.from.replace(/<.*>/, "").trim() || item.from;

      lines.push(`${idx}. [${label}] From: ${fromShort}${timeAgo ? ` - ${timeAgo}` : ""}`);
      lines.push(`   "${item.subject}"`);

      if (item.draftReply) {
        const draftLines = item.draftReply.split("\n").map((l, li) =>
          li === 0 ? `   -> Draft reply: "${l}` : `      ${l}`
        );
        const lastIdx = draftLines.length - 1;
        draftLines[lastIdx] = draftLines[lastIdx] + '"';
        lines.push(draftLines.join("\n"));
      } else if (item.priority !== "fyi") {
        lines.push(`   -> No draft (needs your review first)`);
      }

      lines.push("");
    });

    lines.push(`Reply with: "send 1" / "edit 2 to say ..." / "skip all"`);

    return lines.join("\n");
  }

  private formatTimeAgo(dateStr: string): string {
    if (!dateStr) return "";
    try {
      const date = new Date(dateStr);
      const diffMs = Date.now() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDays = Math.floor(diffHr / 24);
      return `${diffDays}d ago`;
    } catch {
      return "";
    }
  }

  async writePendingDrafts(tenantId: string, actionable: TriagedEmail[]): Promise<void> {
    const drafts = actionable
      .filter((t) => t.draftReply)
      .map((t, i) => ({
        index: i + 1,
        emailId: t.emailId,
        from: t.from,
        to: t.from.match(/<(.+?)>/)?.[1] || t.from,
        subject: `Re: ${t.subject.replace(/^Re:\s*/i, "")}`,
        draftReply: t.draftReply!,
      }));

    if (drafts.length === 0) return;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + DRAFT_EXPIRY_HOURS * 60 * 60 * 1000);

    const data: PendingDraftsFile = {
      digestTimestamp: now.toISOString(),
      items: drafts,
      expiresAt: expiresAt.toISOString(),
    };

    const filePath = join(this.deps.memoryBaseDir, tenantId, "pending-email-drafts.json");
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    logger.info({ tenantId, draftCount: drafts.length }, "Wrote pending email drafts");
  }

  static async readPendingDrafts(memoryBaseDir: string, tenantId: string): Promise<PendingDraftsFile | null> {
    const filePath = join(memoryBaseDir, tenantId, "pending-email-drafts.json");
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as PendingDraftsFile;
      if (new Date(data.expiresAt) < new Date()) {
        await unlink(filePath).catch(() => {});
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  static async deletePendingDrafts(memoryBaseDir: string, tenantId: string): Promise<void> {
    const filePath = join(memoryBaseDir, tenantId, "pending-email-drafts.json");
    await unlink(filePath).catch(() => {});
  }
}
