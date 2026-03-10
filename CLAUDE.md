# Babji - AI Business Assistant

## Project Overview
Babji is an AI business assistant that communicates via Telegram (and eventually WhatsApp). It uses a ReAct loop (Brain) to process user messages, call skill-based tools (Gmail, etc.), and respond. Each user ("tenant") has isolated memory, credentials, and session history stored on disk and in PostgreSQL.

## Architecture

```
User (Telegram/WhatsApp)
  -> Gateway (Fastify HTTP + channel adapters)
    -> MessageHandler (orchestrates everything)
      -> TenantResolver (lookup tenant by phone/telegram ID)
      -> MemoryManager (SOUL.md, MEMORY.md per tenant)
      -> Brain (ReAct loop: LLM -> tool calls -> execute -> summarize)
        -> MultiModelLlmClient (Gemini primary, Anthropic/OpenAI fallback)
        -> ToolExecutor (routes tool calls to skill handlers)
      -> MemoryExtractor (fire-and-forget, extracts facts after each conversation)
```

### Key Packages
| Package | Purpose |
|---------|---------|
| `packages/gateway` | Main entry point, HTTP server, Telegram/WhatsApp adapters, message handler |
| `packages/agent` | Brain (ReAct loop), LLM client, PromptBuilder, MemoryExtractor, ToolExecutor |
| `packages/skills` | Skill definitions + handlers (Gmail, etc.) |
| `packages/memory` | MemoryManager (tenant files), SessionStore |
| `packages/db` | Drizzle ORM schema + connection (PostgreSQL) |
| `packages/crypto` | TokenVault (AES-256-GCM encrypted OAuth tokens) |
| `packages/credits` | CreditLedger for tracking usage |
| `packages/types` | Shared TypeScript interfaces |
| `apps/oauth-portal` | Next.js 15 app for OAuth callbacks, admin dashboard, short links |

## Servers

### Production Server (Gateway + DB)
- **IP**: `65.20.76.199`
- **SSH**: `ssh root@65.20.76.199`
- **Code location**: `/opt/babji/`
- **Env file**: `/opt/babji/.env` (has all secrets - DATABASE_URL, GOOGLE_API_KEY, TELEGRAM_BOT_TOKEN, etc.)
- **PostgreSQL**: Docker container on port 5432 (user: `babji`, pass: `babji_prod_2026`, db: `babji`)
- **Redis**: Docker container on port 6379
- **Tenant data**: `/opt/babji/data/tenants/<tenant-id>/` (SOUL.md, MEMORY.md, etc.)
- **Gateway log**: `/root/.pm2/logs/babji-gateway-out.log` (PM2 managed)
- **Node/pnpm available at**: `/usr/bin/node`, `/usr/bin/pnpm`
- **PM2 path**: `/root/.nvm/versions/node/v22.15.0/bin/pm2`

### OAuth Portal (runs on same server as Gateway)
- **Same server**: `65.20.76.199`
- **Domain**: `babji.quantana.top` (nginx reverse proxy with Let's Encrypt SSL)
- **Next.js port**: 3100 (nginx proxies from 443)
- **Start script**: `/opt/babji/start-oauth-portal.sh` (sources .env, then runs Next.js)
- **Log**: `/root/.pm2/logs/babji-oauth-out.log` (PM2 managed)
- **Handles**: OAuth callbacks, admin dashboard (`/admin`), short links (`/link/<id>`)

### Process Management (PM2)
Both the gateway and OAuth portal are managed by PM2 for auto-restart on crash/reboot.
- **IMPORTANT**: NEVER use `nohup`/manual `node` to start services — always use `pm2 restart`.
- PM2 process names: `babji-gateway` (ID 1), `babji-oauth` (ID 2)
- PM2 binary: `export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH"` then `pm2 ...`
- View logs: `pm2 logs babji-gateway --lines 50 --nostream`
- View status: `pm2 list`

## How to Run

### Start/Restart Gateway (Production)
```bash
ssh root@65.20.76.199
export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH"
pm2 restart babji-gateway
pm2 logs babji-gateway --lines 10 --nostream  # verify
```

### Deploy Changes
```bash
# 1. Build locally
pnpm --filter @babji/agent build    # if agent package changed
pnpm --filter @babji/gateway build  # gateway always

# 2. Run tests
pnpm --filter @babji/gateway test   # should pass 34/34

# 3. Sync to server (preserves .env and data)
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

# 4. Install deps on server
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'

# 5. Restart gateway via PM2
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'

# 6. Verify
ssh root@65.20.76.199 'sleep 2 && curl -s http://localhost:3000/health'
```

### Deploy OAuth Portal
The OAuth portal runs on the **same server as the gateway** (65.20.76.199), on port 3100 behind nginx.
```bash
# After rsync + pnpm install (same as gateway deploy above):

# 1. Build on server
ssh root@65.20.76.199 'cd /opt/babji && pnpm --filter oauth-portal build'

# 2. Restart OAuth portal via PM2
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-oauth'

# 3. Verify
ssh root@65.20.76.199 'sleep 3 && curl -s -o /dev/null -w "%{http_code}" https://babji.quantana.top/'
```

### Local Development
```bash
pnpm install
pnpm --filter @babji/gateway dev    # tsx watch mode
pnpm --filter @babji/gateway test   # vitest
```

## Environment Variables (Production Gateway)
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM token encryption |
| `GOOGLE_API_KEY` | Gemini API key for LLM |
| `GOOGLE_MODEL` | Primary model (currently `gemini-3-flash-preview`) |
| `GOOGLE_LITE_MODEL` | Lightweight model for background tasks (`gemini-2.0-flash-lite`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `GOOGLE_CLIENT_ID` | OAuth client ID for Google services |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `OAUTH_PORTAL_URL` | OAuth portal base URL (`https://babji.quantana.top`) |
| `MEMORY_BASE_DIR` | Tenant file storage path (`/opt/babji/data/tenants`) |
| `ADMIN_PASSWORD` | Admin dashboard password (`babji2026`) |
| `JIRA_HOST` | Jira instance hostname (`quantana.atlassian.net`) |
| `JIRA_EMAIL` | Jira auth email (from .env on server) |
| `JIRA_API_TOKEN` | Jira API token (from .env on server) |
| `JIRA_PROJECT_KEY` | Jira project key (`BAB`) |

## Jira Integration
- **Board**: `https://quantana.atlassian.net/jira/core/projects/BAB/board`
- **API**: Credentials stored in production `.env` (`JIRA_EMAIL`, `JIRA_API_TOKEN`)
- **Query open tickets**: `ssh root@65.20.76.199 'source /opt/babji/.env && curl -s "https://${JIRA_HOST}/rest/api/3/search/jql?jql=project%3DBAB%20AND%20status%21%3DDone%20ORDER%20BY%20created%20DESC" -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" -H "Accept: application/json"'`
- **Auto-creates tickets**: `AdminNotifier` creates Jira tickets when skill requests come in (`packages/gateway/src/admin-notifier.ts`)

### Open Jira Tickets
No open tickets currently. Last completed: BAB-3 (general_research skill, Done).

## Database Tables (Drizzle ORM)
- `tenants` - User accounts (name, phone, telegramUserId, plan, credits)
- `service_connections` - OAuth connections per tenant (provider, scopes, expiresAt)
- `short_links` - URL shortener for OAuth links
- `skill_requests` - "Check with my teacher" requests
- `audit_log` - Action/credit usage tracking

## Important Design Decisions

### Brain ReAct Loop
- Tool results are fed back as plain **user messages** (not AI SDK tool messages) because Vercel AI SDK v6 has strict validation on tool message format
- On the **last turn**, tools are dropped to force a text response
- Tool results are **truncated to 4000 chars** to prevent context overflow
- After tool results, prompt says "Do NOT call any more tools -- just summarize"

### Memory Extraction
- Runs as **fire-and-forget** (`setImmediate`) after every response
- Uses the **lite model** (`gemini-2.0-flash-lite`) to keep costs low
- Extracts facts from the conversation and appends to `MEMORY.md`

### Soul Prompt Rules
- NEVER offer capabilities outside listed skills (no browsing, no Reddit, no URLs)
- NEVER generate or make up URLs
- When sending emails: use client's real name, learn writing style from sent emails first
- For unconnected services: tell user to type "connect <service>"

### OAuth Short Links
- Long Google OAuth URLs are stored in `short_links` table
- Short URL format: `babji.quantana.top/link/<8-char-id>`
- Redirects to full OAuth URL

### Post-Connect Flow
- Two-step: immediate "Gmail connected!" message, then Brain-powered inbox summary
- Triggered via `/api/connect-complete` endpoint called by OAuth callback

## Testing
```bash
pnpm --filter @babji/gateway test  # 29 tests, ~1s
```
Tests cover: message normalizer, rate limiter, tenant resolver, onboarding, e2e pipeline.

## Admin Dashboard
- URL: `babji.quantana.top/admin`
- Password: `babji2026`
- Shows: tenants, service connections, skill requests, recent audit log
- Auth: cookie-based (`babji_admin` cookie with SHA-256 hash)

## Changelog

All technical changes MUST be logged in `CHANGELOG.md` in the project root. After every commit or deploy, append an entry with the date, what changed, which files were touched, and whether it's been deployed. This avoids re-deploying or losing track of what's live vs pending.

## API Reference for New Skills (context-hub)

When building new skill handlers that integrate external APIs, use `chub` (context-hub CLI) for curated, accurate API documentation instead of relying on LLM memory which may hallucinate APIs.

```bash
# Search for an API
chub search hubspot

# Get JS/Node.js docs for a specific API
chub get hubspot/crm --lang js
chub get jira/issues --lang js
chub get stripe/payments
chub get slack/workspace --lang js
chub get sendgrid/email-api --lang js
```

**Available APIs relevant to Babji:** hubspot/crm, jira/issues, google/bigquery, gemini/genai, slack/workspace, stripe/payments, sendgrid/email-api, notion/workspace-api, salesforce/crm, discord/bot, twilio/messaging, redis/key-value

**MANDATORY:** Before writing any new `SkillHandler` that calls an external API, ALWAYS run `chub search <api-name>` first to check if curated docs exist. If they do, fetch them with `chub get <id> --lang js` and use them as the reference for SDK choice, auth patterns, and code structure. Do not rely on LLM memory alone for API integration code.

## Common Issues
- **Gateway not loading .env**: Must source `.env` before starting. Use `start-gateway.sh` or `set -a && source .env && set +a`
- **"I ran out of thinking steps"**: Brain hitting max turns. Check tool result sizes, ensure truncation is working
- **LLM hallucinating URLs/capabilities**: Check SOUL.md rules are up to date
- **ENOENT on tenant files**: `readSoul()`, `readMemory()`, etc. have fallback defaults - if they don't, that's a bug
- **Gmail API disabled (403)**: Enable Gmail API in Google Cloud Console for the project
