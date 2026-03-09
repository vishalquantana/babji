# Profile Verification & Correction Workflow — Design Doc

**Date:** 2026-03-09
**Status:** Approved
**Depends on:** Meeting Attendee Briefing (BAB-5, deployed)

## Problem

The meeting briefing feature researches external attendees via email → LinkedIn lookup. This can match the wrong LinkedIn profile (common names, domain mismatches). Wrong profiles get sent to users in briefings, which is worse than no briefing at all.

## Solution

Scan calendars a day ahead (evening before), research new external attendees, store results in a global profile directory (shared across all tenants), and notify the admin for review. Admin can verify correct profiles or paste the right LinkedIn URL and trigger a re-scrape. Corrected profiles are used for all future briefings.

## Architecture: Approach A — DB Table + Evening Scanner

### Why this approach
- DB table provides queryable, concurrent-access-safe global storage
- Evening scan catches wrong profiles before they reach users
- Global directory means a correction benefits all tenants
- Fits naturally into existing admin dashboard and notification infrastructure

### Alternatives considered
- **Shared JSON file** — doesn't scale, no concurrent access safety, no dashboard queryability
- **On-demand only (no evening scan)** — defeats "get ahead of the curve" goal; first briefing with wrong profile still goes out

---

## 1. Global Profile Directory Schema

New `profile_directory` table:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | Row ID |
| `email` | varchar(255) UNIQUE | Attendee email (global lookup key) |
| `display_name` | varchar(255) | Name from calendar or LinkedIn |
| `linkedin_url` | text | LinkedIn profile URL (correctable by admin) |
| `scraped_data` | jsonb | Full scraped profile from Scrapin.io |
| `status` | enum('pending','verified','corrected','failed') | Verification state |
| `scraped_at` | timestamp | When last scraped |
| `verified_by` | varchar(100) | Admin who verified/corrected (nullable) |
| `verified_at` | timestamp | When verified/corrected (nullable) |
| `created_at` | timestamp | First seen |

**Key behaviors:**
- Email is the global lookup key (unique, case-insensitive)
- A corrected/verified profile is trusted globally for all tenants
- Replaces per-tenant `briefing-cache.json` disk cache

**Staleness rules for briefing lookups:**
- `verified` or `corrected` + `scraped_at` < 30 days → use directly
- `pending` + `scraped_at` < 7 days → use (good enough, not yet reviewed)
- `failed` or stale → re-research and update

---

## 2. Evening Scanner Job

**Job type:** `profile_scan`

**Scheduling:** The daily calendar summary job (morning) ensures a `profile_scan` job exists for 6 PM local time. If one already exists for today, skip (idempotent).

**Scanner flow:**
1. Fetch tomorrow's calendar events (midnight+24h to midnight+48h)
2. Extract external attendees (domain-based filtering, same as briefings)
3. For each email NOT already in `profile_directory`:
   - Research via PeopleHandler (Scrapin.io + DataForSEO)
   - Insert into `profile_directory` with status `pending`
4. Cap: max 20 new profiles per scan run (excess carry to next scan)
5. If any new profiles found, notify admin

**Scope:** All calendar-connected tenants get scanned. One `profile_scan` job per tenant.

---

## 3. Admin Telegram Notification

When the evening scan finds new profiles, send to admin Telegram bot:

```
New meeting attendees discovered (tomorrow):

1. john@acme.com -> John Smith
   VP Engineering at Acme Corp
   linkedin.com/in/johnsmith
   Meeting: "Q1 Review" (10:00 AM, for Vishal)

2. sarah@startup.io -> Sarah Lee
   CEO at Startup Inc
   linkedin.com/in/sarahlee
   Meeting: "Partnership Discussion" (2:00 PM, for Vishal)

Review & correct: babji.quantana.top/admin -> Profile Directory
```

If PeopleHandler fails for an email, show it as flagged:

```
3. unknown@newco.com -> (Research failed)
   Could not find LinkedIn profile
   Meeting: "Intro Call" (4:00 PM, for Vishal)
```

---

## 4. Admin Dashboard — Profile Directory Section

New tab on the admin dashboard alongside existing Tenants, Connections, Skill Requests, Activity sections.

**Table columns:** Email, Name/Title, LinkedIn URL, Status badge, Last Scraped, Actions

**Filter buttons:** All | Pending | Failed (pending/failed shown first by default)

**Actions per row:**
- **Verify** — one-click, marks as `verified`
- **Edit** — opens expanded view with editable LinkedIn URL field
- **Rescrape** — re-fetch with current URL

**Expanded row shows:** Full profile (current role, previous roles, education, location, skills, company info, LinkedIn URL). Editable LinkedIn URL field with "Save & Rescrape" button.

**Correction flow:**
1. Admin sees wrong profile for john@acme.com
2. Clicks Edit, pastes correct LinkedIn URL
3. Clicks "Save & Rescrape"
4. API calls Scrapin.io `lookup_profile` with the new URL
5. Updates `linkedin_url`, `scraped_data`, `scraped_at`, `status=corrected`, `verified_by`, `verified_at`
6. All future briefings for john@acme.com across all tenants use the corrected profile

---

## 5. Integration with Existing Briefing System

**`MeetingBriefingService.researchAttendee()` changes:**
- Query `profile_directory` by email instead of per-tenant disk cache
- If found and fresh per staleness rules above, return `scraped_data`
- If not found, research via PeopleHandler, insert into `profile_directory` with status `pending`
- Per-tenant `briefing-cache.json` files become obsolete

**No retroactive corrections:** Already-sent briefings are not re-sent if a profile is corrected. The corrected profile is used for the next briefing involving that person.

---

## 6. Admin API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/profiles` | List profiles, `?status=pending` filter |
| PATCH | `/api/admin/profiles/:id` | Update LinkedIn URL |
| POST | `/api/admin/profiles/:id/verify` | Mark as verified |
| POST | `/api/admin/profiles/:id/rescrape` | Re-scrape with current URL |

All endpoints require admin auth (same cookie-based auth as existing dashboard).

---

## 7. Error Handling

- **Scrapin.io down during scan:** Mark as `failed`, admin sees flagged entry
- **Wrong corrected URL:** Admin can correct again (no limit on corrections)
- **Rate limiting:** Max 20 new profiles per scan run
- **No new emails:** No notification sent (quiet operation)
- **Tenant has no calendar:** Skip silently during scan

---

## Files Affected

**New:**
- `packages/db/src/schema.ts` — `profileDirectory` table + enums
- `apps/oauth-portal/src/app/admin/dashboard/profiles/` — Dashboard UI
- `apps/oauth-portal/src/app/api/admin/profiles/` — API routes

**Modified:**
- `packages/gateway/src/meeting-briefing.ts` — Switch from disk cache to DB lookup
- `packages/gateway/src/job-runner.ts` — New `profile_scan` job type, schedule from calendar summary
- `packages/gateway/src/server.ts` — Profile API endpoints (if not using Next.js API routes)
- `packages/gateway/src/admin-notifier.ts` — New profile scan notification method

**Deprecated:**
- Per-tenant `briefing-cache.json` disk files (no longer written to, eventually removed)
