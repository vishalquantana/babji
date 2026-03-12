# Daily News Summary — Design

## Goal

Add a news headlines section to the existing daily briefing. Shows 3-5 top headlines (mix of general news + personalized topics from MEMORY.md), sourced from Google News RSS at zero cost.

## Architecture

The news section plugs into `DailyBriefingService` as a new `getNewsSection()` method, following the same pattern as calendar/email/todos sections.

```
generateBriefing()
  → Promise.all([
      getCalendarSection(),
      getEmailSection(),
      getTodosSection(),
      getMemoryDatesSection(),
      getStaleFollowUpsSection(),
      getNewsSection()            ← NEW
    ])
  → composeBriefing()
```

## Data Source: Google News RSS

No API key, no signup, no rate limits.

### Endpoints

- **Top headlines:** `https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en`
- **Topic search:** `https://news.google.com/rss/search?q=<topic>&when:1d&hl=en-IN&gl=IN&ceid=IN:en`
- **By category:** `https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-IN&gl=IN&ceid=IN:en`

### RSS Item Shape

```xml
<item>
  <title>Headline here - Source Name</title>
  <link>https://news.google.com/rss/articles/...</link>
  <pubDate>Wed, 12 Mar 2026 08:00:00 GMT</pubDate>
  <source url="https://example.com">Source Name</source>
</item>
```

## New File: `packages/gateway/src/news-fetcher.ts`

Responsibilities:
- `fetchNewsHeadlines(country, language)` — fetch top headlines RSS, parse XML, return `Array<{ title, source, publishedAt }>`
- `fetchTopicNews(query, country, language)` — fetch search-based RSS for a specific topic
- Parse with `fast-xml-parser` (lightweight, zero-dep XML parser)
- Strip ` - Source Name` suffix from titles (since `<source>` tag provides it separately)
- No links returned (SOUL.md prohibits sending URLs)

## Topic Extraction from MEMORY.md

Simple heuristic (no LLM call):
- Scan MEMORY.md for lines containing: "works in", "industry", "interested in", "company", "business", "startup", "sector"
- Extract the associated keyword/phrase
- If nothing found, skip topic feed — just use top headlines
- Keeps cost at zero

## Localization

Derive country from tenant's `timezone` field:
- `Asia/Kolkata` → `IN` / `en-IN`
- `America/New_York` → `US` / `en-US`
- Simple mapping for top 10 timezones, fallback to `US` / `en-US`

No new DB columns needed.

## Integration into DailyBriefingService

New method `getNewsSection()`:
1. Determine tenant country from timezone
2. Fetch top headlines (5-8 items)
3. Read MEMORY.md → extract topics → fetch topic news if found (5-8 items)
4. Combine, deduplicate by title similarity, take top 8-10
5. Return as `BriefingSection { label: "News", content: "..." }`

The existing `composeBriefing()` LLM call handles curating these into 3-5 relevant items and weaving them into the conversational message. No new LLM calls needed.

## Error Handling

Same as every other section — wrapped in try/catch, returns `null` on failure. If Google News RSS is unreachable, the briefing just skips news silently.

## Cost

- 1-2 HTTP fetches per tenant per briefing
- No API key, no paid tier
- No additional LLM calls
- Zero incremental cost

## Files Changed

| File | Change |
|------|--------|
| `packages/gateway/src/news-fetcher.ts` | NEW — RSS fetch & parse |
| `packages/gateway/src/daily-briefing.ts` | Add `getNewsSection()`, wire into `generateBriefing()` |
| `packages/gateway/package.json` | Add `fast-xml-parser` dependency |

## Cleanup

Delete the bogus "Daily News Summary" recurring reminder from the `todos` + `scheduledJobs` tables on the production database.
