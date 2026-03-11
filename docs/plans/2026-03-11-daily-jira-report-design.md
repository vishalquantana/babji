# BAB-38: Daily Jira Report — Design

## Overview

Any user who connects their Jira account automatically receives a daily report of their key tickets. Runs as a separate scheduled message (default 09:00 in user's timezone), independent of the existing daily briefing.

## Data Gathering

`DailyJiraReportService.generateReport(tenant, timezone)` fetches two datasets in parallel via `JiraHandler`:

1. **Assigned open issues** — JQL: `assignee = currentUser() AND status != Done ORDER BY status, priority DESC` — grouped by status (In Progress, To Do, In Review, etc.)
2. **Recently updated in my projects** — Extract project keys from query 1 results, then: `project IN (PROJ1, PROJ2) AND updated >= -24h AND assignee != currentUser() ORDER BY updated DESC` — shows what others changed in the user's projects (user's own changes already covered by query 1).

Deduplicates issues appearing in both sets. Returns `null` if both queries return empty (no message sent that day).

## LLM Composition

Raw issue data passed to lite model (`gemini-3.1-flash-lite-preview`) with a system prompt:

> "You are Babji, a business assistant. Compose a concise daily Jira report for {userName}. Group assigned issues by status. Separately list what changed in their projects in the last 24 hours. Use plain text only — no markdown, no emojis. Keep it scannable."

Output is plain-text message sent via Telegram/WhatsApp adapter.

## Scheduling & Configuration

- **Job type:** `daily_jira_report` in `scheduledJobs` table
- **Auto-seeded:** On Jira OAuth completion, a `daily_jira_report` job is created at default 09:00 in the user's timezone
- **Tenant column:** `jiraReportPref` on `tenants` table — values: `"morning"` (default 09:00), a custom time like `"08:30"`, or `"off"` to disable
- **Chat commands:** User says "configure jira report" or "turn off jira report" — Brain handles via existing configure pattern
- **Rescheduling:** After each run, `rescheduleDaily()` sets next execution (same pattern as daily briefing)

## Files to Create/Modify

| File | Change |
|------|--------|
| `packages/gateway/src/daily-jira-report.ts` | New — `DailyJiraReportService` class |
| `packages/gateway/src/job-runner.ts` | Add `daily_jira_report` case + `runDailyJiraReport()` method |
| `packages/db/src/schema.ts` | Add `jiraReportPref` column to `tenants` |
| `packages/gateway/src/server.ts` | Auto-seed job on Jira OAuth connect |
| `packages/agent/src/prompt-builder.ts` | Add Jira report config section so Brain knows about the feature |
| `packages/skills/src/registry.ts` | Add `configure_jira_report` action |
| `CHANGELOG.md` | Document the feature |

## Approach

Follows Approach A: new service class + job type, mirroring `DailyBriefingService` pattern exactly. Clean separation, independently configurable.
