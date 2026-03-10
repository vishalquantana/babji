# Todo & Reminder System Design

**Date:** 2026-03-09
**Status:** Approved

## Overview

Add a todo/reminder system to Babji so users can create tasks, set deadlines, and receive proactive reminders via Telegram/WhatsApp. Todos are managed through natural conversation — no commands or rigid syntax.

## Data Model

New `todos` table in PostgreSQL:

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | |
| tenantId | uuid (FK → tenants) | Owner |
| title | text | "Buy gift for mom's birthday" |
| notes | text (nullable) | Additional context |
| dueDate | date (nullable) | The actual deadline (date only) |
| reminderAt | timestamp (nullable) | When to fire the reminder (UTC) |
| reminderJobId | uuid (nullable) | FK → scheduledJobs |
| priority | enum [low, medium, high] | Default: medium |
| status | enum [pending, done] | |
| createdAt | timestamp | |
| completedAt | timestamp (nullable) | |

- `dueDate` = the deadline. `reminderAt` = when Babji reminds (can be days before).
- A todo without `dueDate` is a general action item — no reminder, but shows in "what are my todos?".
- When `reminderAt` is set, a corresponding `scheduledJobs` row is created (`jobType: "todo_reminder"`, `scheduleType: "once"`).

## Skill Definition

`babji_tasks` skill — no auth required, always available.

### Actions

**add_task**
- `title` (string, required) — What to do
- `due_date` (string, optional) — ISO date "2026-04-15"
- `remind_before` (string, optional) — e.g. "5d", "1w", "3h". LLM picks smart defaults.
- `priority` (string, optional) — "low", "medium", "high"
- `notes` (string, optional) — Extra context

**list_tasks**
- `status` (string, optional) — "pending" (default), "done", "all"

**complete_task**
- `task_id` (string, required)

**update_task**
- `task_id` (string, required)
- Any of: `title`, `due_date`, `remind_before`, `priority`, `notes`

**delete_task**
- `task_id` (string, required)

## Smart Reminder Timing

The LLM picks `remind_before` based on context (guidance in system prompt, not hard-coded):
- Gift/purchase → 5-7 days (shipping time)
- Preparation (presentation, report) → 2-3 days
- Meeting/call → 1 day or morning-of
- General deadline → 1 day before

The handler computes: `reminderAt = dueDate - remind_before`, converts to UTC using tenant timezone.

## Reminder Delivery

Uses existing job runner (30-second tick):
1. `add_task` with `reminderAt` → inserts `scheduledJobs` row (`todo_reminder`, `once`, UTC timestamp)
2. Job runner picks it up when due
3. Handler loads the todo, sends friendly message: "Hey [name], just a reminder — '[title]' is coming up on [dueDate]. Want to mark it done or push it back?"
4. Job status set to `completed` after firing

## "What should I work on today?"

`list_tasks` returns todos sorted by:
1. Overdue (past due date) — flagged
2. Due today
3. Due this week
4. No due date (general backlog)

LLM formats conversationally.

## System Prompt Additions

Add to prompt-builder:
- Guidance on smart `remind_before` defaults
- Instruction to always confirm reminder timing with user
- Instruction to call `list_tasks` when user asks "what should I work on" / "my todos" / "what's on my plate"

## Files Changed

| File | Change |
|------|--------|
| `packages/db/src/schema.ts` | Add `todos` table, `todoPriorityEnum`, `todoStatusEnum` |
| `packages/skills/src/registry.ts` | Add `babji_tasks` skill definition with 5 actions |
| `packages/skills/src/todos/handler.ts` | New: TodosHandler with CRUD + smart reminder logic |
| `packages/skills/src/index.ts` | Export TodosHandler |
| `packages/gateway/src/message-handler.ts` | Register `babji_tasks` handler (no auth needed, always available) |
| `packages/gateway/src/job-runner.ts` | Add `todo_reminder` job type handler |
| `packages/agent/src/prompt-builder.ts` | Add todo guidance to system prompt |

## Not in Scope (Future)

- Recurring todos (weekly/monthly)
- Morning heartbeat integration (auto-send todos in morning summary)
- Admin dashboard view of todos
- Shared todos between tenants
