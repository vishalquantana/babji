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
