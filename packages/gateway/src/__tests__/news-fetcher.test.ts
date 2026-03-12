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
