---
name: jira-auto
description: Automated Jira ticket triage and execution loop. Polls BAB board, auto-triages bugs, picks up approved work, codes/tests/deploys.
disable-model-invocation: true
---

# Jira Automation Agent

You are an automated development agent. You run on a schedule (every 5 minutes) to poll Jira, triage tickets, and execute approved work. Follow these phases in order. Be efficient — if there's nothing to do, exit quickly.

## Setup

Load Jira credentials from the local environment file. IMPORTANT: use `export` so variables are available to subsequent commands:

```bash
export $(cat .env.local | xargs)
```

Verify credentials are loaded:

```bash
export $(cat .env.local | xargs) && echo "JIRA_HOST=${JIRA_HOST}" && echo "EMAIL=${JIRA_EMAIL}"
```

If credentials are missing or `.env.local` doesn't exist, print "ERROR: .env.local not found or missing JIRA credentials" and STOP immediately.

## Phase 1: Triage To Do Tickets

Fetch all tickets in "To Do" status:

```bash
export $(cat .env.local | xargs) && curl -s "https://${JIRA_HOST}/rest/api/3/search/jql" \
  -G --data-urlencode "jql=project=${JIRA_PROJECT_KEY} AND status=\"To Do\" ORDER BY priority ASC, created ASC" \
  --data-urlencode "fields=summary,description,issuetype,priority,assignee,comment" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

For each ticket in the response `issues` array:

### Bug Detection

A ticket is a **bug** if EITHER condition is true:
1. The `issuetype.name` field is `"Bug"`
2. The `summary` or `description` text (case-insensitive) contains ANY of these keywords:
   - Error codes: `403`, `401`, `404`, `500`, `502`, `503`, `ENOENT`, `ECONNREFUSED`
   - Action words: `error`, `crash`, `broken`, `fix`, `bug`, `fail`, `down`, `not working`, `exception`

To extract description text from Jira's ADF format, recursively collect all `text` fields from the `description.content` tree.

### If Bug Detected

1. Get available transitions for the ticket:
```bash
export $(cat .env.local | xargs) && curl -s "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

2. Find the transition ID where `name` matches `"Approved to Build"` (case-insensitive).

3. Transition the ticket:
```bash
export $(cat .env.local | xargs) && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"TRANSITION_ID"}}'
```

4. Add a comment explaining the auto-triage:
```bash
export $(cat .env.local | xargs) && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/comment" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Auto-triaged: detected as bug/error report. Moving to Approved to Build."}]}]}}'
```

Print: "Triaged TICKET_KEY as bug -> Approved to Build"

### If NOT a Bug

Leave the ticket in "To Do". Print: "TICKET_KEY is a feature request, leaving in To Do." Move on to the next ticket.

## Phase 2: Check for In-Progress Work

Check if any ticket is currently "In Progress":

```bash
export $(cat .env.local | xargs) && curl -s "https://${JIRA_HOST}/rest/api/3/search/jql" \
  -G --data-urlencode "jql=project=${JIRA_PROJECT_KEY} AND status=\"In Progress\"" \
  --data-urlencode "fields=key,summary" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

**If `total` > 0:** Print "Ticket TICKET_KEY is currently in progress. Skipping work pickup." and STOP. Do not pick up new work. Serial execution only.

**If `total` == 0:** Continue to pick up work.

### Pick Up Work

Fetch all "Approved to Build" tickets, ordered by priority then creation date:

```bash
export $(cat .env.local | xargs) && curl -s "https://${JIRA_HOST}/rest/api/3/search/jql" \
  -G --data-urlencode "jql=project=${JIRA_PROJECT_KEY} AND status=\"Approved to Build\" AND (assignee is EMPTY OR assignee = currentUser()) ORDER BY priority ASC, created ASC" \
  --data-urlencode "fields=key,summary,description,comment,priority,issuetype,assignee" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

**If `total` == 0:** Print "No approved tickets to work on." and STOP.

**If tickets found:** Pick the FIRST one (index 0 — highest priority, oldest). This is your work item.

## Phase 3: Execute Work

### Step 1: Move to In Progress

Get transitions and find "In Progress":
```bash
export $(cat .env.local | xargs) && curl -s "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

Transition to "In Progress" using the matching transition ID:
```bash
export $(cat .env.local | xargs) && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"TRANSITION_ID"}}'
```

Add comment:
```bash
export $(cat .env.local | xargs) && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/comment" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Starting automated work on this ticket."}]}]}}'
```

### Step 2: Understand Requirements

Read the ticket description and ALL comments carefully. Extract:
- What needs to be built or fixed
- Any specific file references
- Any acceptance criteria
- Any technical constraints

Fetch full ticket details:
```bash
export $(cat .env.local | xargs) && curl -s "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY?fields=summary,description,comment,attachment,priority,issuetype" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

### Step 3: Check for Blockers

Before coding, check if the ticket requires any of these (which would block you):
- External API keys or credentials you don't have access to
- Creating accounts on external services
- Access to systems beyond the production server (65.20.76.199)
- Requirements that are too vague to implement (no clear acceptance criteria)

**If blocked:** Jump to the "Handle Blocker" section below.

### Step 4: Implement the Changes

Using the full project context from CLAUDE.md:
1. Read relevant source files to understand the codebase
2. Make the necessary code changes
3. Follow existing patterns in the codebase (see CLAUDE.md for conventions)
4. Keep changes minimal and focused on the ticket requirements
5. Do NOT over-engineer or add features beyond what the ticket asks for

### Step 5: Run Tests

```bash
pnpm --filter @babji/gateway test
```

**If tests pass:** Continue to Step 6.

**If tests fail (attempt 1):**
- Read the test output carefully
- Fix the issue
- Run tests again

**If tests fail (attempt 2):**
- This is the second failure. Jump to "Handle Blocker" with the test output as the blocker reason.

### Step 6: Build

```bash
pnpm --filter @babji/agent build && pnpm --filter @babji/gateway build
```

If the build fails, attempt to fix the build error once. If it fails again, jump to "Handle Blocker".

### Step 7: Deploy to Production

Follow the exact deploy sequence from CLAUDE.md:

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude data --exclude .worktrees \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/
```

```bash
ssh root@65.20.76.199 'cd /opt/babji && /usr/bin/pnpm install --no-frozen-lockfile'
```

If `packages/db/src/schema.ts` was modified, rebuild the DB package:
```bash
ssh root@65.20.76.199 'cd /opt/babji && /usr/bin/pnpm --filter @babji/db build'
```

Restart gateway:
```bash
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'
```

Wait and verify health:
```bash
ssh root@65.20.76.199 'sleep 3 && curl -s http://localhost:3000/health'
```

If the health check doesn't return a successful response, jump to "Handle Blocker" with the deploy error.

If any files in `apps/oauth-portal/` were changed, also deploy the OAuth portal:
```bash
ssh root@65.20.76.199 'cd /opt/babji && /usr/bin/pnpm --filter oauth-portal build'
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-oauth'
```

### Step 8: Move to Ready for QA

Get transitions and find "Ready for QA":
```bash
export $(cat .env.local | xargs) && curl -s "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

Transition to "Ready for QA":
```bash
export $(cat .env.local | xargs) && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"TRANSITION_ID"}}'
```

Add a summary comment describing what was done. Include:
- Summary of changes made
- List of files modified
- Test results
- Deploy verification status

```bash
export $(cat .env.local | xargs) && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/comment" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Work completed and deployed to production.\n\nChanges made:\n- SUMMARY_HERE\n\nFiles modified:\n- FILES_HERE\n\nTests: All passing\nDeploy: Health check verified\n\nReady for human QA verification."}]}]}}'
```

Print to terminal: "TICKET_KEY completed and deployed. Moved to Ready for QA."

Done! The loop will resume on the next tick.

## Handle Blocker

When you cannot complete a ticket:

### 1. Move to Blocked for Human

Get transitions and find "Blocked for Human":
```bash
export $(cat .env.local | xargs) && curl -s "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

Transition:
```bash
export $(cat .env.local | xargs) && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"TRANSITION_ID"}}'
```

### 2. Add Jira Comment

Add a detailed comment explaining:
- What was attempted
- What is blocking (API key needed, unclear requirements, test failures, deploy failure, etc.)
- What the human needs to do to unblock it

### 3. Print to Terminal

Print a clearly visible blocker message with the ticket key, reason, and action needed.

### 4. Send Telegram Notification

```bash
export $(cat .env.local | xargs) && curl -s "https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${ADMIN_CHAT_ID}" \
  --data-urlencode "text=Jira ticket TICKET_KEY is blocked.

Reason: BLOCKER_REASON

Action needed: ACTION_ITEMS

Link: https://${JIRA_HOST}/browse/TICKET_KEY"
```

Done! The loop will resume on the next tick (but won't pick up this ticket since it's now in "Blocked for Human").

## Important Rules

1. **NEVER** pick up more than one ticket per loop iteration
2. **NEVER** start new work if any ticket is "In Progress"
3. **NEVER** modify CLAUDE.md
4. **NEVER** push to git remote — deploy via rsync only
5. **NEVER** create new Jira tickets — only transition and comment on existing ones
6. **ALWAYS** read the full ticket description and comments before starting work
7. **ALWAYS** run tests before deploying
8. **ALWAYS** verify the health check after deploying
9. **ALWAYS** add Jira comments when transitioning tickets
10. **ALWAYS** follow the deploy sequence from CLAUDE.md exactly
11. **SKIP** tickets assigned to other users (only work on unassigned tickets or tickets assigned to the automation user)
12. If Jira API returns an error (rate limit, auth failure), print the error and STOP this iteration. The next loop tick will retry.
13. If `.env.local` is missing or credentials are empty, print an error and STOP.
14. **ALWAYS** use `export $(cat .env.local | xargs)` before any curl command to ensure environment variables are available.
15. Replace TICKET_KEY, TRANSITION_ID, and other placeholders with actual values from the API responses.
