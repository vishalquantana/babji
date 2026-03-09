# Recurring Reminders Design (BAB-4)

## Problem
Users want recurring reminders like "remind me every day at 9:20 AM to check orders." Currently todos only support single-fire reminders tied to a due date.

## Design

### No Schema Changes
The `scheduledJobs` table already has `scheduleType` ("once"/"daily"/"cron") and `recurrenceRule` fields. Recurrence lives on the job, not the todo.

### New Parameters on add_task / update_task
- `recurrence`: "daily" | "weekdays" | "weekly" | "monthly" | "yearly" — how often the reminder repeats
- `reminder_time`: "09:20" or "14:00" — what time it fires (default "09:00")

When `recurrence` is set, a `scheduledJobs` row is created with:
- `scheduleType`: "daily" (for daily/weekdays) or "weekly"
- `recurrenceRule`: the reminder_time string (e.g. "09:20")
- `payload`: `{ todoId, title, recurrence }` — recurrence type stored in payload for weekday/weekly logic

### JobRunner Changes
`runTodoReminder()` currently marks the job as "completed" after firing. Change:
- If `scheduleType === "once"` → mark completed (existing behavior)
- If `scheduleType !== "once"` → reschedule:
  - "daily": use existing `rescheduleDaily()`
  - "weekdays" (stored in payload): skip to next weekday
  - "weekly": schedule 7 days out at same time
  - "monthly": schedule same day next month at same time
  - "yearly": schedule same day next year at same time

### Completing/Deleting Recurring Todos
Same as today — marks the job as "completed", stopping all future reminders.

### list_tasks Shows Recurrence
Response includes `recurrence` field ("daily"/"weekdays"/"weekly"/"monthly"/"yearly"/null) by looking up the linked job's scheduleType and payload.

### Prompt Guidance
PromptBuilder tells the Brain when to use recurrence vs single reminders, and how to confirm the schedule.
