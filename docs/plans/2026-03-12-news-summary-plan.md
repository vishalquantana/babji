# Daily News Summary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a news headlines section to the daily briefing that shows 3-5 top headlines (general + personalized from MEMORY.md), sourced from Google News RSS.

**Architecture:** New `news-fetcher.ts` module fetches and parses Google News RSS feeds. `DailyBriefingService` gains a `getNewsSection()` method that calls the fetcher, extracts topics from MEMORY.md, and returns a `BriefingSection`. The existing `composeBriefing()` LLM call weaves news into the conversational message.

**Tech Stack:** Google News RSS (XML), `fast-xml-parser` (new dep), existing Vitest test framework.

---

### Task 1: Add fast-xml-parser dependency

**Files:**
- Modify: `packages/gateway/package.json`

**Step 1: Install the dependency**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway add fast-xml-parser`

**Step 2: Verify it installed**

Run: `cd /Users/vishalkumar/Downloads/babji && node -e "const { XMLParser } = require('fast-xml-parser'); console.log('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add packages/gateway/package.json pnpm-lock.yaml
git commit -m "chore: add fast-xml-parser dependency for news RSS parsing"
```

---

### Task 2: Create news-fetcher module with tests

**Files:**
- Create: `packages/gateway/src/news-fetcher.ts`
- Create: `packages/gateway/src/__tests__/news-fetcher.test.ts`

**Step 1: Write the failing tests**

Create `packages/gateway/src/__tests__/news-fetcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseRssItems, extractTopicsFromMemory, timezoneToCountry } from "../news-fetcher.js";

describe("parseRssItems", () => {
  it("parses a standard Google News RSS item", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Stock markets rally on trade deal - Reuters</title>
      <link>https://news.google.com/rss/articles/abc123</link>
      <pubDate>Wed, 12 Mar 2026 08:00:00 GMT</pubDate>
      <source url="https://reuters.com">Reuters</source>
    </item>
    <item>
      <title>New AI breakthrough announced - TechCrunch</title>
      <link>https://news.google.com/rss/articles/def456</link>
      <pubDate>Wed, 12 Mar 2026 07:30:00 GMT</pubDate>
      <source url="https://techcrunch.com">TechCrunch</source>
    </item>
  </channel>
</rss>`;

    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Stock markets rally on trade deal");
    expect(items[0].source).toBe("Reuters");
    expect(items[0].publishedAt).toBe("Wed, 12 Mar 2026 08:00:00 GMT");
    expect(items[1].title).toBe("New AI breakthrough announced");
    expect(items[1].source).toBe("TechCrunch");
  });

  it("handles title without source suffix", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Breaking news headline</title>
      <link>https://news.google.com/rss/articles/xyz</link>
      <pubDate>Wed, 12 Mar 2026 06:00:00 GMT</pubDate>
      <source url="https://example.com">Example News</source>
    </item>
  </channel>
</rss>`;

    const items = parseRssItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Breaking news headline");
    expect(items[0].source).toBe("Example News");
  });

  it("returns empty array for invalid XML", () => {
    const items = parseRssItems("not xml at all");
    expect(items).toEqual([]);
  });

  it("returns empty array for XML with no items", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toEqual([]);
  });

  it("handles single item (not wrapped in array by parser)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Only one headline - BBC</title>
      <link>https://news.google.com/rss/articles/single</link>
      <pubDate>Wed, 12 Mar 2026 05:00:00 GMT</pubDate>
      <source url="https://bbc.com">BBC</source>
    </item>
  </channel>
</rss>`;

    const items = parseRssItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Only one headline");
    expect(items[0].source).toBe("BBC");
  });
});

describe("extractTopicsFromMemory", () => {
  it("extracts industry keywords", () => {
    const memory = `# Memory
[2026-03-01] Works in the fintech industry
[2026-03-02] Prefers morning meetings`;

    const topics = extractTopicsFromMemory(memory);
    expect(topics).toContain("fintech");
  });

  it("extracts company/sector mentions", () => {
    const memory = `# Memory
[2026-03-01] Runs a SaaS startup in healthcare
[2026-03-02] Interested in AI and machine learning`;

    const topics = extractTopicsFromMemory(memory);
    expect(topics.length).toBeGreaterThanOrEqual(1);
    expect(topics.some((t) => t.includes("healthcare") || t.includes("AI") || t.includes("SaaS"))).toBe(true);
  });

  it("returns empty array when no topics found", () => {
    const memory = `# Memory
[2026-03-01] Prefers email over calls
[2026-03-02] Likes coffee`;

    const topics = extractTopicsFromMemory(memory);
    expect(topics).toEqual([]);
  });

  it("caps at 2 topics", () => {
    const memory = `# Memory
[2026-03-01] Works in the fintech industry
[2026-03-02] Interested in AI and machine learning
[2026-03-03] Runs a startup in healthcare sector
[2026-03-04] Company is in the crypto space`;

    const topics = extractTopicsFromMemory(memory);
    expect(topics.length).toBeLessThanOrEqual(2);
  });
});

describe("timezoneToCountry", () => {
  it("maps Asia/Kolkata to IN", () => {
    expect(timezoneToCountry("Asia/Kolkata")).toEqual({ country: "IN", lang: "en-IN" });
  });

  it("maps America/New_York to US", () => {
    expect(timezoneToCountry("America/New_York")).toEqual({ country: "US", lang: "en-US" });
  });

  it("maps America/Chicago to US", () => {
    expect(timezoneToCountry("America/Chicago")).toEqual({ country: "US", lang: "en-US" });
  });

  it("maps Europe/London to GB", () => {
    expect(timezoneToCountry("Europe/London")).toEqual({ country: "GB", lang: "en-GB" });
  });

  it("falls back to US for unknown timezone", () => {
    expect(timezoneToCountry("Pacific/Fiji")).toEqual({ country: "US", lang: "en-US" });
  });

  it("falls back to US for UTC", () => {
    expect(timezoneToCountry("UTC")).toEqual({ country: "US", lang: "en-US" });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @babji/gateway test -- src/__tests__/news-fetcher.test.ts`
Expected: FAIL — module `../news-fetcher.js` not found

**Step 3: Implement the news-fetcher module**

Create `packages/gateway/src/news-fetcher.ts`:

```typescript
// packages/gateway/src/news-fetcher.ts
import { XMLParser } from "fast-xml-parser";
import { logger } from "./logger.js";

export interface NewsItem {
  title: string;
  source: string;
  publishedAt: string;
}

const TIMEZONE_COUNTRY_MAP: Record<string, { country: string; lang: string }> = {
  "Asia/Kolkata": { country: "IN", lang: "en-IN" },
  "Asia/Calcutta": { country: "IN", lang: "en-IN" },
  "America/New_York": { country: "US", lang: "en-US" },
  "America/Chicago": { country: "US", lang: "en-US" },
  "America/Denver": { country: "US", lang: "en-US" },
  "America/Los_Angeles": { country: "US", lang: "en-US" },
  "Europe/London": { country: "GB", lang: "en-GB" },
  "Europe/Berlin": { country: "DE", lang: "en-DE" },
  "Europe/Paris": { country: "FR", lang: "en-FR" },
  "Asia/Dubai": { country: "AE", lang: "en-AE" },
  "Asia/Singapore": { country: "SG", lang: "en-SG" },
  "Australia/Sydney": { country: "AU", lang: "en-AU" },
};

const DEFAULT_LOCALE = { country: "US", lang: "en-US" };

export function timezoneToCountry(timezone: string): { country: string; lang: string } {
  return TIMEZONE_COUNTRY_MAP[timezone] || DEFAULT_LOCALE;
}

/**
 * Parse Google News RSS XML into NewsItem[].
 */
export function parseRssItems(xml: string): NewsItem[] {
  try {
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);

    const channel = parsed?.rss?.channel;
    if (!channel?.item) return [];

    // fast-xml-parser returns a single object if there's only one <item>, array if multiple
    const rawItems = Array.isArray(channel.item) ? channel.item : [channel.item];

    return rawItems.map((item: Record<string, unknown>) => {
      let title = String(item.title || "");
      const sourceObj = item.source;
      let source = "";

      if (typeof sourceObj === "object" && sourceObj !== null) {
        source = String((sourceObj as Record<string, unknown>)["#text"] || "");
      } else if (typeof sourceObj === "string") {
        source = sourceObj;
      }

      // Strip " - Source Name" suffix from title if present
      if (source && title.endsWith(` - ${source}`)) {
        title = title.slice(0, -(` - ${source}`).length);
      }

      return {
        title,
        source,
        publishedAt: String(item.pubDate || ""),
      };
    });
  } catch (err) {
    logger.warn({ err }, "Failed to parse RSS XML");
    return [];
  }
}

/**
 * Extract 0-2 topic keywords from MEMORY.md content for personalized news.
 */
export function extractTopicsFromMemory(memoryContent: string): string[] {
  const topics: string[] = [];
  const lines = memoryContent.split("\n");

  // Patterns that indicate industry/interest topics
  const patterns = [
    /works?\s+in\s+(?:the\s+)?(.+?)(?:\s+industry|\s+sector|\s+space|$)/i,
    /(?:industry|sector|space)\s*(?:is|:)\s*(.+)/i,
    /interested\s+in\s+(.+)/i,
    /runs?\s+(?:a\s+)?(?:\w+\s+)?(?:startup|company|business)\s+in\s+(.+)/i,
    /(?:company|business)\s+(?:is\s+)?in\s+(?:the\s+)?(.+?)(?:\s+space|\s+sector|\s+industry|$)/i,
  ];

  for (const line of lines) {
    if (topics.length >= 2) break;
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        const topic = match[1].trim().replace(/[.,;]+$/, "");
        if (topic.length > 1 && topic.length < 50 && !topics.includes(topic)) {
          topics.push(topic);
        }
        break;
      }
    }
  }

  return topics.slice(0, 2);
}

/**
 * Fetch top headlines from Google News RSS.
 */
export async function fetchNewsHeadlines(
  country: string,
  lang: string,
  maxItems = 8,
): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss?hl=${lang}&gl=${country}&ceid=${country}:${lang.split("-")[0]}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Babji/1.0" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, url }, "Google News RSS fetch failed");
      return [];
    }

    const xml = await res.text();
    return parseRssItems(xml).slice(0, maxItems);
  } catch (err) {
    logger.warn({ err }, "Google News RSS fetch error");
    return [];
  }
}

/**
 * Fetch topic-specific news from Google News RSS search.
 */
export async function fetchTopicNews(
  query: string,
  country: string,
  lang: string,
  maxItems = 5,
): Promise<NewsItem[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encodedQuery}+when:1d&hl=${lang}&gl=${country}&ceid=${country}:${lang.split("-")[0]}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Babji/1.0" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, url }, "Google News topic RSS fetch failed");
      return [];
    }

    const xml = await res.text();
    return parseRssItems(xml).slice(0, maxItems);
  } catch (err) {
    logger.warn({ err }, "Google News topic RSS fetch error");
    return [];
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @babji/gateway test -- src/__tests__/news-fetcher.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/gateway/src/news-fetcher.ts packages/gateway/src/__tests__/news-fetcher.test.ts
git commit -m "feat: add news-fetcher module with Google News RSS parsing"
```

---

### Task 3: Wire getNewsSection() into DailyBriefingService

**Files:**
- Modify: `packages/gateway/src/daily-briefing.ts:1-13` (imports)
- Modify: `packages/gateway/src/daily-briefing.ts:46-61` (generateBriefing method)
- Add new method after line 241

**Step 1: Add import**

At `packages/gateway/src/daily-briefing.ts:10`, add after the existing imports:

```typescript
import { fetchNewsHeadlines, fetchTopicNews, extractTopicsFromMemory, timezoneToCountry } from "./news-fetcher.js";
```

**Step 2: Wire getNewsSection into generateBriefing**

In `packages/gateway/src/daily-briefing.ts`, modify the `Promise.all` block (lines 47-54) to add the news section:

Change:
```typescript
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
```

To:
```typescript
    const [calendarSection, emailSection, todosSection, memoryDatesSection, staleSection, newsSection] =
      await Promise.all([
        hasCalendar ? this.getCalendarSection(tenantId, timezone) : null,
        hasGmail ? this.getEmailSection(tenantId, tenant.name, timezone) : null,
        this.getTodosSection(tenantId, timezone),
        this.getMemoryDatesSection(tenantId),
        hasGmail ? this.getStaleFollowUpsSection(tenantId) : null,
        this.getNewsSection(tenantId, timezone),
      ]);

    if (calendarSection) sections.push(calendarSection);
    if (emailSection) sections.push(emailSection);
    if (todosSection) sections.push(todosSection);
    if (memoryDatesSection) sections.push(memoryDatesSection);
    if (staleSection) sections.push(staleSection);
    if (newsSection) sections.push(newsSection);
```

**Step 3: Add the getNewsSection method**

Add after the `getStaleFollowUpsSection` method (after line 241 in current file), before `composeBriefing`:

```typescript
  private async getNewsSection(
    tenantId: string,
    timezone: string,
  ): Promise<BriefingSection | null> {
    try {
      const { country, lang } = timezoneToCountry(timezone);

      // Fetch top headlines
      const headlines = await fetchNewsHeadlines(country, lang, 8);

      // Try to get personalized topic news from MEMORY.md
      const memoryContent = await this.deps.memory.readMemory(tenantId);
      const topics = extractTopicsFromMemory(memoryContent);

      let topicItems: Array<{ title: string; source: string; publishedAt: string }> = [];
      if (topics.length > 0) {
        const topicResults = await Promise.all(
          topics.map((topic) => fetchTopicNews(topic, country, lang, 3)),
        );
        topicItems = topicResults.flat();
      }

      // Combine and deduplicate
      const seen = new Set<string>();
      const allItems: Array<{ title: string; source: string }> = [];

      // Topic items first (more relevant), then general headlines
      for (const item of [...topicItems, ...headlines]) {
        const key = item.title.toLowerCase().slice(0, 40);
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push({ title: item.title, source: item.source });
        }
        if (allItems.length >= 10) break;
      }

      if (allItems.length === 0) return null;

      const lines = allItems.map((item) => {
        const src = item.source ? ` (${item.source})` : "";
        return `- ${item.title}${src}`;
      });

      return { label: "News", content: lines.join("\n") };
    } catch (err) {
      logger.warn({ err, tenantId }, "Daily briefing: news section failed");
      return null;
    }
  }
```

**Step 4: Update composeBriefing system prompt**

In `packages/gateway/src/daily-briefing.ts`, in the `composeBriefing` method (around line 263), update the system prompt to mention news. Change:

```
- If there are email drafts, mention them and how to act on them
```

To:

```
- If there are email drafts, mention them and how to act on them
- For news headlines, pick the 3-5 most relevant/important and present briefly
```

**Step 5: Build to verify compilation**

Run: `pnpm --filter @babji/gateway build`
Expected: No TypeScript errors

**Step 6: Run full test suite**

Run: `pnpm --filter @babji/gateway test`
Expected: All tests pass (existing + new)

**Step 7: Commit**

```bash
git add packages/gateway/src/daily-briefing.ts
git commit -m "feat: add news headlines section to daily briefing"
```

---

### Task 4: Delete bogus "Daily News Summary" reminder from production DB

**Files:**
- No code files changed — database cleanup only

**Step 1: Find and delete the bogus reminder**

```bash
ssh root@65.20.76.199 'source /opt/babji/.env && PGPASSWORD=babji_prod_2026 psql -h localhost -U babji -d babji -c "SELECT id, title, status FROM todos WHERE title ILIKE '\''%Daily News Summary%'\'';"'
```

**Step 2: Delete the todo and its scheduled job**

```bash
# Delete the scheduled job(s) referencing this todo
ssh root@65.20.76.199 'source /opt/babji/.env && PGPASSWORD=babji_prod_2026 psql -h localhost -U babji -d babji -c "DELETE FROM scheduled_jobs WHERE job_type = '\''todo_reminder'\'' AND payload::text ILIKE '\''%Daily News Summary%'\'';"'

# Delete the todo itself
ssh root@65.20.76.199 'source /opt/babji/.env && PGPASSWORD=babji_prod_2026 psql -h localhost -U babji -d babji -c "DELETE FROM todos WHERE title ILIKE '\''%Daily News Summary%'\'';"'
```

**Step 3: Verify cleanup**

```bash
ssh root@65.20.76.199 'source /opt/babji/.env && PGPASSWORD=babji_prod_2026 psql -h localhost -U babji -d babji -c "SELECT count(*) FROM todos WHERE title ILIKE '\''%Daily News Summary%'\'';"'
```
Expected: `0`

---

### Task 5: Build, deploy, and verify

**Step 1: Build locally**

```bash
pnpm --filter @babji/gateway build
```

**Step 2: Run tests**

```bash
pnpm --filter @babji/gateway test
```
Expected: All pass

**Step 3: Sync to server**

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/
```

**Step 4: Install deps on server (for fast-xml-parser)**

```bash
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'
```

**Step 5: Restart gateway**

```bash
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'
```

**Step 6: Verify health**

```bash
ssh root@65.20.76.199 'sleep 2 && curl -s http://localhost:3000/health'
```

**Step 7: Check logs for news section**

```bash
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 logs babji-gateway --lines 20 --nostream'
```

**Step 8: Update CHANGELOG.md**

Add entry to `CHANGELOG.md`:
```markdown
### Daily news summary in briefing [DEPLOYED]
- **What:** Added news headlines section to daily briefing. Fetches top headlines from Google News RSS + personalized topic news based on MEMORY.md keywords. 3-5 headlines per briefing. Zero cost (no API key needed). Also deleted bogus "Daily News Summary" recurring reminder.
- **Files:** `packages/gateway/src/news-fetcher.ts` (new), `packages/gateway/src/daily-briefing.ts`, `packages/gateway/src/__tests__/news-fetcher.test.ts` (new), `packages/gateway/package.json`
```

**Step 9: Commit changelog**

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog with news summary feature"
```
