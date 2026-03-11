// packages/memory/src/date-scanner.ts

export interface MemoryDateEntry {
  date: string; // YYYY-MM-DD
  fact: string;
  daysAway: number;
  type: "upcoming" | "today" | "overdue";
  isAnnual: boolean;
}

const DATE_TAG_RE = /\[DATE:\s*(\d{4}-\d{2}-\d{2})\]\s*(.+)/;
const ANNUAL_KEYWORDS = /birthday|anniversary|annual|yearly/i;

export function scanMemoryDates(
  memoryContent: string,
  windowDays = 7,
): MemoryDateEntry[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const results: MemoryDateEntry[] = [];

  for (const line of memoryContent.split("\n")) {
    const match = line.match(DATE_TAG_RE);
    if (!match) continue;

    const [, rawDate, fact] = match;
    const isAnnual = ANNUAL_KEYWORDS.test(fact);

    let targetDate = new Date(rawDate + "T00:00:00");

    if (isAnnual) {
      // For annual dates, use this year's occurrence or next year's
      targetDate.setFullYear(today.getFullYear());
      if (targetDate < today) {
        // Already passed this year — check if within overdue window
        const daysPast = Math.floor(
          (today.getTime() - targetDate.getTime()) / 86_400_000,
        );
        if (daysPast > windowDays) {
          // Advance to next year
          targetDate.setFullYear(today.getFullYear() + 1);
        }
      }
    }

    const diffMs = targetDate.getTime() - today.getTime();
    const daysAway = Math.round(diffMs / 86_400_000);

    // Include if within window (future) or recently overdue
    if (daysAway > windowDays) continue;
    if (daysAway < -windowDays) continue;

    const dateStr = targetDate.toISOString().split("T")[0];
    let type: MemoryDateEntry["type"];
    if (dateStr === todayStr) {
      type = "today";
    } else if (daysAway < 0) {
      type = "overdue";
    } else {
      type = "upcoming";
    }

    results.push({ date: dateStr, fact: fact.trim(), daysAway, type, isAnnual });
  }

  // Sort: today first, then upcoming (nearest first), then overdue (most recent first)
  results.sort((a, b) => {
    if (a.type === "today" && b.type !== "today") return -1;
    if (b.type === "today" && a.type !== "today") return 1;
    return a.daysAway - b.daysAway;
  });

  return results;
}
