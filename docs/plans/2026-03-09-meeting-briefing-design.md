# Meeting Attendee Briefing — Design Doc

**Goal:** Before calendar meetings, automatically research external attendees (non-teammates) via LinkedIn/Google and deliver a rich dossier so the user feels prepared.

**Approach:** Piggyback on the existing daily calendar summary job. When it runs, detect external attendees and either research immediately (morning mode) or schedule pre-meeting briefing jobs (pre-meeting mode).

---

## Feature Flow

### Discovery (organic)

When the daily calendar summary job runs and detects external attendees for the first time, Babji appends:

> You have 3 meetings today with people outside your team. Want me to research them and send you a briefing?

If the user says yes, Brain calls `babji.enable_meeting_briefings` with their timing preference. The feature is enabled going forward.

### Ongoing operation

Once enabled, the daily calendar summary job automatically:

1. Fetches the day's events (already does this)
2. Identifies external attendees by comparing email domains against the tenant's stored `emailDomain`
3. **Morning mode:** Researches all externals during the calendar summary job, sends briefing immediately after the summary
4. **Pre-meeting mode:** Schedules one-shot `meeting_briefing` jobs 1 hour before each meeting. Each job researches the attendees for that specific meeting and sends the dossier

### On-demand

User can say "brief me on my 2 PM meeting" anytime. Brain calls `research_meeting_attendees` which does it immediately.

---

## Internal vs External Filtering

**Domain-based:** The tenant's email domain is inferred from their Google Calendar organizer/creator email on the first calendar summary run and stored in `emailDomain` on the tenants table.

Attendees are classified as external if their email domain differs from the tenant's domain. The tenant's own email is always excluded.

---

## Research Pipeline

### Step 1 — Extract external attendees

From each calendar event's attendee list, filter out:
- The tenant's own email
- Emails matching the tenant's domain (teammates)
- Duplicates across meetings (research once, reference in each briefing)

### Step 2 — Research each person

Uses existing People Research infrastructure (Scrapin.io + DataForSEO):

1. Try Scrapin.io email-to-LinkedIn lookup first
2. Fall back to `research_person` with display name + email domain as company hint
3. Cache results on disk at `/opt/babji/data/tenants/<id>/briefing-cache.json` — skip re-research if fetched within 7 days

### Step 3 — Format the briefing

Run raw profile data through Brain (lite model) to produce a conversational, scannable summary. Per person:

- Name, current title, company
- Previous roles (top 2-3, condensed with tenure)
- Education
- Key skills relevant to the meeting context
- Location
- Company overview (industry, size, what they do)
- LinkedIn URL

### Step 4 — Deliver

Send via the tenant's channel (Telegram/WhatsApp).
- **Morning mode:** One message covering all meetings
- **Pre-meeting mode:** One message per meeting, sent 1 hour before

### Briefing format example

```
Meeting: Product Review with Acme Corp (2:00 PM)

-- Sarah Chen (sarah@acme.com)
VP of Product at Acme Corp
Previously: Senior PM at Stripe (4 yrs), PM at Google (3 yrs)
Stanford University, MS Computer Science
Skills: Product Strategy, B2B SaaS, Data Analytics
Based in San Francisco
Acme Corp: Enterprise analytics platform, 200-500 employees, Series C
linkedin.com/in/sarahchen

-- Mike Torres (mike@acme.com)
Head of Engineering at Acme Corp
Previously: Staff Eng at Meta (5 yrs)
MIT, BS Computer Science
Skills: Distributed Systems, Team Leadership, Cloud Architecture
Based in Austin, TX
linkedin.com/in/miketorres
```

---

## Schema Changes

### Tenants table (ALTER)

- `email_domain` — varchar(100), nullable. Inferred from Google Calendar organizer email on first calendar summary run.
- `meeting_briefing_pref` — varchar(20), nullable. `null` = disabled, `"morning"` = with calendar summary, `"pre_meeting"` = 1 hour before each meeting.

### No new tables

- Briefing cache: on-disk JSON per tenant (`briefing-cache.json`)
- Pre-meeting delivery: existing `scheduledJobs` table with job type `"meeting_briefing"`

---

## New Babji Skill Actions

### `enable_meeting_briefings`

Brain calls when user opts in.

- Params: `timing` (required, `"morning"` | `"pre_meeting"`)
- Stores preference in tenant record
- Returns confirmation text including credit cost note

### `disable_meeting_briefings`

Turn it off.

- No params
- Sets `meeting_briefing_pref` to null

### `research_meeting_attendees`

On-demand briefing.

- Params: `meeting_query` (required, string — e.g. "2 PM meeting", "meeting with Acme")
- Fetches today's calendar, fuzzy-matches the meeting, researches external attendees, returns formatted briefing

---

## New Job Type: `meeting_briefing`

**Payload:** `{eventSummary, startTime, attendees: [{email, displayName}], tenantDomain}`

When fired:
1. Research each attendee (check cache first)
2. Format briefing via lite model
3. Send via tenant's channel
4. Re-check calendar event still exists before sending (skip if cancelled)

---

## Prompt Changes

- Add meeting briefing rules to PromptBuilder so Brain knows the three new actions and when to use them
- Daily calendar summary: if externals detected and briefing not yet enabled, Brain suggests the feature organically
- Include credit cost guidance: "Each person researched uses 1 of your daily uses"

---

## Error Handling & Edge Cases

- **No external attendees:** Skip silently, no briefing
- **Research fails for an attendee:** Include what we found (name + email), note "Could not find LinkedIn profile"
- **All research fails:** Send brief note acknowledging the attempt failed
- **Too many meetings/attendees:** Cap at 5 meetings, 10 external attendees per day
- **Meeting cancelled after job scheduled:** Re-check event exists when job fires; skip if cancelled
- **Credits:** Each person researched costs 1 credit. Mentioned in opt-in confirmation

---

## Infrastructure Reuse

| Component | Already exists | New work |
|-----------|---------------|----------|
| Calendar event fetching | Daily summary job | Extract attendee emails |
| People research | Scrapin.io + DataForSEO handlers | Wire into briefing pipeline |
| Job scheduling | `scheduledJobs` table + JobRunner | New `meeting_briefing` job type |
| Channel delivery | Telegram/WhatsApp adapters | Reuse existing |
| LLM formatting | Lite model via Brain | New briefing formatting prompt |
