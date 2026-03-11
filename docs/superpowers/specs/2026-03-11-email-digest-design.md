# Proactive Email Digest Design

## Goal

Make Babji a proactive executive assistant for email. Instead of waiting for the user to ask "check my emails", Babji periodically triages unread emails, flags what needs attention, drafts replies for actionable items, and lets the user approve/edit/send from the chat.

## Architecture

LLM-powered triage using `gemini-3.1-flash-lite-preview`. A new background job (`email_digest`) runs 2-3 times daily per user. Each run fetches unread emails, passes them through the lite LLM with user context for smart classification, generates draft replies for actionable emails, and sends a digest message via Telegram/WhatsApp.

No new database tables. Uses existing `scheduled_jobs` for scheduling and a tenant file (`pending-email-drafts.json`) for tracking draft state between digest and user response.

## Components

### EmailDigestRunner

New module: `packages/gateway/src/email-digest.ts`

Responsibilities:
- Fetch unread emails via Gmail API (filtered: `is:unread -category:promotions -category:social`, only emails newer than `lastCheckedAt`)
- Cap at 20 emails per batch; prioritize known contacts
- Call lite LLM with triage prompt + user context (name, MEMORY.md)
- For emails flagged `needsFullRead`: fetch full body via `read_email` (max 3 per digest)
- Format digest message with numbered items, priorities, and draft replies
- Write pending drafts to `data/tenants/{id}/pending-email-drafts.json`
- Send digest via channel adapter

### Triage LLM Call

**Model:** `gemini-3.1-flash-lite-preview`

**System prompt:**
```
You are an executive assistant triaging emails for {userName}.
Context about this person: {memoryContent}

Classify each email and suggest actions. Return JSON array.
```

**Input:** Array of `{id, from, subject, snippet, date}`

**Output:** JSON array:
```json
[
  {
    "emailId": "msg-123",
    "priority": "urgent|reply_needed|action|fyi|skip",
    "reason": "Client asking for contract review with deadline today",
    "suggestedAction": "reply|forward|archive|none",
    "draftReply": "Hi Alice, I'll review the contract...",
    "needsFullRead": true
  }
]
```

**Priority categories:**
- `urgent` -- time-sensitive, someone waiting, deadline mentioned
- `reply_needed` -- direct question or request, no hard deadline
- `action` -- needs user to do something (review, approve, sign)
- `fyi` -- informational, no response needed but worth knowing
- `skip` -- newsletters, promotions, automated notifications

**Smart triage signals:**
- Questions directed at the user
- Action requests ("please review", "can you send", "need your approval")
- Emails from people the user has previously replied to (not newsletters)
- Threads the user is already participating in
- Skip: promotions, social notifications, automated alerts

### Digest Message Format

```
You have 4 emails that need attention:

1. [URGENT] From: Alice Chen (alice@acme.com) - 2h ago
   "Contract review needed by EOD"
   -> Draft reply: "Hi Alice, I'll review the contract this
      afternoon and send my comments by 5 PM."

2. [REPLY NEEDED] From: Bob Kumar - 5h ago
   "Can we reschedule Thursday's call?"
   -> Draft reply: "Hi Bob, sure -- does Friday at 10 AM work?"

3. [FYI] From: Jira (notifications@atlassian.net)
   BAB-15 status changed to Done

4. [ACTION] From: Sarah (sarah@vendor.co) - 1d ago
   "Invoice #4521 attached for approval"
   -> No draft (needs your review first)

Reply with: "send 1" / "edit 2 to say Friday 2 PM instead" / "skip all"
```

If no emails need attention, no digest is sent (silent skip).

### Draft Reply Flow

**Pending drafts file:** `data/tenants/{id}/pending-email-drafts.json`

```json
{
  "digestTimestamp": "2026-03-11T07:30:00Z",
  "items": [
    {
      "index": 1,
      "emailId": "msg-123",
      "from": "alice@acme.com",
      "to": "alice@acme.com",
      "subject": "Re: Contract review",
      "draftReply": "Hi Alice, I'll review...",
      "threadId": "thread-abc"
    }
  ],
  "expiresAt": "2026-03-11T19:30:00Z"
}
```

Expires after 12 hours. Deleted after all items acted on or expired.

**User interaction:** PromptBuilder injects pending drafts into the system prompt when the file exists. Brain handles naturally:
- "send 1" or "send all" -> Brain calls `gmail.send_email`
- "edit 2 to be shorter" -> Brain modifies draft, shows it, waits for approval
- "skip 3" or "skip all" -> Brain discards drafts
- "reply to Alice saying..." -> Brain overrides draft entirely

No new skill actions needed for draft interaction -- existing `gmail.send_email` + conversation handles it.

**Writing style:** Triage prompt instructs LLM to match user's communication style based on MEMORY.md context. Concise and professional by default.

### Scheduling

**Auto-enabled on Gmail connect:** When post-connect flow runs after Gmail OAuth, seed an `email_digest` job:

```
jobType: "email_digest"
scheduleType: "daily"
recurrenceRule: "08:00,17:00"
payload: { lastCheckedAt: null }
status: "active"
```

Two runs per day by default (morning + evening, user's local time).

**User-configurable:** New babji skill action:

```
babji.configure_email_digest(
  frequency: "morning_only" | "morning_evening" | "three_times" | "off"
  times?: string[]  // optional custom times, e.g. ["07:00", "12:00", "18:00"]
)
```

**Job payload state:**

```json
{
  "lastCheckedAt": "2026-03-11T08:00:00Z",
  "emailsTriaged": 47,
  "draftsAccepted": 12,
  "draftsSentDirectly": 8
}
```

`lastCheckedAt` ensures emails are never flagged twice across digest runs.

### PromptBuilder Changes

Two new sections injected when Gmail is connected:

1. **Email digest instructions** (always present when Gmail connected):
```
## Email digest
Babji checks your email automatically and sends digests of what needs attention.
- Use babji.configure_email_digest to change frequency or turn off
- When the user mentions email digests, scheduling, or "check my emails", use this action
```

2. **Pending drafts context** (only when pending-email-drafts.json exists and not expired):
```
## Pending email drafts
You sent an email digest earlier. The user may respond with actions:
- "send 1" or "send all" -> call gmail.send_email with the draft
- "edit 2 to be shorter" -> modify the draft, show it, wait for approval
- "skip 3" or "skip all" -> discard those drafts
- "reply to Alice saying..." -> override the draft entirely

Pending drafts:
1. To: alice@acme.com | Subject: Re: Contract review | Draft: "Hi Alice..."
2. To: bob@example.com | Subject: Re: Reschedule | Draft: "Hi Bob..."
```

## Files

**New:**
- `packages/gateway/src/email-digest.ts` -- EmailDigestRunner class

**Modified:**
- `packages/gateway/src/job-runner.ts` -- add `email_digest` job type
- `packages/gateway/src/message-handler.ts` -- seed email_digest job on Gmail connect; handle `configure_email_digest` babji action
- `packages/agent/src/prompt-builder.ts` -- inject pending drafts + email digest instructions
- `packages/skills/src/registry.ts` -- add `configure_email_digest` to babji skill actions

## Cost

~2 LLM calls per user per day (lite model, ~2K tokens each) + 2-8 Gmail API calls. Negligible.

## No New Dependencies

Uses existing GmailHandler, MultiModelLlmClient (lite), channel adapters, and scheduled_jobs table.
