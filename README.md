# Babji

AI-powered business assistant that helps users manage digital services — email, calendar, ads, social media, and more — through conversational interfaces on Telegram and WhatsApp.

## Architecture

Babji is a **pnpm monorepo** with 8 packages and 2 apps:

```
apps/
  landing-page/         Marketing site (Next.js, port 3200)
  oauth-portal/         OAuth callbacks, admin dashboard, short links (Next.js, port 3100)

packages/
  gateway/              Fastify HTTP server — message pipeline, job runner, adapters (port 3000)
  agent/                Brain (ReAct loop), LLM client, prompt builder, memory extractor
  skills/               Skill handlers for third-party integrations
  memory/               Per-tenant state (SOUL.md, MEMORY.md), session history
  db/                   PostgreSQL schema & connection (Drizzle ORM)
  crypto/               AES-256-GCM token encryption (TokenVault)
  credits/              Credit-based usage ledger
  types/                Shared TypeScript interfaces
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+, TypeScript 5.7 |
| API Server | Fastify 5 |
| Frontend | Next.js 15, React 19 |
| Database | PostgreSQL 16, Drizzle ORM |
| Cache | Redis 7 |
| LLM | Vercel AI SDK 6 — Google Gemini (primary), Anthropic & OpenAI (fallback) |
| Messaging | Grammy (Telegram), Baileys (WhatsApp) |
| Image Storage | AWS S3 |
| Testing | Vitest 3 |
| Process Manager | PM2 |

## Features

### Core
- **Multi-channel messaging** — Telegram and WhatsApp adapters normalize messages into a unified pipeline
- **ReAct reasoning loop** — Brain iteratively calls LLM, executes tool actions, loops until complete (up to 10 turns)
- **Voice messages** — Telegram voice notes are transcribed via Gemini, shown back to user, then processed as text
- **Tenant isolation** — per-tenant memory files (personality, long-term memory), encrypted credentials, database records, session history
- **Onboarding flow** — unknown senders are guided through account creation
- **Rate limiting** — per-sender throttling with friendly retry messages

### Skills (Integrations)
| Skill | Capabilities |
|-------|-------------|
| **Gmail** | Read, send, archive emails; create/list/delete email filters |
| **Google Calendar** | List events, create/update/delete events |
| **Google Ads** | List accounts, campaign reports, budget control, audience insights |
| **Google Analytics** | View reports and metrics |
| **Google Docs** | Create and manage documents |
| **Jira** | Search issues, create/update tickets, view boards |
| **LinkedIn** | Create posts with images, view analytics |
| **Image Generation** | AI image creation via Gemini (prompt enhancement, S3 storage) |
| **People Research** | LinkedIn profile lookups via ScrapIn + DataForSEO |
| **General Research** | Web search and summarization |

### Scheduled Jobs
| Job | Description |
|-----|-------------|
| `daily_briefing` | Morning briefing: calendar, email highlights, todos, news (8:00 AM) |
| `email_digest` | Inbox summary at configured times |
| `daily_ads_report` | Google Ads campaign performance with recommendations (9:00 AM) |
| `daily_jira_report` | Jira ticket status and recent activity (9:00 AM) |
| `meeting_briefing` | Pre-meeting attendee profiles and context |
| `memory_scan` | Weekly long-term memory extraction |
| `connect_reminder` | Weekly nudge to connect missing services (caps at 4) |
| `daily_usage_report` | Admin usage tracking |
| `token_keep_alive` | Daily OAuth token refresh sweep with user notification on failure |

### Proactive Features
- **Token keep-alive** — daily sweep refreshes all OAuth tokens; notifies users via Telegram if any expire
- **Skill request escalation** — unconnected services trigger "check with my teacher" for human review
- **Auto-seeding** — scheduled jobs are created automatically when users connect services
- **Memory extraction** — fire-and-forget fact extraction after every conversation

## Message Pipeline

```
Inbound message (Telegram/WhatsApp)
  -> Normalize to BabjiMessage
  -> Rate limit check
  -> Resolve tenant (or start onboarding)
  -> Load session history
  -> Build system prompt (soul + memory + skills)
  -> Inject OAuth tokens (auto-refresh if expiring)
  -> Brain ReAct loop (LLM <-> tool execution, max 10 turns)
  -> Send reply (auto-split if > 4096 chars for Telegram)
  -> Fire-and-forget: memory extraction, session storage
```

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm
- Docker & Docker Compose

### Setup

```bash
# Clone and install
git clone <repo-url>
cd babji
pnpm install

# Copy environment config
cp .env.example .env
# Edit .env with your API keys and credentials

# Start infrastructure (Postgres + Redis)
docker-compose up -d postgres redis

# Run database migrations
pnpm --filter @babji/db db:push

# Start the gateway in dev mode
pnpm --filter @babji/gateway dev
```

### Environment Variables

Key variables (see `.env.example` for the full list):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM token encryption |
| `GOOGLE_API_KEY` | Gemini API key (primary LLM) |
| `GOOGLE_MODEL` | Primary model (e.g. `gemini-3-flash-preview`) |
| `GOOGLE_LITE_MODEL` | Lightweight model for background tasks |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API developer token |
| `ATLASSIAN_CLIENT_ID` / `ATLASSIAN_CLIENT_SECRET` | Jira OAuth credentials |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth credentials |
| `OAUTH_PORTAL_URL` | OAuth portal base URL |
| `MEMORY_BASE_DIR` | Tenant file storage path |
| `ADMIN_PASSWORD` | Admin dashboard password |

## Scripts

```bash
# Root
pnpm install                              # Install all dependencies
pnpm build                                # Compile all packages
pnpm test                                 # Run tests across the monorepo

# Individual packages
pnpm --filter @babji/gateway dev          # Gateway dev mode (tsx watch)
pnpm --filter @babji/gateway test         # Run gateway tests (48 tests)
pnpm --filter @babji/gateway build        # Compile gateway
pnpm --filter @babji/db build             # Compile DB schema
pnpm --filter oauth-portal dev            # OAuth portal dev mode
pnpm --filter oauth-portal build          # Build OAuth portal
```

## Production Deployment

```bash
# 1. Build locally
pnpm --filter @babji/agent build
pnpm --filter @babji/gateway build

# 2. Run tests
pnpm --filter @babji/gateway test

# 3. Sync to server
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data --exclude .worktrees \
  ./ root@65.20.76.199:/opt/babji/

# 4. Install deps + restart
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'

# 5. Verify
ssh root@65.20.76.199 'sleep 2 && curl -s http://localhost:3000/health'
```

## Docker

Start infrastructure locally:

```bash
docker-compose up -d
```

Services:

| Service | Port |
|---------|------|
| Gateway | 3000 |
| OAuth Portal | 3100 |
| Landing Page | 3200 |
| PostgreSQL | 5432 |
| Redis | 6379 |

## Testing

```bash
# Run all tests
pnpm test

# Run gateway tests only
pnpm --filter @babji/gateway test
```

48 tests covering: message normalizer, rate limiter, tenant resolver, onboarding, e2e pipeline, news fetcher, social media skills.

## Database Schema

Core tables (Drizzle ORM, defined in `packages/db/src/schema.ts`):

| Table | Purpose |
|-------|---------|
| `tenants` | User accounts, timezone, preferences, onboarding state |
| `service_connections` | OAuth connections per tenant (provider, scopes, token ref, expiry) |
| `scheduled_jobs` | Recurring/one-time jobs (briefings, digests, reminders) |
| `short_links` | URL shortener for OAuth links |
| `skill_requests` | "Check with my teacher" escalation requests |
| `audit_log` | Action and credit usage tracking |
| `email_filters` | Gmail filter rules created through Babji |
| `generated_images` | AI-generated image metadata and S3 references |

## Admin Dashboard

- **URL**: `<oauth-portal-url>/admin`
- Shows: tenants, service connections, skill requests, recent audit log
- Auth: cookie-based with configurable password

## License

Private — all rights reserved.
