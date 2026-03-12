# Jira Automation Loop Design

**Date:** 2026-03-12
**Status:** Approved

## Overview

A Claude Code automation loop that polls the Jira BAB board every 5 minutes, auto-triages bug tickets, picks up approved work one at a time, codes/tests/deploys it, and transitions tickets through statuses. Runs locally on the developer's laptop in a long-lived Claude Code session using `/loop`.

## Jira Board Statuses

```
To Do → Approved to Build → In Progress → Ready for QA → Done
                                ↓
                        Blocked for Human
```

Six statuses on the BAB project board:
1. **To Do** — New tickets land here (from AdminNotifier or manual creation)
2. **Approved to Build** — Triaged and ready for Claude to pick up
3. **In Progress** — Claude is actively working on it
4. **Blocked for Human** — Needs human intervention (API keys, unclear requirements, external access)
5. **Ready for QA** — Code deployed to prod, awaiting human verification
6. **Done** — Verified and closed

## Architecture

```
Developer Laptop (Claude Code Session)
  │
  ├─ /loop 5m /jira-auto
  │     │
  │     ▼
  │   [Skill Prompt Fires Every 5 Min]
  │     │
  │     ├─ Phase 1: TRIAGE
  │     │   ├─ Fetch all "To Do" tickets via Jira API
  │     │   ├─ For each ticket: check if bug (issue type + keywords)
  │     │   │   ├─ Bug → transition to "Approved to Build" + comment
  │     │   │   └─ Feature → leave in "To Do"
  │     │   └─ Continue to Phase 2
  │     │
  │     ├─ Phase 2: WORK CHECK
  │     │   ├─ Check: any ticket "In Progress"?
  │     │   │   ├─ YES → exit (serial execution, don't interrupt)
  │     │   │   └─ NO → fetch "Approved to Build" tickets
  │     │   │         └─ Pick highest priority (oldest as tiebreaker)
  │     │   │
  │     │   └─ Phase 3: EXECUTE (only if work picked up)
  │     │         ├─ Transition → "In Progress" + comment "Starting work"
  │     │         ├─ Read ticket description + comments
  │     │         ├─ Code the changes
  │     │         ├─ Run tests
  │     │         ├─ If pass → full deploy cycle → "Ready for QA"
  │     │         ├─ If blocked → "Blocked for Human" + notify
  │     │         └─ If tests fail (2x) → "Blocked for Human" + notify
  │     │
  │     └─ [Turn complete, wait for next tick]
  │
  └─ Production Server (65.20.76.199)
        ├─ Jira API (quantana.atlassian.net)
        ├─ Deploy target (rsync + pm2)
        └─ Telegram Bot (admin notifications)
```

## Key Files

| File | Purpose |
|------|---------|
| `.claude/commands/jira-auto.md` | Automation prompt (skill file invoked by /loop) |
| `.env.local` | Local Jira + Telegram creds |
| `CLAUDE.md` | Project context (read automatically by Claude Code) |

## Bug Detection Logic

A ticket is classified as a **bug** if EITHER condition is true:

1. **Issue type** is `Bug`
2. **Summary or description** contains any of these keywords (case-insensitive):
   - Error codes: `403`, `401`, `404`, `500`, `502`, `503`, `ENOENT`, `ECONNREFUSED`
   - Action words: `error`, `crash`, `broken`, `fix`, `bug`, `fail`, `down`, `not working`, `exception`

If classified as bug → auto-transition to "Approved to Build" with comment: "Auto-triaged: detected as bug/error report."

If NOT a bug → leave in "To Do" for human review.

## Blocker Detection (→ Blocked for Human)

Move to "Blocked for Human" when:
- Ticket mentions needing API keys, secrets, or credentials Claude doesn't have
- Ticket requires creating accounts on external services
- Requirements are ambiguous (no clear acceptance criteria after reading description + comments)
- Needs access to a system Claude doesn't have SSH/API access to
- Tests fail after 2 retry attempts on different approaches

## Notification on Block

Three channels, all fired:
1. **Jira comment** — Structured details: what's blocking, what's needed, what was attempted
2. **Terminal output** — Printed in the Claude Code session
3. **Telegram admin message** — via Bot API to admin chat ID

## Deploy Sequence

Follows CLAUDE.md deploy instructions:
```bash
pnpm --filter @babji/gateway build
pnpm --filter @babji/gateway test
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude data --exclude .worktrees \
  . root@65.20.76.199:/opt/babji/
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'
ssh root@65.20.76.199 'cd /opt/babji && pnpm --filter @babji/db build'  # if schema changed
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'
ssh root@65.20.76.199 'sleep 2 && curl -s http://localhost:3000/health'
```

Also deploys OAuth portal if relevant files changed:
```bash
ssh root@65.20.76.199 'cd /opt/babji && pnpm --filter oauth-portal build'
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-oauth'
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No To Do tickets | Phase 1 exits quickly, checks Phase 2 |
| No Approved to Build tickets | Both phases exit, loop waits for next tick |
| Something already In Progress | Skip Phase 3 entirely (serial execution) |
| Deploy fails (health check non-200) | Move to "Blocked for Human" with deploy error |
| Multiple Approved to Build tickets | Pick highest priority, then oldest creation date |
| Jira API error (rate limit, auth) | Print error, skip iteration, try next tick |
| Ticket is vague ("make it better") | "Blocked for Human" — requirements unclear |
| Ticket references unknown files | Claude reads codebase and adapts; if impossible, blocks |
| Schema changes needed | Auto-runs `pnpm --filter @babji/db build` on server |

## Constraints

- **Serial execution only** — one ticket at a time, no parallel work
- **Gateway + OAuth portal only** — won't deploy landing page changes
- **No git push** — deploys via rsync, code stays local
- **Won't create new Jira tickets** — only transitions/comments on existing ones
- **Won't modify CLAUDE.md** — reads it for context only
- **Unassigned tickets only** — skips tickets assigned to other people
- **Session-scoped** — loop dies when Claude Code session closes (3-day expiry)

## How to Run

```bash
# 1. Ensure .env.local exists with:
#    JIRA_HOST=quantana.atlassian.net
#    JIRA_EMAIL=...
#    JIRA_API_TOKEN=...
#    TELEGRAM_BOT_TOKEN=...
#    ADMIN_CHAT_ID=...

# 2. Open Claude Code in /Users/vishalkumar/Downloads/babji

# 3. Start the loop:
/loop 5m /jira-auto

# 4. To stop:
# "cancel the jira-auto loop"
```
