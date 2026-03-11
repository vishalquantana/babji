// packages/gateway/src/daily-briefing.ts
import { eq, and } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import { TokenVault } from "@babji/crypto";
import { GoogleCalendarHandler } from "@babji/skills";
import { MemoryManager, scanMemoryDates } from "@babji/memory";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { EmailDigestRunner } from "./email-digest.js";
import { getStaleFollowUps } from "./stale-followups.js";
import { ensureValidToken } from "./token-refresh.js";
import { logger } from "./logger.js";

const BRIEFING_MODEL = "gemini-3.1-flash-lite-preview";

export interface DailyBriefingDeps {
  db: Database;
  vault: TokenVault;
  memory: MemoryManager;
  googleApiKey: string;
}

interface BriefingSection {
  label: string;
  content: string;
}

export class DailyBriefingService {
  constructor(private deps: DailyBriefingDeps) {}

  async generateBriefing(
    tenant: typeof schema.tenants.$inferSelect,
    timezone: string,
  ): Promise<string | null> {
    const tenantId = tenant.id;
    const sections: BriefingSection[] = [];

    // Check what services are connected
    const connections = await this.deps.db.query.serviceConnections.findMany({
      where: eq(schema.serviceConnections.tenantId, tenantId),
    });
    const hasCalendar = connections.some((c) => c.provider === "google_calendar");
    const hasGmail = connections.some((c) => c.provider === "gmail");

    // Gather data in parallel - each source is independently try/caught
    const [calendarSection, emailSection, todosSection, memoryDatesSection, staleSection] =
      await Promise.all([
        hasCalendar ? this.getCalendarSection(tenantId, timezone) : null,
        hasGmail ? this.getEmailSection(tenantId, tenant.name, timezone) : null,
        this.getTodosSection(tenantId, timezone),
        this.getMemoryDatesSection(tenantId),
        hasGmail ? this.getStaleFollowUpsSection(tenantId) : null,
      ]);

    if (calendarSection) sections.push(calendarSection);
    if (emailSection) sections.push(emailSection);
    if (todosSection) sections.push(todosSection);
    if (memoryDatesSection) sections.push(memoryDatesSection);
    if (staleSection) sections.push(staleSection);

    // Nothing to report
    if (sections.length === 0) return null;

    // Compose via lite LLM
    return this.composeBriefing(tenant.name, timezone, sections);
  }

  private async getCalendarSection(
    tenantId: string,
    timezone: string,
  ): Promise<BriefingSection | null> {
    try {
      const tokenResult = await ensureValidToken(tenantId, "google_calendar", this.deps.vault, this.deps.db);
      if (!tokenResult || tokenResult.status === "expired") return null;

      const calHandler = new GoogleCalendarHandler(tokenResult.accessToken);
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const dateStr = formatter.format(new Date());
      const timeMinISO = new Date(`${dateStr}T00:00:00+00:00`).toISOString();
      const timeMaxISO = new Date(`${dateStr}T23:59:59+00:00`).toISOString();

      const result = await calHandler.execute("list_events", {
        time_min: timeMinISO,
        time_max: timeMaxISO,
        max_results: 20,
      }) as { events: Array<Record<string, unknown>>; count: number };

      if (result.events.length === 0) {
        return { label: "Calendar", content: "No events today." };
      }

      const lines = result.events.map((event) => {
        const start = event.start as string;
        const summary = (event.summary as string) || "(No title)";
        let timeStr = "All day";
        if (start?.includes("T")) {
          timeStr = new Date(start).toLocaleString("en-US", {
            timeZone: timezone,
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
        }
        const loc = event.location ? ` (${event.location})` : "";
        return `- ${timeStr}: ${summary}${loc}`;
      });

      return { label: "Calendar", content: `${result.events.length} event${result.events.length > 1 ? "s" : ""} today:\n${lines.join("\n")}` };
    } catch (err) {
      logger.warn({ err, tenantId }, "Daily briefing: calendar fetch failed");
      return null;
    }
  }

  private async getEmailSection(
    tenantId: string,
    userName: string,
    timezone: string,
  ): Promise<BriefingSection | null> {
    try {
      const tokenResult = await ensureValidToken(tenantId, "gmail", this.deps.vault, this.deps.db);
      if (!tokenResult || tokenResult.status === "expired") return null;

      const memoryContent = await this.deps.memory.readMemory(tenantId);
      const memoryBaseDir = process.env.MEMORY_BASE_DIR || "./data/tenants";

      const runner = new EmailDigestRunner({
        googleApiKey: this.deps.googleApiKey,
        memoryBaseDir,
      });

      const result = await runner.run(
        tokenResult.accessToken,
        tenantId,
        userName,
        memoryContent,
        null, // full scan
      );

      if (!result) return null;

      return { label: "Email highlights", content: result.message };
    } catch (err) {
      logger.warn({ err, tenantId }, "Daily briefing: email section failed");
      return null;
    }
  }

  private async getTodosSection(tenantId: string, timezone: string): Promise<BriefingSection | null> {
    try {
      const todos = await this.deps.db.query.todos.findMany({
        where: and(
          eq(schema.todos.tenantId, tenantId),
          eq(schema.todos.status, "pending"),
        ),
      });

      if (todos.length === 0) return null;

      const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });

      const overdue = todos.filter((t) => t.dueDate && t.dueDate < today);
      const dueToday = todos.filter((t) => t.dueDate === today);
      const upcoming = todos.filter((t) => t.dueDate && t.dueDate > today);
      const noDue = todos.filter((t) => !t.dueDate);

      const lines: string[] = [];
      if (overdue.length > 0) {
        lines.push(`Overdue (${overdue.length}):`);
        overdue.forEach((t) => lines.push(`- ${t.title} (was due ${t.dueDate})`));
      }
      if (dueToday.length > 0) {
        lines.push(`Due today (${dueToday.length}):`);
        dueToday.forEach((t) => lines.push(`- ${t.title}`));
      }
      if (upcoming.length > 0) {
        lines.push(`Coming up (${upcoming.length}):`);
        upcoming.slice(0, 3).forEach((t) => lines.push(`- ${t.title} (due ${t.dueDate})`));
        if (upcoming.length > 3) lines.push(`  ...and ${upcoming.length - 3} more`);
      }
      if (noDue.length > 0 && lines.length < 8) {
        lines.push(`Backlog (${noDue.length}):`);
        noDue.slice(0, 2).forEach((t) => lines.push(`- ${t.title}`));
        if (noDue.length > 2) lines.push(`  ...and ${noDue.length - 2} more`);
      }

      return { label: "Tasks", content: lines.join("\n") };
    } catch (err) {
      logger.warn({ err, tenantId }, "Daily briefing: todos section failed");
      return null;
    }
  }

  private async getMemoryDatesSection(tenantId: string): Promise<BriefingSection | null> {
    try {
      const memoryContent = await this.deps.memory.readMemory(tenantId);
      const entries = scanMemoryDates(memoryContent, 7);

      if (entries.length === 0) return null;

      const lines = entries.map((e) => {
        const prefix =
          e.type === "today" ? "TODAY" :
          e.type === "overdue" ? `${Math.abs(e.daysAway)}d overdue` :
          `in ${e.daysAway}d`;
        return `- [${prefix}] ${e.fact}`;
      });

      return { label: "Upcoming dates", content: lines.join("\n") };
    } catch (err) {
      logger.warn({ err, tenantId }, "Daily briefing: memory dates section failed");
      return null;
    }
  }

  private async getStaleFollowUpsSection(tenantId: string): Promise<BriefingSection | null> {
    try {
      const tokenResult = await ensureValidToken(tenantId, "gmail", this.deps.vault, this.deps.db);
      if (!tokenResult || tokenResult.status === "expired") return null;

      const stale = await getStaleFollowUps(tokenResult.accessToken, 7);

      if (stale.length === 0) return null;

      const lines = stale.map((s) => {
        const to = s.sentTo.replace(/<.*>/, "").trim() || s.sentTo;
        return `- "${s.subject}" to ${to} (${s.daysSinceSent}d ago, no reply)`;
      });

      return { label: "Stale follow-ups", content: lines.join("\n") };
    } catch (err) {
      logger.warn({ err, tenantId }, "Daily briefing: stale follow-ups section failed");
      return null;
    }
  }

  private async composeBriefing(
    userName: string,
    timezone: string,
    sections: BriefingSection[],
  ): Promise<string> {
    const googleAi = createGoogleGenerativeAI({ apiKey: this.deps.googleApiKey });

    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(new Date()),
    );
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    const rawData = sections.map((s) => `### ${s.label}\n${s.content}`).join("\n\n");

    try {
      const result = await generateText({
        model: googleAi(BRIEFING_MODEL),
        messages: [
          {
            role: "system",
            content: `You are Babji, a friendly AI business assistant composing a morning briefing for ${userName}. Write a single conversational message that covers all the sections below. Rules:
- Start with "${greeting}, ${userName}!"
- Be concise, warm, and scannable
- Use plain text only -- no markdown, no emojis, no bold/italic
- Use line breaks and dashes for structure
- If there are email drafts, mention them and how to act on them
- End with a brief "Anything you want me to help with?" or similar
- Keep the total message under 2000 characters`,
          },
          {
            role: "user",
            content: rawData,
          },
        ],
      });

      return result.text.trim();
    } catch (err) {
      logger.warn({ err }, "Daily briefing: LLM composition failed, using raw format");
      // Fallback: return raw sections
      const lines = [`${greeting}, ${userName}! Here's your daily briefing:\n`];
      for (const s of sections) {
        lines.push(`-- ${s.label} --`);
        lines.push(s.content);
        lines.push("");
      }
      return lines.join("\n");
    }
  }
}
