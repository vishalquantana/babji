# Changelog

All notable changes to Babji are documented here. Each entry notes whether the change has been deployed to production.

---

## 2026-03-09

### First-time user experience revamp [DEPLOYED]
- **What:** Redesigned onboarding flow for zero-digital-savvy users. New flow: name -> "what do you do?" -> tailored demo suggestions -> first Brain interaction -> gentle service introduction. Phone number deferred to when timezone matters. Credits explained on first use, not upfront. Industry-specific suggestions (9 industries + default) based on user's stated role. Cleaned up SOUL.md template to remove premature credits/juice references.
- **Files:** `packages/gateway/src/onboarding.ts`, `packages/gateway/src/message-handler.ts`, `packages/agent/src/prompt-builder.ts`, `packages/memory/src/memory-manager.ts`, `packages/db/src/schema.ts`
- **DB migration:** `ALTER TABLE tenants ADD COLUMN onboarding_phase VARCHAR(20) NOT NULL DEFAULT 'done'`

### Admin tenant detail dashboard with conversation logs [DEPLOYED]
- **What:** Clickable tenant names in admin dashboard open a detail page showing: overview stats, connected services, skill requests (with Complete & Notify), scheduled jobs, todos, activity log, credit transactions, and full conversation history. Conversations are loaded from JSONL session files on disk via a new gateway API endpoint.
- **Files:** `apps/oauth-portal/src/app/admin/dashboard/tenant/[tenantId]/page.tsx` (new), `apps/oauth-portal/src/app/admin/dashboard/tenant/[tenantId]/client.tsx` (new), `apps/oauth-portal/src/app/api/admin/tenant/[tenantId]/route.ts` (new), `apps/oauth-portal/src/app/admin/dashboard/client.tsx` (clickable names), `packages/gateway/src/server.ts` (sessions endpoint)

### Tool error transparency — prevent LLM confabulation on failures [DEPLOYED]
- **What:** Three-layer fix for the problem where Babji says "I found nothing" when a tool actually errored (e.g., expired Gmail token → 401). (1) System prompt guardrail telling Brain to never confabulate empty results on errors. (2) Brain formats tool errors with explicit ERROR prefix and anti-confabulation instruction. (3) ToolExecutor detects 401/403/429 patterns and returns actionable messages. (4) Expired OAuth tokens now register stub handlers that return clear "reconnect" messages instead of silently hiding the tool.
- **Files:** `packages/agent/src/prompt-builder.ts`, `packages/agent/src/brain.ts`, `packages/agent/src/tool-executor.ts`, `packages/gateway/src/message-handler.ts`

### Skill request "Complete & Notify" — proactive user notification [DEPLOYED]
- **What:** When an admin marks a skill request as completed, Babji now proactively notifies the user via Telegram with a Brain-crafted conversational message ("Hey, remember when you asked about X? I can do that now!"). Added "Complete & Notify" button to admin dashboard. Fallback: if the proactive notification fails, the next conversation's system prompt includes the completed request so Brain mentions it naturally.
- **Files:** `packages/db/src/schema.ts` (added `notifiedAt` column), `packages/gateway/src/server.ts` (new `/api/notify-skill-ready` endpoint), `apps/oauth-portal/src/app/api/admin/skill-requests/[requestId]/complete/route.ts` (new), `apps/oauth-portal/src/app/admin/dashboard/client.tsx` (button), `packages/agent/src/prompt-builder.ts` (fallback injection), `packages/gateway/src/message-handler.ts` (query + mark notified)
- **DB migration:** `ALTER TABLE skill_requests ADD COLUMN notified_at TIMESTAMP`

### General Research skill (BAB-3) [DEPLOYED]
- **What:** Added `general_research` skill with two actions: `quick_research` (Gemini Flash + Google Search grounding, synchronous) and `deep_research` (Gemini Deep Research Interactions API, async fire-and-forget with JobRunner delivery through Brain). Full deep research reports saved to disk at `/opt/babji/data/reports/`. After summary delivery, Babji offers to email the full report.
- **Files:** `packages/skills/src/general-research/handler.ts` (new), `packages/skills/src/general-research/index.ts` (new), `packages/skills/src/registry.ts`, `packages/skills/src/index.ts`, `packages/gateway/src/message-handler.ts`, `packages/gateway/src/job-runner.ts`, `packages/gateway/src/index.ts`
- **Jira:** BAB-3 (Done)
- **No new env vars** — reuses GOOGLE_API_KEY and GOOGLE_MODEL

### Google Ads: API version upgrade v17 -> v20, list_accounts action, better errors [DEPLOYED]
- **What:** Upgraded Google Ads REST API from v17 (sunset) to v20. Added `list_accounts` action using `listAccessibleCustomers` (no customer ID needed). Improved error extraction to surface Google Ads detail messages (e.g., `DEVELOPER_TOKEN_NOT_APPROVED`) instead of generic "permission denied". Detects test-token limitation and warns user clearly.
- **Files:** `packages/skills/src/google-ads/handler.ts`, `packages/skills/src/registry.ts`
- **Note:** Developer token currently at Test access. Basic access applied for — once approved, account names and campaign data will work.

### LLM-driven connect flow via connect_service tool [DEPLOYED]
- **What:** Added `babji.connect_service` tool so the LLM can generate OAuth sign-in links directly. Previously, the LLM told users to type "connect google_ads" — now it calls the tool itself and includes the link in its reply. User says "yes" -> LLM generates the link immediately, no extra commands needed.
- **Files:** `packages/skills/src/registry.ts`, `packages/gateway/src/message-handler.ts`, `packages/agent/src/prompt-builder.ts`

### OAuth portal: Add Google Ads and Google Analytics providers [DEPLOYED]
- **What:** Added `google_ads` and `google_analytics` to the OAuth portal's provider configuration. Without these, the OAuth callback would return "Unknown provider" when Google redirected back after authorization.
- **Files:** `apps/oauth-portal/src/lib/providers.ts`

### Google Ads developer token as server-side env var [DEPLOYED]
- **What:** Moved Google Ads developer token from per-tenant vault to server-side env var `GOOGLE_ADS_DEVELOPER_TOKEN`. The developer token is an app-level credential, not per-user.
- **Files:** `packages/gateway/src/config.ts`, `packages/gateway/src/message-handler.ts`, `packages/gateway/src/index.ts`
- **Env vars added:** `GOOGLE_ADS_DEVELOPER_TOKEN`

### Conversational disconnect prompt for unconnected services [DEPLOYED]
- **What:** Changed the system prompt for unconnected services from a blunt "not connected, type connect X" to a 3-step conversational flow: acknowledge goal, explain what Babji can do once connected, offer to set it up naturally.
- **Files:** `packages/agent/src/prompt-builder.ts`

### People Researcher error handling fix [DEPLOYED]
- **What:** DataForSEO returns HTTP 200 with task-level errors (e.g. 40207 IP whitelist). Added check for `task.status_code`, wrapped external calls in try/catch, return explicit error messages so the LLM doesn't hallucinate reasons.
- **Files:** `packages/skills/src/people/handler.ts`
- **Commit:** `31edc3e`

### People Researcher skill [DEPLOYED]
- **What:** New "People Research" skill with 4 actions: `research_person`, `lookup_profile`, `find_email`, `research_company`. Uses DataForSEO Google SERP API to find LinkedIn URLs, Scrapin.io for profile enrichment.
- **Files:** `packages/skills/src/people/handler.ts`, `packages/skills/src/people/index.ts`, `packages/skills/src/registry.ts`, `packages/skills/src/index.ts`, `packages/gateway/src/config.ts`, `packages/gateway/src/message-handler.ts`, `packages/gateway/src/index.ts`
- **Env vars added:** `SCRAPIN_API_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`
- **Jira:** BAB-2 (Done)
- **Commit:** `878bc16`

### Jira integration for skill requests [DEPLOYED]
- **What:** AdminNotifier now creates Jira tickets in BAB project when skill requests come in, alongside Telegram notification. Added `rsvp_event` action to calendar skill registry (was in handler but missing from registry).
- **Files:** `packages/gateway/src/admin-notifier.ts`, `packages/gateway/src/config.ts`, `packages/skills/src/registry.ts`
- **Env vars added:** `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`
- **Commit:** `33fca57`

### "Check with my teacher" flow + admin notifications [DEPLOYED]
- **What:** Wired `SkillRequestManager.create()` into message handler. Added `babji` built-in skill with `check_with_teacher` action. Created separate admin Telegram bot for skill request notifications. Updated SOUL.md default template.
- **Files:** `packages/gateway/src/message-handler.ts`, `packages/skills/src/registry.ts`, `packages/skills/src/skill-request-manager.ts`, `packages/gateway/src/admin-notifier.ts`, `packages/gateway/src/config.ts`, `packages/gateway/src/index.ts`, `packages/memory/src/memory-manager.ts`
- **Env vars added:** `ADMIN_BOT_TOKEN`, `ADMIN_TELEGRAM_ID`
- **Commit:** `7763e75`

### Scheduled jobs, token refresh, RSVP, onboarding improvements [DEPLOYED]
- **What:** DB-backed scheduled jobs system (daily calendar summary). OAuth token auto-refresh. RSVP support for calendar events. Phone number collection for Telegram users. Timezone detection from phone ISD codes. No-emoji/no-markdown formatting rules. PM2 ecosystem config.
- **Files:** `packages/gateway/src/job-runner.ts`, `packages/gateway/src/token-refresh.ts`, `packages/skills/src/google-calendar/handler.ts`, `packages/gateway/src/message-handler.ts`, `packages/gateway/src/phone-timezone.ts`, `ecosystem.config.cjs`
- **Commit:** `fd70bbc`

### Google Ads and Google Analytics skills [DEPLOYED]
- **What:** Added Google Ads skill (8 actions: list campaigns, reports, budget, pause/enable, audience insights) and Google Analytics skill (8 actions: traffic, sources, pages, conversions, demographics, realtime, acquisition).
- **Files:** `packages/skills/src/google-ads/`, `packages/skills/src/google-analytics/`, `packages/skills/src/registry.ts`
- **Commit:** `4045e38`

### Google Calendar, OAuth, admin dashboard, memory extraction [DEPLOYED]
- **What:** Google Calendar integration. OAuth short links. Admin dashboard at `/admin`. Memory extraction (fire-and-forget after each conversation).
- **Files:** `packages/skills/src/google-calendar/`, `apps/oauth-portal/`, `packages/agent/src/memory-extractor.ts`
- **Commit:** `a3aefa5`

### Telegram bot + adapter hardening [DEPLOYED]
- **What:** End-to-end Telegram bot wiring. Channel adapter pattern.
- **Commit:** `2192540`

### Integration tests [DEPLOYED]
- **What:** E2E integration tests for the message pipeline. 29 tests covering normalizer, rate limiter, tenant resolver, onboarding, full pipeline.
- **Commit:** `4a1016f`

### Config validation [DEPLOYED]
- **What:** Config validation with warnings for missing optional values.
- **Commit:** `464938d`

### Structured logging, rate limiting, error boundaries [DEPLOYED]
- **What:** Pino-based structured logging. Per-sender rate limiting. Error boundaries in message handler.
- **Commit:** `8dc7280`

### Social media skills [DEPLOYED]
- **What:** Instagram, Facebook Pages, LinkedIn, X skill handlers.
- **Commits:** `b33a796`, `4f1ef05`

### Google Ads skill (initial) [DEPLOYED]
- **What:** Initial Google Ads skill implementation.
- **Commit:** `93f2538`
