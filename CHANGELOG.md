# Changelog

All notable changes to Babji are documented here. Each entry notes whether the change has been deployed to production.

---

## 2026-03-09

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
