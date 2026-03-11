// packages/gateway/src/memory-scanner.ts
import { MemoryManager, scanMemoryDates } from "@babji/memory";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { logger } from "./logger.js";

const SCANNER_MODEL = "gemini-3.1-flash-lite-preview";
const MIN_ACTIONABLE_ITEMS = 2;

export interface MemoryScannerDeps {
  memory: MemoryManager;
  googleApiKey: string;
}

interface ScanItem {
  type: "stale_contact" | "upcoming_date" | "recurring_pattern";
  description: string;
}

export class MemoryScannerService {
  constructor(private deps: MemoryScannerDeps) {}

  async scan(
    tenantId: string,
    userName: string,
    timezone: string,
  ): Promise<string | null> {
    const memoryContent = await this.deps.memory.readMemory(tenantId);
    if (!memoryContent || memoryContent.length < 50) return null;

    const items: ScanItem[] = [];

    // 1. Upcoming annual dates (14-day window, wider than daily)
    try {
      const dates = scanMemoryDates(memoryContent, 14);
      for (const entry of dates) {
        if (entry.isAnnual) {
          const prefix =
            entry.type === "today" ? "Today" :
            entry.type === "overdue" ? `${Math.abs(entry.daysAway)} days ago` :
            `In ${entry.daysAway} days`;
          items.push({
            type: "upcoming_date",
            description: `${prefix}: ${entry.fact}`,
          });
        }
      }
    } catch (err) {
      logger.warn({ err, tenantId }, "Memory scanner: date scan failed");
    }

    // 2. Stale contacts (follow-up keywords + dates > 14 days old)
    try {
      const followUpRe = /\[(\d{4}-\d{2}-\d{2})\].*(?:follow.?up|get back to|check.?in|reach out|contact|call back|reconnect)/i;
      for (const line of memoryContent.split("\n")) {
        const match = line.match(followUpRe);
        if (!match) continue;

        const factDate = new Date(match[1] + "T00:00:00");
        const daysSince = Math.floor((Date.now() - factDate.getTime()) / 86_400_000);

        if (daysSince >= 14) {
          const fact = line.replace(/^-\s*\[\d{4}-\d{2}-\d{2}\]\s*/, "").trim();
          items.push({
            type: "stale_contact",
            description: `${daysSince} days since: ${fact}`,
          });
        }
      }
    } catch (err) {
      logger.warn({ err, tenantId }, "Memory scanner: stale contact scan failed");
    }

    // 3. Recurring patterns (topics mentioned 3+ times)
    try {
      const topicCounts = new Map<string, number>();
      const topicRe = /\[DATE:.*?\]\s*|^\s*-\s*\[\d{4}-\d{2}-\d{2}\]\s*/;
      for (const line of memoryContent.split("\n")) {
        const clean = line.replace(topicRe, "").trim().toLowerCase();
        if (clean.length < 10) continue;

        // Extract key nouns/phrases (simple heuristic: 2-3 word sequences)
        const words = clean.split(/\s+/).filter((w) => w.length > 3);
        for (let i = 0; i < words.length - 1; i++) {
          const bigram = `${words[i]} ${words[i + 1]}`;
          topicCounts.set(bigram, (topicCounts.get(bigram) || 0) + 1);
        }
      }

      const recurring = Array.from(topicCounts.entries())
        .filter(([, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      for (const [topic, count] of recurring) {
        items.push({
          type: "recurring_pattern",
          description: `"${topic}" mentioned ${count} times in memory`,
        });
      }
    } catch (err) {
      logger.warn({ err, tenantId }, "Memory scanner: pattern scan failed");
    }

    // Only send if enough actionable items
    if (items.length < MIN_ACTIONABLE_ITEMS) return null;

    return this.composeNudge(userName, timezone, items);
  }

  private async composeNudge(
    userName: string,
    timezone: string,
    items: ScanItem[],
  ): Promise<string> {
    const googleAi = createGoogleGenerativeAI({ apiKey: this.deps.googleApiKey });

    const rawItems = items
      .map((item) => `- [${item.type}] ${item.description}`)
      .join("\n");

    try {
      const result = await generateText({
        model: googleAi(SCANNER_MODEL),
        messages: [
          {
            role: "system",
            content: `You are Babji, a friendly AI business assistant sending a weekly check-in to ${userName}. Based on the items below, compose a brief proactive nudge message. Rules:
- Be conversational and helpful, not robotic
- Plain text only -- no markdown, no emojis
- Group items naturally (upcoming dates, people to follow up with, patterns)
- End with "Want me to help with any of these?"
- Keep it under 1000 characters
- Frame items as gentle suggestions, not commands`,
          },
          {
            role: "user",
            content: rawItems,
          },
        ],
      });

      return result.text.trim();
    } catch (err) {
      logger.warn({ err }, "Memory scanner: LLM composition failed, using raw format");
      const lines = [`Hey ${userName}, a few things I noticed this week:\n`];
      for (const item of items) {
        lines.push(`- ${item.description}`);
      }
      lines.push("\nWant me to help with any of these?");
      return lines.join("\n");
    }
  }
}
