# Changelog

All notable changes to Babji are documented here. Each entry notes whether the change has been deployed to production.

---

## 2026-03-10

### Image generation skill with Gemini API (BAB-12) [DEPLOYED]
- **What:** New `image_gen` skill lets users generate images via conversational brief. Two-step flow: (1) `enhance_prompt` — metaprompts the user's brief with their context/memory using lite LLM, shows enhanced prompt for approval, (2) `generate_image` — calls Gemini image API (flash or pro model), uploads PNG to S3, saves metadata to DB. Supports "don't ask me again" preference stored in MEMORY.md. Telegram adapter updated to send photos via `sendPhoto` API (URL or base64 buffer). Images stored on Vultr Object Storage (S3-compatible) for future gallery feature.
- **Files:** `packages/skills/src/image-gen/` (new: handler.ts, s3.ts, index.ts), `packages/skills/src/registry.ts`, `packages/skills/src/index.ts`, `packages/agent/src/brain.ts` (MediaResult type, base64 stripping), `packages/agent/src/index.ts`, `packages/gateway/src/message-handler.ts`, `packages/gateway/src/config.ts` (S3 config), `packages/gateway/src/index.ts`, `packages/gateway/src/adapters/telegram.ts` (sendPhoto), `packages/db/src/schema.ts` (generated_images table)
- **DB migration:** `CREATE TABLE generated_images (...)` with tenant index
- **Dependencies:** `@aws-sdk/client-s3` added to skills package

### Fix: Gmail 502 + deep research delivery + PM2 management (BAB-11) [DEPLOYED]
- **What:** Gmail OAuth connect links returned 502 because the OAuth portal process had died and wasn't auto-managed. Deep research jobs timed out after 60 minutes but Google's API can take hours — one completed research report was never delivered. Fixed by: (1) Adding OAuth portal to PM2 for auto-restart (`babji-oauth`, ID 2), (2) Increasing deep research timeout from 60 min to 6 hours, (3) Manually recovered and delivered the completed research to the user, (4) Updated CLAUDE.md deploy instructions to use PM2 instead of manual nohup (which caused duplicate processes). Both gateway and OAuth portal now managed by PM2 with auto-restart and startup persistence.
- **Files:** `packages/gateway/src/job-runner.ts` (timeout change), `CLAUDE.md` (PM2 deploy instructions)
- **Root cause:** OAuth portal process crashed with no supervisor. `start-gateway.sh` was being called via both PM2 and manual nohup, causing duplicate processes and log confusion.

### Usage tracking: LLM tokens, external APIs, daily reports [DEPLOYED]
- **What:** Comprehensive usage tracking across the entire system. LLM token counts (input/output/total) captured from Vercel AI SDK and accumulated across Brain ReAct loop turns. External API calls (DataForSEO, Scrapin.io) logged per action. Background jobs (calendar summary, meeting briefing, profile scan, deep research) log usage. All events written to the existing `audit_log` table via a new `UsageTracker` utility (fire-and-forget pattern). Admin dashboard has a new "Usage Summary (last 7 days)" section with stat boxes (Messages, Tokens, Tool Calls, External APIs) and a per-tenant breakdown table sorted by token usage. Daily usage report sent to admin via Telegram at 08:00 UTC showing total usage + top 10 users by tokens.
- **Files:** `packages/agent/src/llm-client.ts`, `packages/agent/src/brain.ts`, `packages/gateway/src/usage-tracker.ts` (new), `packages/gateway/src/message-handler.ts`, `packages/gateway/src/job-runner.ts`, `packages/gateway/src/index.ts`, `packages/db/src/schema.ts`, `apps/oauth-portal/src/app/api/admin/data/route.ts`, `apps/oauth-portal/src/app/admin/dashboard/client.tsx`
- **DB migration:** `CREATE INDEX idx_audit_action_created ON audit_log(action, created_at)` (already run on production)

---

## 2026-03-09

### Profile verification & correction workflow [DEPLOYED]
- **What:** Global profile directory (DB table) replaces per-tenant disk cache for meeting attendee profiles. Evening scanner job (`profile_scan`) researches tomorrow's external attendees at 6 PM and notifies admin of new profiles via Telegram. Admin dashboard "Profile Directory" section shows all profiles with verify/edit/rescrape actions. Admin can paste correct LinkedIn URL and trigger re-scrape. Corrections are global -- benefit all tenants. Profiles cached 7 days (pending) or 30 days (verified/corrected) before re-scrape.
- **Files:** `packages/db/src/schema.ts`, `packages/gateway/src/meeting-briefing.ts`, `packages/gateway/src/job-runner.ts`, `packages/gateway/src/admin-notifier.ts`, `packages/gateway/src/index.ts`, `apps/oauth-portal/src/app/api/admin/profiles/` (new), `apps/oauth-portal/src/app/api/admin/data/route.ts`, `apps/oauth-portal/src/app/admin/dashboard/client.tsx`
- **DB migration:** `CREATE TABLE profile_directory (...)` with `profile_status` enum

### Meeting attendee briefing (BAB-5) [DEPLOYED]
- **What:** Pre-meeting attendee research and briefing. When the daily calendar summary runs, detects external attendees (different email domain). If briefings enabled, researches them via Scrapin.io + DataForSEO (LinkedIn profiles) and sends a rich dossier. Two timing modes: "morning" (with calendar summary) or "pre_meeting" (1 hour before each meeting). On-demand via "brief me on my 2 PM meeting". Organic discovery -- suggests the feature when external attendees detected. Results cached 7 days per tenant. Also: proactive OAuth connect link generation (no more "would you like me to connect?").
- **Files:** `packages/db/src/schema.ts`, `packages/skills/src/registry.ts`, `packages/gateway/src/meeting-briefing.ts` (new), `packages/gateway/src/job-runner.ts`, `packages/gateway/src/message-handler.ts`, `packages/gateway/src/index.ts`, `packages/agent/src/prompt-builder.ts`
- **DB migration:** `ALTER TABLE tenants ADD COLUMN email_domain VARCHAR(100); ALTER TABLE tenants ADD COLUMN meeting_briefing_pref VARCHAR(20);`

### Recurring reminders (BAB-4) [DEPLOYED]
- **What:** Added recurring reminders. Users can say "remind me every day at 9:20 AM to check orders" and the system creates a repeating scheduled job. Supports daily, weekdays (Mon-Fri), weekly, monthly, and yearly recurrence. JobRunner reschedules instead of completing for recurring jobs. list_tasks shows recurrence info. PromptBuilder guides Brain on when to use recurring vs single reminders. No schema changes -- uses existing scheduledJobs infrastructure.
- **Files:** `packages/skills/src/registry.ts`, `packages/skills/src/todos/handler.ts`, `packages/gateway/src/job-runner.ts`, `packages/agent/src/prompt-builder.ts`
- **Jira:** BAB-4 (Done)

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
