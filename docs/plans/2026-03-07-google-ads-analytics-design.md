# Design: Google Ads (Rewrite) + Google Analytics Integration

**Date:** 2026-03-07
**Approach:** Two separate skills (Approach B)

## Context

Babji already has Gmail and Google Calendar integrations. Marketing managers need Google Ads and Google Analytics visibility through the conversational interface. An existing Google Ads handler uses raw HTTP/fetch — it will be rewritten to use `googleapis` for consistency.

## Google Ads Skill (Rewrite)

Rewrite `google-ads/handler.ts` to use the `googleapis` library instead of raw HTTP, matching the Gmail/Calendar pattern.

### Actions (8 total)

| Action | Type | Description |
|--------|------|-------------|
| `list_campaigns` | read | List campaigns with status, budget, channel type |
| `get_campaign_report` | read | Performance metrics for a campaign over a date range |
| `get_ad_group_report` | read | Performance breakdown by ad group within a campaign |
| `get_keyword_report` | read | Keyword performance + search terms |
| `update_budget` | write | Change daily budget for a campaign |
| `pause_campaign` | write | Pause a running campaign |
| `enable_campaign` | write | Re-enable a paused campaign |
| `get_audience_insights` | read | Audience demographics and device breakdown |

### Auth

- Scope: `https://www.googleapis.com/auth/adwords`
- Pattern: `google.auth.OAuth2()` with access token
- Google Ads also requires a `developer_token` (stored alongside OAuth token in vault)

## Google Analytics Skill (New)

New `google-analytics/` skill using GA4 Data API (`analyticsdata`) and GA4 Admin API (`analyticsadmin`).

### Actions (8 total)

| Action | Type | API | Description |
|--------|------|-----|-------------|
| `list_accounts` | read | Admin | List GA4 accounts and their properties |
| `get_traffic_overview` | read | Data | Sessions, users, pageviews, bounce rate, avg session duration |
| `get_traffic_sources` | read | Data | Breakdown by source/medium |
| `get_top_pages` | read | Data | Most visited pages with metrics |
| `get_conversions` | read | Data | Conversion events with counts and values |
| `get_audience_demographics` | read | Data | User breakdown by country, city, age, gender, device |
| `get_realtime_report` | read | Data | Active users, top pages, sources in last 30 min |
| `get_acquisition_report` | read | Data | New vs returning users, acquisition channels |

### Auth

- Scopes: `analytics.readonly`, `analytics.manage.users.readonly`
- Pattern: Same as Gmail/Calendar — `google.auth.OAuth2()` with access token

### Default date range

All reporting actions default to last 28 days if `start_date`/`end_date` not provided.

## Wiring & Registration

### `packages/skills/src/registry.ts`
Add both skill definitions to `allSkills` array.

### `packages/gateway/src/message-handler.ts`
- Register handlers when tenant has connections (`google_ads`, `google_analytics`)
- Add provider aliases:
  - `ads`, `google ads`, `adwords` → `google_ads`
  - `analytics`, `google analytics`, `ga`, `ga4` → `google_analytics`
- Add OAuth configs with correct scopes

### `packages/skills/src/index.ts`
Export both new handler classes.

## Files Changed

| File | Action |
|------|--------|
| `packages/skills/src/google-ads/handler.ts` | Rewrite |
| `packages/skills/src/google-ads/definition.yaml` | Update |
| `packages/skills/src/google-analytics/handler.ts` | Create |
| `packages/skills/src/google-analytics/definition.yaml` | Create |
| `packages/skills/src/index.ts` | Update |
| `packages/skills/src/registry.ts` | Update |
| `packages/gateway/src/message-handler.ts` | Update |

## Dependencies

No new dependencies — `googleapis` v144 already covers Google Ads API and GA4 Data/Admin APIs.
