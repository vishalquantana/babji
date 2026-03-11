# Relationship Intelligence Design (BAB-23)

## Problem

Executives need instant context about people: "Who is Srinivas?", "When did I last talk to Bhanu?", "What did we discuss with Sarah?" A real EA remembers all of this. Today Babji stores facts in a flat MEMORY.md with no structure around who a fact is about, and doesn't proactively surface relationship context.

## Approach: People-Aware Memory

Enhance the existing file-based memory system to organize facts by person. No new database tables, no new external APIs -- just smarter extraction and structured file storage.

## Data Sources

- **Chat conversations** (existing, enhanced) -- extract people-related facts from every conversation
- **Email** (piggyback) -- when Babji already reads emails (inbox check, email digest, user request), extract people signals from the content
- **Calendar** (piggyback) -- when briefings or daily summaries run, log interactions from meeting attendees

All extraction uses `gemini-3.1-flash-lite-preview` (lite model), runs fire-and-forget (non-blocking).

## People File Storage

Each tenant gets a `people/` directory:

```
data/tenants/<tenant-id>/
  SOUL.md
  MEMORY.md
  CONNECTIONS.md
  people/
    srinivas-kumar.md
    bhanu-pratap.md
    alice-johnson.md
```

Person file format:

```markdown
# Srinivas Kumar
email: srinivas@acmecorp.com
company: Acme Corp
role: VP Engineering

## Facts
- [2026-03-10] Met at the TechCrunch conference in Bangalore
- [2026-03-11] Interested in our Series B investment
- [2026-03-11] Has a daughter who just started at IIT Delhi

## Dates
- [BIRTHDAY: 04-15] Birthday is April 15
- [FOLLOWUP: 2026-03-18] Promised to send partnership proposal by March 18

## Interactions
- [2026-03-11] [email] Discussed partnership terms (3 emails exchanged)
- [2026-03-10] [meeting] 1:1 catch-up, 30 min
- [2026-03-08] [email] Intro email from Bhanu
```

- Filename: normalized lowercase with hyphens from display name
- Header block: structured fields (email, company, role)
- Three sections: Facts, Dates, Interactions
- MemoryManager gets new methods: `readPerson()`, `writePerson()`, `listPeople()`, `findPersonByEmail()`, `scanUpcomingDates()`

## Enhanced Extraction

The MemoryExtractor prompt changes from returning `string[]` to:

```json
{
  "general_facts": ["Prefers morning meetings"],
  "people_facts": [
    {
      "person": "Srinivas Kumar",
      "email": "srinivas@acme.com",
      "facts": ["Interested in Series B"],
      "dates": ["BIRTHDAY: 04-15 | Birthday is April 15"],
      "company": "Acme Corp",
      "role": "VP Engineering"
    }
  ]
}
```

- `general_facts` go to MEMORY.md (same as today, backward-compatible)
- `people_facts` get routed to the appropriate person file
- Existing person file content is passed to the extraction prompt to prevent duplicates
- Source is tagged: `[chat]`, `[email]`, or `[meeting]`

### Email piggyback extraction

When GmailHandler fetches emails (inbox check, digest, user reads an email), an async people extraction pass runs on the fetched content. No extra Gmail API calls.

### Calendar piggyback extraction

When calendar events are processed (briefings, daily summary), attendee interaction entries are logged to person files. Lightweight -- just "met on X date for Y topic".

## Proactive Surfacing

### 1. Before Meetings (enhance existing briefing)

`MeetingBriefingService.generateBriefing()` checks for person files for each attendee. If found, injects relationship context alongside LinkedIn data:

> "Sarah Chen, VP Product at Acme Corp... Your history: You last emailed 2 weeks ago about the partnership deal. She mentioned her team is expanding. Birthday coming up April 15."

### 2. When Someone is Mentioned (in-conversation)

New `recall_person` Brain tool:

```
recall_person(name: string, email?: string)
-> Returns person file content, or "No information found about [name]"
```

The Brain calls this during the ReAct loop when a person name comes up and it needs context. Keeps the base system prompt lean (no preloading all contacts).

### 3. Morning Briefing Digest

The daily briefing job scans all `people/` files for:

- **Upcoming dates:** Birthdays, deadlines, follow-ups within the next 7 days
- **Stale contacts:** People the user interacts with regularly but hasn't contacted in 2+ weeks
- **Open follow-ups:** `[FOLLOWUP: date]` entries that are approaching or overdue

Appended as a "Relationship Alerts" section in the daily briefing.

## Person Matching / Deduplication

- Email is the canonical identifier (exact match)
- Name matching: extraction prompt instructed to use full names; fuzzy match on lookup
- Aliases accumulated in person file header ("Also known as: Srini, SK")
- If ambiguous, facts fall back to MEMORY.md rather than risk misattribution

## File Size Management

- Interactions section capped at 20 most recent entries
- Facts deduplicated via extraction prompt (existing facts passed as context)
- If a person file exceeds ~4KB, a summarization pass condenses older facts (using lite model)

## Privacy

- All person data is per-tenant (stored in their tenant directory)
- No cross-tenant sharing of relationship data
- Person files are never sent to external APIs -- only used in LLM context

## Failure Modes

- If people extraction fails (LLM error, malformed JSON): fall back to current behavior (dump to MEMORY.md)
- If person file can't be read during surfacing: skip gracefully
- Piggyback extraction failure doesn't block the email/calendar response (fire-and-forget)

## Files Modified

| File | Change |
|------|--------|
| `packages/memory/src/memory-manager.ts` | Add `readPerson()`, `writePerson()`, `listPeople()`, `findPersonByEmail()`, `scanUpcomingDates()` |
| `packages/agent/src/memory-extractor.ts` | New prompt returning `{ general_facts, people_facts }`, backward-compatible |
| `packages/gateway/src/message-handler.ts` | Route people_facts to person files after extraction |
| `packages/skills/src/gmail/handler.ts` | After fetching emails, fire async people extraction |
| `packages/gateway/src/meeting-briefing.ts` | Inject person file context into briefings |
| `packages/skills/src/registry.ts` | Register `recall_person` as a Brain tool |
| `packages/gateway/src/job-runner.ts` | Add relationship alerts to daily briefing job |

No new packages, no new DB tables, no new external APIs.
