# Babji Platform Design

**Date:** 2026-03-06
**Status:** Approved
**Approach:** Custom build inspired by OpenClaw architectural patterns

## Overview

Babji is an AI business assistant platform offered as a service. Clients interact with Babji primarily through WhatsApp (via Baileys) and Telegram, with a dedicated Babji app planned. Babji acts as a digital butler: managing email, calendar, ads, social media, and more on behalf of business users -- all through natural conversation.

The architecture is inspired by OpenClaw's five-component model (Gateway, Brain, Memory, Skills, Heartbeat) but built from scratch for multi-tenancy, secure credential management, and a curated skill ecosystem.

## Key Decisions

- **Approach:** Custom build borrowing patterns/code from OpenClaw (MIT licensed), not a fork
- **WhatsApp:** Baileys (unofficial API), single Babji-owned number, all clients message that number
- **Telegram:** Bot API via grammy/telegraf, single @BabjiByQuantanaBot
- **LLM:** Multi-model (Gemini 3.1 Flash Lite and Gemini 3.0 Flash Preview) with fallback chain
- **Isolation:** Docker container per tenant
- **Skill approval:** Platform operator (centralized, curated)
- **OAuth:** Own portal at balaji.quantana.top
- **Credits:** 5 free/day + prepaid packs (100/200) + subscription (500/month)
- **V1 integrations:** Gmail, Calendar, Contacts, Google Ads, Meta Ads, Instagram, Facebook, LinkedIn, X

## Architecture

```
BABJI PLATFORM
├── Gateway Service (shared, always running)
│   ├── Baileys Adapter (WhatsApp - single Babji number)
│   ├── Telegram Adapter (@BabjiBot)
│   ├── Babji App WebSocket Adapter
│   ├── Tenant Resolver (phone/user_id → tenant_id)
│   ├── Message Normalizer
│   └── Router (→ tenant container via gRPC/HTTP)
│
├── Orchestrator Service (shared)
│   ├── Tenant Manager (provisioning, lifecycle)
│   ├── Credit Ledger (balance checks, deductions)
│   └── Container Orchestrator (wake/sleep/provision pods)
│
├── Per-Tenant Containers (Docker, scale 0-N)
│   ├── Brain (ReAct loop, LLM orchestration)
│   ├── Memory (file-based: SOUL.md, MEMORY.md, sessions/)
│   ├── Skills (approved skill set per tenant)
│   ├── Heartbeat (cron-based proactive checks)
│   └── Credentials (encrypted OAuth tokens)
│
└── Shared Services
    ├── OAuth Portal (auth.babji.ai)
    ├── Skill Registry (catalog + request queue)
    ├── Billing Service (Stripe integration)
    └── Admin Dashboard ("The Teacher's Desk")
```

## Component Details

### 1. Gateway Service

Single entry point for all messages. Shared across all tenants.

**Responsibilities:**
- Receive messages from all channels
- Identify tenant from incoming message (phone number lookup for WhatsApp, user_id for Telegram, auth token for app)
- Normalize messages into standard BabjiMessage format: `{ tenant_id, channel, sender, text, media?, timestamp }`
- Route to correct tenant container
- Relay responses back to originating channel
- Handle typing indicators, read receipts

**Onboarding flow (new user):**
1. Unknown phone number sends message
2. Babji responds conversationally to collect name and basic info
3. Creates tenant record + provisions container
4. Grants 5 free daily credits
5. Babji introduces itself and available capabilities

### 2. Brain (Agent Runtime)

Runs inside each tenant's container. Implements the ReAct (Reasoning + Acting) loop.

**Agent loop:**
1. Load SOUL.md (personality + tenant preferences)
2. Load MEMORY.md (what Babji remembers about this client)
3. Load available skills (only connected services)
4. Build system prompt = SOUL + MEMORY + SKILLS + message history
5. Call LLM (selected model from Claude/GPT/Gemini)
6. Parse response:
   - tool_call → execute tool → add result to context → loop back to step 5
   - final_answer → return to user via Gateway
   - needs_auth → generate OAuth link → return to user
7. Post-conversation: flush important facts to MEMORY.md

**Multi-model support:**
- Default: Claude (strong reasoning + tool use)
- Fallback chain: Claude → GPT-4o → Gemini
- Configurable per tenant
- Model router can select based on task type

**Babji personality (SOUL.md):**
- Casual but professional tone
- Playful framing: credits = "juice", learning = "checking with my teacher"
- Proactive and honest about limitations
- Never robotic, always conversational

### 3. Memory System

File-based, per-tenant, inside each container's persistent volume.

**Structure:**
```
/data/tenants/{tenant_id}/
├── SOUL.md              # Base personality + tenant overrides
├── MEMORY.md            # Long-term facts about this client
├── CONNECTIONS.md       # Connected services + status
├── HEARTBEAT.md         # Proactive check instructions
├── sessions/
│   └── {session_id}.jsonl
├── memory/
│   └── {date}.md        # Daily logs
└── credentials/
    └── {provider}.enc   # Encrypted OAuth tokens (AES-256)
```

**Key properties:**
- Credentials encrypted at rest (AES-256-GCM)
- Persistent Docker volumes survive pod restarts
- Backed up to object storage (S3/GCS) for disaster recovery
- Memory flush after meaningful conversations extracts important facts
- Vector search deferred to v2; keyword search sufficient for v1

### 4. Skills System

Curated, platform-operated skills. No community marketplace (security-first).

**Skill definition format (YAML):**
```yaml
name: gmail
display_name: "Gmail Management"
description: "Read, send, organize, and manage emails"
requires_auth:
  provider: google
  scopes: [gmail.readonly, gmail.modify, gmail.labels]
actions:
  - name: list_emails
    description: "List recent emails"
    parameters:
      query: { type: string }
      max_results: { type: number, default: 10 }
  - name: send_email
    parameters:
      to: { type: string, required: true }
      subject: { type: string, required: true }
      body: { type: string, required: true }
  - name: block_sender
    parameters:
      email: { type: string, required: true }
  - name: unsubscribe
    parameters:
      email: { type: string, required: true }
credits_per_action: 1
```

**V1 skill catalog:**

| Category | Skill | Key Actions |
|---|---|---|
| Email | Gmail | Read, send, block, unsubscribe, summarize, label |
| Calendar | Google Calendar | View, create, reschedule, find free slots |
| Contacts | Google Contacts | Look up, add, update |
| Marketing | Google Ads | View campaigns, adjust budgets, reports |
| Marketing | Meta Ads | View campaigns, adjust budgets, reports |
| Social | Instagram | Post, schedule, reply to comments/DMs |
| Social | Facebook Pages | Post, schedule, reply |
| Social | LinkedIn | Post, schedule |
| Social | X (Twitter) | Post, schedule, reply |

**"Check with my teacher" flow:**
1. User requests capability Babji doesn't have
2. Babji asks permission to raise a request
3. Entry created in Skill Request Queue (visible in Admin Dashboard)
4. Platform team reviews, prioritizes, builds
5. When deployed: Babji notifies requesting tenant + broadcasts to others who might benefit

### 5. Heartbeat System

Cron-based proactive checks, per tenant.

**Behavior:**
- Runs every N minutes (default: 30, configurable)
- Only during tenant's active hours (respects timezone)
- Loads HEARTBEAT.md instructions
- Checks connected services for noteworthy changes
- Messages user only if something needs attention
- "Nothing to report" = silent (0 credits)
- Notification generated = 1 credit

**Default heartbeat checks (auto-configured when services connect):**
- Gmail: urgent emails, important contacts, unread count
- Google Ads: budget overruns, weekly performance
- Social: unanswered DMs (4+ hours), daily engagement summary
- General: pending follow-ups, friendly check-in if inactive 3+ days

### 6. Billing / Credits ("Juice")

| Tier | Credits | Price | Notes |
|---|---|---|---|
| Free | 5/day | $0 | Resets at midnight (tenant TZ), no rollover |
| Prepaid 100 | 100 | TBD | Never expires |
| Prepaid 200 | 200 | TBD (slight discount) | Never expires |
| Babji Pro | 500/month | TBD (best value) | Resets monthly, subscription |

**Credit costs:**
- 1 credit: any Babji action (send email, block sender, post, etc.), heartbeat notification, complex multi-step task (1 per task, not per sub-step)
- 0 credits: chatting, heartbeat checks (no notification), connecting services, viewing balance

**Low juice flow:** Babji warns when credits are low, offers top-up link in chat.

**Payment:** All in-chat via Stripe payment links. No separate website needed.

### 7. OAuth Portal (auth.babji.ai)

Lightweight web app for third-party service authorization.

**Flow:**
1. Babji sends link: `https://auth.babji.ai/connect/gmail?t={short_lived_token}`
2. User clicks → clean consent page explaining what Babji will access
3. User authorizes → standard OAuth2 flow with provider
4. Tokens encrypted and stored in tenant's credential volume
5. Confirmation page: "Connected! Close this tab."
6. Babji messages on WhatsApp: "I can see your Gmail now!"

**Properties:**
- Short-lived, single-use connection tokens
- Handles OAuth2 for Google, Meta, LinkedIn, X
- Automatic refresh token rotation
- Tenant-scoped token storage

### 8. Admin Dashboard ("The Teacher's Desk")

Web dashboard for platform operators.

**Features:**
- Tenant overview: clients, plans, credits, connections, last active
- Skill request queue: pending requests, priority, assignment
- Skill catalog management: add/remove/update available skills
- Conversation monitoring (with consent, for debugging)
- Broadcast tool: announcements to all tenants
- Analytics: active tenants, popular skills, credit usage, requested skills
- Container health: running, sleeping, errored pods

## Infrastructure

**Container orchestration:**
- Kubernetes (GKE/EKS/DigitalOcean) for production
- Docker Compose acceptable for early stage (<50 tenants)
- Scale-to-zero: tenant pods sleep after 15 min inactivity, wake on next message (~2-3s cold start)
- Persistent volumes per tenant for memory/credentials

**Shared infrastructure:**
- PostgreSQL: tenants, billing, skill requests, connections, audit log
- Redis: session state cache, rate limiting, pub/sub (Gateway ↔ Pods)
- S3/GCS: memory backups, media storage

**Database schema (core tables):**
- `tenants`: id, phone, name, channel_ids, plan, timezone, created_at
- `credits`: tenant_id, balance, transaction log
- `skill_requests`: tenant_id, skill_name, status, assigned_to, created_at
- `connections`: tenant_id, provider, scopes, token_ref, expires_at
- `audit_log`: tenant_id, action, skill, timestamp, credit_cost

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Language | TypeScript (Node.js) | Baileys is JS, OpenClaw is JS, strong async ecosystem |
| Gateway | Fastify + WebSocket | Fast, lightweight, good plugins |
| WhatsApp | Baileys (@whiskeysockets/baileys) | Unofficial but mature, multi-device |
| Telegram | grammy or telegraf | Well-maintained bot frameworks |
| Agent Brain | Custom ReAct loop | Ported from OpenClaw patterns |
| LLM Integration | Vercel AI SDK or LiteLLM | Multi-model (Claude + GPT + Gemini) |
| OAuth Portal | Next.js | Handles OAuth redirects, clean UX |
| Admin Dashboard | Next.js | Same stack as portal |
| Database | PostgreSQL | Reliable for billing/tenants |
| Cache/Queue | Redis | Session state, pub/sub |
| Containers | Docker + Kubernetes | Per-tenant isolation |
| Billing | Stripe | Payment links, subscriptions, webhooks |
| Encryption | AES-256-GCM | Tokens at rest |
| Monitoring | Grafana + Prometheus | Container health, LLM usage, credits |

## Security Considerations

- All OAuth tokens encrypted at rest (AES-256-GCM), not plaintext like OpenClaw
- Per-tenant container isolation (no shared process space)
- Short-lived, single-use tokens for OAuth connection links
- Curated skill catalog (no community marketplace) prevents malicious skills
- Audit logging for all actions
- Fresh Google/Meta developer accounts (not associated with OpenClaw bans)
- Rate limiting per tenant via Redis

## References

- [OpenClaw Architecture](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [Baileys (WhiskeySockets)](https://github.com/WhiskeySockets/Baileys)
- [WhatsApp 2026 AI Policy](https://learn.turn.io/l/en/article/khmn56xu3a-whats-app-s-2026-ai-policy-explained)
- [Multi-Tenant AI Agent Architecture](https://fast.io/resources/ai-agent-multi-tenant-architecture/)
- [Per-User Docker Container Isolation](https://dev.to/reeddev42/per-user-docker-container-isolation-a-pattern-for-multi-tenant-ai-agents-8eb)
- [AI Agent Sandboxing Best Practices](https://northflank.com/blog/how-to-sandbox-ai-agents)
