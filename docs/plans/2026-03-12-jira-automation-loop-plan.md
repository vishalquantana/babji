# Jira Automation Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Claude Code `/jira-auto` skill that polls the Jira BAB board every 5 minutes, auto-triages bugs, picks up approved work one at a time, codes/tests/deploys, and transitions tickets through statuses.

**Architecture:** A single `.claude/commands/jira-auto.md` prompt file invoked via `/loop 5m /jira-auto`. The prompt instructs Claude to use `curl` via Bash to call the Jira REST API v3 with Basic Auth (creds loaded from `.env.local`). Three phases per loop iteration: triage To Do tickets, check for work, execute on one Approved to Build ticket. Serial execution guaranteed by Claude Code's turn serialization.

**Tech Stack:** Claude Code skills (`.claude/commands/`), Jira REST API v3, Bash/curl, SSH for deploys, Telegram Bot API for notifications.

---

### Task 1: Set Up Jira Board Statuses

Ensure the BAB project board has all 6 required statuses configured in Jira.

**Files:**
- None (Jira web UI configuration)

**Step 1: Verify current board statuses**

Run this command to fetch all available statuses for the BAB project:

```bash
source .env.local && curl -s "https://${JIRA_HOST}/rest/api/3/project/BAB/statuses" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json" | python3 -m json.tool
```

Expected: JSON array of issue types, each with a `statuses` array. Check for these 6 names:
- `To Do`
- `Approved to Build`
- `In Progress`
- `Blocked for Human`
- `Ready for QA`
- `Done`

**Step 2: If any statuses are missing, create them manually**

Go to `https://quantana.atlassian.net/jira/core/projects/BAB/board` → Board settings → Columns. Add any missing columns. The automation depends on exact status name matching.

**Step 3: Verify transitions work**

Pick any existing ticket and test transitioning it through all statuses via the API:

```bash
# First, get available transitions for a ticket
source .env.local && curl -s "https://${JIRA_HOST}/rest/api/3/issue/BAB-1/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json" | python3 -m json.tool
```

Expected: JSON with `transitions` array, each containing `id` and `name`. Note the transition IDs — the automation will fetch these dynamically.

**Step 4: Commit** (nothing to commit — this is Jira configuration)

---

### Task 2: Create Local Environment File

Create `.env.local` with the Jira and Telegram credentials needed by the automation.

**Files:**
- Create: `.env.local`
- Modify: `.gitignore` (ensure `.env.local` is ignored)

**Step 1: Check `.gitignore` includes `.env.local`**

```bash
grep -q '.env.local' .gitignore && echo "FOUND" || echo "NOT FOUND"
```

If NOT FOUND, add it:

```bash
echo '.env.local' >> .gitignore
```

**Step 2: Create `.env.local` with required variables**

```bash
cat > .env.local << 'ENVEOF'
JIRA_HOST=quantana.atlassian.net
JIRA_EMAIL=<get from production .env>
JIRA_API_TOKEN=<get from production .env>
JIRA_PROJECT_KEY=BAB
TELEGRAM_BOT_TOKEN=<get from production .env>
ADMIN_CHAT_ID=<get from production .env>
ENVEOF
```

The actual values must be copied from the production server:

```bash
ssh root@65.20.76.199 'source /opt/babji/.env && echo "JIRA_EMAIL=$JIRA_EMAIL" && echo "JIRA_API_TOKEN=$JIRA_API_TOKEN" && echo "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN"'
```

For `ADMIN_CHAT_ID`, check the admin-notifier config or the `.env` on the server.

**Step 3: Verify credentials work**

```bash
source .env.local && curl -s "https://${JIRA_HOST}/rest/api/3/myself" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json" | python3 -m json.tool
```

Expected: JSON with your Jira account details (displayName, emailAddress, etc.)

**Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: ensure .env.local is gitignored"
```

---

### Task 3: Create the `.claude/commands/` Directory

Set up the commands directory structure for Claude Code custom commands.

**Files:**
- Create: `.claude/commands/` directory

**Step 1: Create the directory**

```bash
mkdir -p .claude/commands
```

**Step 2: Verify it exists**

```bash
ls -la .claude/commands/
```

Expected: Empty directory.

---

### Task 4: Write the Jira Automation Skill Prompt

This is the core deliverable. Create `.claude/commands/jira-auto.md` — the prompt file that Claude Code executes every 5 minutes via `/loop`.

**Files:**
- Create: `.claude/commands/jira-auto.md`

**Step 1: Write the full skill prompt**

Create `.claude/commands/jira-auto.md` with the following content:

````markdown
---
name: jira-auto
description: Automated Jira ticket triage and execution loop. Polls BAB board, auto-triages bugs, picks up approved work, codes/tests/deploys.
disable-model-invocation: true
---

# Jira Automation Agent

You are an automated development agent. You run on a schedule (every 5 minutes) to poll Jira, triage tickets, and execute approved work. Follow these phases in order. Be efficient — if there's nothing to do, exit quickly.

## Setup

First, load Jira credentials from the local environment file:

```bash
source .env.local
```

Verify credentials are loaded:

```bash
echo "JIRA_HOST=${JIRA_HOST}" && echo "EMAIL=${JIRA_EMAIL:0:5}..."
```

If credentials are missing, print "ERROR: .env.local not found or missing JIRA credentials" and stop.

## Phase 1: Triage To Do Tickets

Fetch all tickets in "To Do" status:

```bash
source .env.local && curl -s "https://${JIRA_HOST}/rest/api/3/search/jql" \
  -G --data-urlencode "jql=project=${JIRA_PROJECT_KEY} AND status=\"To Do\" ORDER BY priority ASC, created ASC" \
  --data-urlencode "fields=summary,description,issuetype,priority,assignee,comment" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

For each ticket returned:

### Bug Detection

A ticket is a **bug** if EITHER condition is true:
1. The `issuetype.name` field is `"Bug"`
2. The `summary` or `description` text (case-insensitive) contains ANY of these keywords:
   - Error codes: `403`, `401`, `404`, `500`, `502`, `503`, `ENOENT`, `ECONNREFUSED`
   - Action words: `error`, `crash`, `broken`, `fix`, `bug`, `fail`, `down`, `not working`, `exception`

### If Bug Detected

1. Get available transitions for the ticket:
```bash
source .env.local && curl -s "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

2. Find the transition ID where `name` matches `"Approved to Build"` (case-insensitive).

3. Transition the ticket:
```bash
source .env.local && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"TRANSITION_ID"}}'
```

4. Add a comment:
```bash
source .env.local && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/comment" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"🤖 Auto-triaged: detected as bug/error report. Moving to Approved to Build."}]}]}}'
```

### If NOT a Bug

Leave the ticket in "To Do". Do not transition it. Move on to the next ticket.

## Phase 2: Check for In-Progress Work

Check if any ticket is currently "In Progress":

```bash
source .env.local && curl -s "https://${JIRA_HOST}/rest/api/3/search/jql" \
  -G --data-urlencode "jql=project=${JIRA_PROJECT_KEY} AND status=\"In Progress\"" \
  --data-urlencode "fields=key,summary" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

**If any ticket is In Progress:** Print "Ticket TICKET_KEY is currently in progress. Skipping work pickup." and STOP. Do not pick up new work. This ensures serial execution.

**If no ticket is In Progress:** Continue to pick up work.

### Pick Up Work

Fetch all "Approved to Build" tickets, ordered by priority then creation date:

```bash
source .env.local && curl -s "https://${JIRA_HOST}/rest/api/3/search/jql" \
  -G --data-urlencode "jql=project=${JIRA_PROJECT_KEY} AND status=\"Approved to Build\" AND (assignee is EMPTY OR assignee = currentUser()) ORDER BY priority ASC, created ASC" \
  --data-urlencode "fields=key,summary,description,comment,priority,issuetype,assignee" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

**If no tickets found:** Print "No approved tickets to work on." and STOP.

**If tickets found:** Pick the FIRST one (highest priority, oldest). This is your work item.

## Phase 3: Execute Work

### Step 1: Move to In Progress

Get transitions and find "In Progress":
```bash
source .env.local && curl -s "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

Transition to "In Progress":
```bash
source .env.local && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"TRANSITION_ID"}}'
```

Add comment:
```bash
source .env.local && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/comment" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"🤖 Starting automated work on this ticket."}]}]}}'
```

### Step 2: Understand Requirements

Read the ticket description and ALL comments carefully. Extract:
- What needs to be built or fixed
- Any specific file references
- Any acceptance criteria
- Any technical constraints

Also read the full ticket details including attachments:
```bash
source .env.local && curl -s "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY?fields=summary,description,comment,attachment,priority,issuetype" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

### Step 3: Check for Blockers

Before coding, check if the ticket requires any of these (which would block you):
- External API keys or credentials you don't have
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
pnpm --filter @babji/agent build
pnpm --filter @babji/gateway build
```

If the build fails, attempt to fix the build error once. If it fails again, jump to "Handle Blocker".

### Step 7: Deploy to Production

Follow the exact deploy sequence from CLAUDE.md:

```bash
# Sync code to server
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude data --exclude .worktrees \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

# Install dependencies
ssh root@65.20.76.199 'cd /opt/babji && /usr/bin/pnpm install --no-frozen-lockfile'

# Rebuild DB package if schema.ts was modified
ssh root@65.20.76.199 'cd /opt/babji && /usr/bin/pnpm --filter @babji/db build'

# Restart gateway
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'

# Wait and verify
ssh root@65.20.76.199 'sleep 3 && curl -s http://localhost:3000/health'
```

If the health check doesn't return a 200/OK response, jump to "Handle Blocker" with the deploy error.

If any files in `apps/oauth-portal/` were changed, also deploy the OAuth portal:
```bash
ssh root@65.20.76.199 'cd /opt/babji && /usr/bin/pnpm --filter oauth-portal build'
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-oauth'
```

### Step 8: Move to Ready for QA

Get transitions and find "Ready for QA":
```bash
source .env.local && curl -s "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

Transition to "Ready for QA":
```bash
source .env.local && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"TRANSITION_ID"}}'
```

Add a summary comment with what was done:
```bash
source .env.local && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/comment" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"🤖 Work completed and deployed to production.\n\nChanges made:\n- [SUMMARY OF CHANGES]\n\nFiles modified:\n- [LIST OF FILES]\n\nTests: All passing\nDeploy: Health check verified\n\nReady for human QA verification."}]}]}}'
```

Print a success message to the terminal: "✅ TICKET_KEY completed and deployed. Moved to Ready for QA."

Done! The loop will resume on the next tick.

## Handle Blocker

When you cannot complete a ticket:

### 1. Move to Blocked for Human

Get transitions and find "Blocked for Human":
```bash
source .env.local && curl -s "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Accept: application/json"
```

Transition:
```bash
source .env.local && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/transitions" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"TRANSITION_ID"}}'
```

### 2. Add Jira Comment

Add a detailed comment explaining:
- What was attempted
- What is blocking (API key needed, unclear requirements, test failures, deploy failure, etc.)
- What the human needs to do to unblock it

```bash
source .env.local && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/TICKET_KEY/comment" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"🤖 BLOCKED: [REASON]\n\nWhat was attempted:\n- [DETAILS]\n\nWhat is needed to unblock:\n- [ACTION ITEMS]"}]}]}}'
```

### 3. Print to Terminal

Print a clearly visible message:
```
⚠️ BLOCKED: TICKET_KEY - [SHORT REASON]
Action needed: [WHAT HUMAN NEEDS TO DO]
```

### 4. Send Telegram Notification

```bash
source .env.local && curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${ADMIN_CHAT_ID}" \
  -d "text=⚠️ Jira ticket TICKET_KEY is blocked.

Reason: [BLOCKER REASON]

Action needed: [WHAT TO DO]

Link: https://${JIRA_HOST}/browse/TICKET_KEY" \
  -d "parse_mode=HTML"
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
````

**Step 2: Verify the file was created correctly**

```bash
wc -l .claude/commands/jira-auto.md
```

Expected: Approximately 250-280 lines.

**Step 3: Test the skill can be invoked**

In Claude Code, type:
```
/jira-auto
```

It should load the prompt and start executing Phase 1. Verify it:
- Sources `.env.local`
- Calls the Jira API
- Prints triage results or "no tickets"

**Step 4: Commit**

```bash
git add .claude/commands/jira-auto.md
git commit -m "feat: add Jira automation loop skill for Claude Code

Creates .claude/commands/jira-auto.md that:
- Polls BAB board for To Do tickets and auto-triages bugs
- Picks up Approved to Build tickets one at a time
- Codes, tests, deploys, and transitions to Ready for QA
- Moves blocked tickets to Blocked for Human with notifications"
```

---

### Task 5: Test the Triage Phase Manually

Run the skill once manually to verify Phase 1 (triage) works correctly with the Jira API.

**Files:**
- None (testing only)

**Step 1: Create a test bug ticket in Jira**

```bash
source .env.local && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "project": {"key": "'"${JIRA_PROJECT_KEY}"'"},
      "summary": "502 error on /health endpoint",
      "description": {"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Getting 502 bad gateway when hitting the health endpoint. Started after last deploy."}]}]},
      "issuetype": {"name": "Task"}
    }
  }'
```

Expected: 201 response with ticket key (e.g., `BAB-45`).

**Step 2: Create a test feature ticket**

```bash
source .env.local && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue" \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "project": {"key": "'"${JIRA_PROJECT_KEY}"'"},
      "summary": "Add WhatsApp channel support",
      "description": {"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"We need to add WhatsApp as a communication channel alongside Telegram."}]}]},
      "issuetype": {"name": "Task"}
    }
  }'
```

Expected: 201 response with ticket key.

**Step 3: Run `/jira-auto` once**

In Claude Code, run:
```
/jira-auto
```

Expected behavior:
- The "502 error" ticket should be detected as a bug (keyword "502" and "error") and moved to "Approved to Build"
- The "WhatsApp channel" ticket should be left in "To Do"
- Phase 2 should find one "Approved to Build" ticket but we can cancel before it starts coding

**Step 4: Verify in Jira**

Check the board at `https://quantana.atlassian.net/jira/core/projects/BAB/board`:
- Bug ticket should be in "Approved to Build" column with auto-triage comment
- Feature ticket should still be in "To Do"

**Step 5: Clean up test tickets** (optional)

Move test tickets back to "To Do" or delete them if they were just for testing.

---

### Task 6: Test the Full Loop

Start the `/loop` and verify it runs correctly on a schedule.

**Files:**
- None (testing only)

**Step 1: Start the loop**

```
/loop 5m /jira-auto
```

Expected: Claude confirms the loop is scheduled with a job ID.

**Step 2: Verify first execution**

Wait for the first tick (up to 5 minutes). Claude should:
- Run Phase 1 (triage) — may find nothing if board is clean
- Run Phase 2 (work check) — may find nothing
- Print summary and exit

**Step 3: Test with an Approved to Build ticket**

If the bug ticket from Task 5 is still in "Approved to Build", the loop should pick it up, move to "In Progress", attempt to code a fix, and either:
- Complete it (deploy + move to Ready for QA)
- Block it (move to Blocked for Human + notify)

**Step 4: Verify serial execution**

While a ticket is "In Progress", manually move another ticket to "Approved to Build". On the next loop tick, the automation should print "Ticket BAB-XX is currently in progress. Skipping work pickup." and NOT start new work.

**Step 5: Cancel the loop when testing is done**

```
cancel the jira-auto loop
```

---

### Task 7: Update CLAUDE.md with Automation Documentation

Add documentation about the Jira automation loop to CLAUDE.md so future Claude sessions know about it.

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add a new section to CLAUDE.md**

After the "Jira Integration" section, add:

```markdown
## Jira Automation Loop

A Claude Code `/loop` skill that automates the development workflow:

### How It Works
- Runs every 5 minutes via `/loop 5m /jira-auto`
- **Phase 1 (Triage):** Fetches "To Do" tickets, auto-moves bugs to "Approved to Build"
- **Phase 2 (Work Check):** If nothing is "In Progress", picks up highest-priority "Approved to Build" ticket
- **Phase 3 (Execute):** Codes, tests, deploys, transitions to "Ready for QA"
- If blocked: moves to "Blocked for Human" + Jira comment + terminal message + Telegram notification

### Bug Detection
Auto-approved if issue type is "Bug" OR summary/description contains: 403, 401, 404, 500, 502, 503, error, crash, broken, fix, bug, fail, down, not working, exception

### Board Statuses
To Do → Approved to Build → In Progress → Ready for QA → Done (+ Blocked for Human)

### Files
- `.claude/commands/jira-auto.md` — automation prompt
- `.env.local` — local Jira + Telegram credentials (gitignored)

### Start/Stop
```bash
/loop 5m /jira-auto      # start
cancel the jira-auto loop # stop
```
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Jira automation loop documentation to CLAUDE.md"
```

---

### Task 8: Update CHANGELOG.md

Log the new feature in the changelog.

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add changelog entry**

Add at the top of CHANGELOG.md:

```markdown
## 2026-03-12 — Jira Automation Loop
- **What:** Claude Code `/loop` skill that polls Jira every 5 min, auto-triages bugs, picks up approved work, codes/tests/deploys
- **Files:** `.claude/commands/jira-auto.md`, `.env.local`, `CLAUDE.md`
- **Board statuses:** To Do → Approved to Build → In Progress → Blocked for Human → Ready for QA → Done
- **Deployed:** N/A (runs locally in Claude Code session)
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add Jira automation loop to changelog"
```
