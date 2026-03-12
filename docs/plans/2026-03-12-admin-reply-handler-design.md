# Admin Reply Handler — Profile Correction via Telegram

## Problem

When the `profile_scan` job discovers new meeting attendees for tomorrow, it auto-researches them via DataForSEO + Scrapin and notifies the admin on Telegram. Currently the admin must open the web dashboard (`/admin → Profile Directory`) to correct any wrong LinkedIn URLs. This is friction-heavy for a simple correction.

## Solution

Allow the admin to reply directly in Telegram with a LinkedIn URL to correct a profile. Two reply formats supported:

1. **`email linkedin-url`** — explicit mapping, no ambiguity
2. **Bare LinkedIn URL** — LLM matches the URL slug against recent attendee names

On match, babji re-scrapes the profile via Scrapin immediately and confirms the update.

## Interaction Examples

### Bare URL (LLM match)

```
Admin bot:
  New meeting attendees (2026-03-15):
  1. jane@startup.io → Jane Doe
     Meeting: "Partner Sync" (for Vishal)

Admin replies: linkedin.com/in/jane-doe-ceo

Bot: ✓ Updated Jane Doe (jane@startup.io) with linkedin.com/in/jane-doe-ceo
```

### Email + URL (direct match)

```
Admin replies: bob@bigcorp.com linkedin.com/in/robert-wilson

Bot: ✓ Updated Bob Wilson (bob@bigcorp.com) with linkedin.com/in/robert-wilson
```

### Ambiguous match (LLM asks)

```
Admin bot:
  1. john@acme.com → John Smith
  2. john@other.com → John Smithson

Admin replies: linkedin.com/in/johnsmith

Bot: Did you mean John Smith (john@acme.com) or John Smithson (john@other.com)?

Admin replies: 1

Bot: ✓ Updated John Smith (john@acme.com) with linkedin.com/in/johnsmith
```

## Architecture

### Components Modified

| File | Change |
|------|--------|
| `packages/gateway/src/admin-notifier.ts` | Add `startListening()`, `handleReply()`, recent notifications state, disambiguation state |
| `packages/gateway/src/index.ts` | Call `adminNotifier.startListening(deps)` at startup |

### No new files needed

All logic lives in `AdminNotifier` since it already owns the admin bot instance and Telegram chat ID.

### AdminNotifier Changes

```typescript
// New state
private recentAttendees: Array<{
  email: string;
  displayName: string;
  meeting: string;
  tenantName: string;
  notifiedAt: Date;
}> = [];

private pendingDisambiguation: {
  linkedinUrl: string;
  candidates: Array<{ email: string; displayName: string }>;
  expiresAt: Date;
} | null = null;

// New methods
startListening(deps: { db, vault, peopleConfig }): void
handleReply(text: string): Promise<void>
```

### Recent Attendees Buffer

- In-memory array, max 50 entries, 48-hour TTL
- Populated by `notifyNewProfiles()` (already called by profile_scan job)
- No DB needed — these are ephemeral and only matter for the reply window

### Reply Parsing Logic

```
1. Is there a pending disambiguation? → check if reply is a number (1, 2, etc.)
2. Does text contain an email + LinkedIn URL? → direct match via DB lookup
3. Does text contain just a LinkedIn URL? → LLM match against recentAttendees
4. Otherwise → ignore (not a profile correction)
```

### LLM Matching (bare URL)

Use the lite model (`gemini-2.0-flash-lite`) with a simple prompt:

```
Given these recent meeting attendees:
1. jane@startup.io → Jane Doe (Meeting: "Partner Sync")
2. bob@bigcorp.com → Bob Wilson (Meeting: "Q1 Review")

The admin sent this LinkedIn URL: linkedin.com/in/jane-doe-ceo

Which attendee does this URL most likely belong to?
Reply with JSON: { "email": "...", "confidence": "high"|"low" }
If ambiguous, reply: { "email": null, "confidence": "ambiguous", "candidates": ["email1", "email2"] }
```

- **High confidence** → proceed with re-scrape
- **Ambiguous** → ask admin to pick (store disambiguation state)

### Re-scrape Flow

1. Call `PeopleHandler.lookup_profile(linkedinUrl)` (Scrapin enrichment)
2. Update `profile_directory` row:
   - `linkedinUrl` = new URL
   - `scrapedData` = new enrichment data
   - `status` = `"corrected"`
   - `verifiedBy` = `"admin-telegram"`
   - `verifiedAt` = now
   - `scrapedAt` = now
3. Send confirmation message to admin

### Dependencies Needed by AdminNotifier

`startListening()` receives:

```typescript
{
  db: Database;                    // for profile_directory updates
  peopleConfig: {                  // for Scrapin API
    scrapinApiKey: string;
    dataforseoLogin: string;
    dataforseoPassword: string;
  };
}
```

## Edge Cases

| Case | Behavior |
|------|----------|
| Email not in profile_directory | Reply: "No profile found for {email}" |
| Scrapin enrichment fails | Reply: "Updated LinkedIn URL but enrichment failed — will retry on next briefing" (still save URL) |
| Admin sends random text | Ignore silently (no LinkedIn URL detected) |
| Disambiguation expires (5 min) | Clear state, treat next reply normally |
| Multiple admins | Single admin chat ID, no conflict |

## Not Included (YAGNI)

- No command system (`/list`, `/verify`, `/help`)
- No admin dashboard changes
- No persistent reply tracking in DB
- No multi-admin support
- No batch URL updates
