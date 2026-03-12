# Connect Reminder — Design Document

**Date:** 2026-03-12
**Status:** Approved

## Problem

Some users complete onboarding but never connect Gmail or Google Calendar. Without these connections, Babji can't deliver its core value (inbox summaries, meeting briefings, smart reminders). We need a gentle, persistent nudge to encourage connection.

## Solution

A new `connect_reminder` scheduled job that sends weekly evening reminders to users who haven't connected Gmail and/or Calendar. Reminders are value-focused, cap at 4 attempts, and auto-stop when the user connects.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Timing | 6:00 PM local | Users are more likely to have time to set things up in the evening |
| Frequency | Weekly (every 7 days) | Daily would be annoying; weekly is persistent but respectful |
| Max reminders | 4 (1 month) | Enough persistence without being spammy; auto-stops after |
| "Stop" handling | Snooze +7 days | User says "stop reminding" -> skip one week, count still increments toward cap |
| Auto-complete | On connect | OAuth callback checks if both services connected, marks job done |
| Tone | Value-focused | Highlight what Babji can do once connected, not just "please connect" |

## Database Changes

### `tenants` table — new column

| Column | Type | Default | Values |
|--------|------|---------|--------|
| `connectReminderStatus` | varchar | `"active"` | `"active"`, `"snoozed"`, `"exhausted"`, `"connected"` |

### `scheduledJobs` — new rows (no schema change)

| Field | Value |
|-------|-------|
| `jobType` | `"connect_reminder"` |
| `scheduleType` | `"daily"` |
| `recurrenceRule` | `"18:00"` |
| `payload` | `{ "reminderCount": 0, "maxReminders": 4 }` |
| `status` | `"active"` |

## Job Lifecycle

```
Tenant completes onboarding (onboardingPhase = "done")
  -> Seed connect_reminder job at 18:00 local time

Job fires:
  1. Check: has Gmail AND Calendar?
     - YES -> Mark job "completed", set connectReminderStatus = "connected". Done.
     - NO  -> Continue to step 2.
  2. Check: reminderCount >= maxReminders (4)?
     - YES -> Mark job "completed", set connectReminderStatus = "exhausted". Done.
     - NO  -> Continue to step 3.
  3. Send value-focused reminder message (see Messages below).
  4. Increment reminderCount in payload.
  5. Reschedule job for +7 days at 18:00 local time.

User says "stop reminding" / "don't remind me":
  -> Reschedule job for +7 days (snooze). Count still increments on next fire.

User connects Gmail/Calendar (OAuth callback):
  -> Check if BOTH Gmail and Calendar now connected.
  -> If yes: mark connect_reminder job "completed", set connectReminderStatus = "connected".
```

## Reminder Messages

### Gmail only missing
> Hey! Just a thought -- if you connect your Gmail, I can give you a daily inbox summary, help draft replies, and flag important emails. Just type **connect gmail** to get started.

### Calendar only missing
> Quick idea -- connect your Google Calendar and I'll send you daily agendas, meeting briefings, and remind you before important meetings. Type **connect calendar** to set it up.

### Both missing
> Hey! I can do a lot more for you once you connect your Gmail and Calendar -- daily inbox summaries, meeting briefings, smart reminders. Type **connect gmail** or **connect calendar** to get started.

## "Stop Reminding" Detection

In the MessageHandler or Brain response handling, detect intent phrases:
- "stop reminding", "don't remind me", "no more reminders", "stop nagging"

When detected: reschedule the connect_reminder job +7 days. The reminder count still increments on next fire, so the 4-reminder cap is still respected.

## Auto-Complete on Connect

In the `/api/connect-complete` OAuth callback handler:
1. After successfully connecting Gmail or Calendar for a tenant
2. Query if the tenant now has BOTH Gmail and Calendar connected
3. If yes: find the active `connect_reminder` job and mark it `"completed"`
4. Set `connectReminderStatus = "connected"` on the tenant

## Seeding

On server startup (`index.ts`), for each onboarded tenant:
- If no `connect_reminder` job exists
- AND tenant doesn't have both Gmail + Calendar connected
- AND `connectReminderStatus` is `"active"` or `"snoozed"`
- Then: insert a `connect_reminder` job at 18:00 local time with `reminderCount: 0`

## Files to Modify

| File | Change |
|------|--------|
| `packages/db/src/schema.ts` | Add `connectReminderStatus` column to `tenants` |
| `packages/gateway/src/job-runner.ts` | Add `connect_reminder` case + `runConnectReminder()` method |
| `packages/gateway/src/index.ts` | Seed connect_reminder jobs on startup |
| `packages/gateway/src/server.ts` | Auto-complete job on OAuth connect callback |
| `packages/gateway/src/message-handler.ts` | Detect "stop reminding" intent and snooze job |
| DB migration | Add column to tenants table |
