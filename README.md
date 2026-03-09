# Babji

AI-powered business assistant that helps users manage digital services — email, calendar, social media, and advertising — through conversational interfaces on WhatsApp and Telegram.

## Architecture

Babji is a **pnpm monorepo** with 11 packages and 2 apps:

```
apps/
  admin/              Next.js admin dashboard (port 3200)
  oauth-portal/       OAuth authentication portal (port 3100)

packages/
  gateway/            Fastify API server — message pipeline & routing (port 3000)
  agent/              LLM brain with ReAct reasoning loop
  skills/             Skill handlers for third-party integrations
  memory/             Per-tenant state, conversation history & personality
  db/                 PostgreSQL schema & migrations (Drizzle ORM)
  credits/            Credit-based usage ledger
  billing/            Stripe payment integration
  crypto/             Token encryption & secure storage
  heartbeat/          Proactive scheduled check-ins
  types/              Shared TypeScript type definitions
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+, TypeScript 5.7 |
| API Server | Fastify 5 |
| Frontend | Next.js 15, React 19 |
| Database | PostgreSQL 16, Drizzle ORM |
| Cache | Redis 7 |
| LLM | Vercel AI SDK — Anthropic (primary), OpenAI, Google (fallback) |
| Messaging | Baileys (WhatsApp), Grammy (Telegram) |
| Payments | Stripe |
| Testing | Vitest 3 |
| Containerization | Docker, Docker Compose |

## Features

- **Multi-channel messaging** — WhatsApp and Telegram adapters normalize inbound messages into a unified pipeline
- **ReAct reasoning loop** — the Brain iteratively calls an LLM, executes tool actions, and loops until complete (up to 10 turns)
- **Multi-provider LLM fallback** — Anthropic → OpenAI → Google, automatic retry on failure
- **9 skill integrations** — Gmail, Google Calendar, Google Contacts, Google Ads, Meta Ads, Instagram, Facebook Pages, LinkedIn, X (Twitter)
- **Credit system** — free tier (5 daily credits), prepaid, and pro plans; each tool action costs 1 credit
- **Tenant isolation** — per-tenant memory files (personality, long-term memory, connections), database records, and session history
- **Onboarding flow** — unknown senders are guided through account creation
- **Rate limiting** — per-sender throttling with friendly retry messages
- **Skill request escalation** — unconnected services trigger a "check with my teacher" flow for human review
- **Proactive heartbeat** — scheduled check-ins based on tenant timezone and preferences

## Message Pipeline

```
Inbound message (WhatsApp/Telegram)
  → Normalize to BabjiMessage
  → Rate limit check
  → Resolve tenant (or start onboarding)
  → Load session history
  → Build system prompt (soul + memory + skills)
  → Brain ReAct loop (LLM ↔ tool execution)
  → Deduct credits
  → Store response in session
  → Send reply
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
pnpm -r --filter=@babji/db db:migrate

# Start the gateway in dev mode
pnpm -r --filter=@babji/gateway dev
```

### Environment Variables

Key variables (see `.env.example` for the full list):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `ENCRYPTION_KEY` | 64-char hex key for token encryption |
| `ANTHROPIC_API_KEY` | Primary LLM provider key |
| `OPENAI_API_KEY` | Fallback LLM provider key |
| `GOOGLE_API_KEY` | Fallback LLM provider key |
| `WHATSAPP_ENABLED` | Enable WhatsApp adapter |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `STRIPE_SECRET_KEY` | Stripe billing key |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |

## Scripts

```bash
# Root
pnpm install          # Install all dependencies
pnpm build            # Compile all packages
pnpm test             # Run tests across the monorepo
pnpm lint             # Lint all packages

# Individual packages
pnpm -r --filter=@babji/gateway dev       # Gateway dev mode
pnpm -r --filter=@babji/admin dev         # Admin dashboard dev mode
pnpm -r --filter=@babji/oauth-portal dev  # OAuth portal dev mode
pnpm -r --filter=@babji/db db:migrate     # Run migrations
pnpm -r --filter=@babji/db db:push        # Push schema to database
```

## Docker

Run the full stack locally:

```bash
docker-compose up
```

Services:

| Service | Port |
|---------|------|
| Gateway | 3000 |
| OAuth Portal | 3100 |
| Admin Dashboard | 3200 |
| PostgreSQL | 5432 |
| Redis | 6379 |

## Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm -r --filter=@babji/gateway test
```

Test coverage includes:

- **E2E pipeline tests** — full message flow from inbound to response
- **Onboarding tests** — new user registration flow
- **Rate limiter tests** — throttling behavior
- **Tenant resolver tests** — phone/Telegram ID lookup
- **Message normalizer tests** — format conversion across channels
- **Brain tests** — LLM interaction and tool execution
- **Crypto tests** — token encryption/decryption
- **Memory tests** — tenant state management

## Database Schema

Core tables: `tenants`, `creditBalances`, `creditTransactions`, `serviceConnections`, `skillRequests`, `auditLog`. Schema is defined in `/packages/db/src/schema.ts` using Drizzle ORM.

## License

Private — all rights reserved.
