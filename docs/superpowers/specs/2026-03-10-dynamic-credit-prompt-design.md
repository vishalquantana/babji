# Dynamic Credit Count in System Prompt

## Problem

`prompt-builder.ts:118` hardcodes "The client gets 5 free daily credits" in the system prompt sent to the LLM. The actual default is 100 (configured in `appConfig.defaultDailyFreeCredits`), and can be overridden per-tenant via `creditBalances.dailyFreeOverride`. The LLM reads the hardcoded "5" and warns users they're running low when they have plenty of credits left.

## Existing Infrastructure (no changes needed)

- `appConfig.defaultDailyFreeCredits` (DB, default 100) -- global setting
- `creditBalances.dailyFreeOverride` (DB, nullable) -- per-tenant override
- `CreditLedger.getDailyFreeAmount(tenantId)` -- resolves override > global > 100 fallback
- Admin dashboard: Settings section edits global default
- Admin dashboard: Tenant detail page edits per-tenant override
- API endpoints: `PUT /api/admin/settings`, `PUT /api/admin/tenant/[id]/daily-free`

## Fix

### 1. `packages/agent/src/prompt-builder.ts`

- Add `dailyFreeCredits?: number` to `PromptContext` interface
- Replace hardcoded "5" with `ctx.dailyFreeCredits ?? 100` in the credits section

### 2. `packages/gateway/src/message-handler.ts`

- Before calling `PromptBuilder.build()`, call `creditLedger.getDailyFreeAmount(tenantId)`
- Pass the result as `dailyFreeCredits` in the context object

### 3. Tests

- Update prompt-builder tests if any assert on the "5 free" string
- Verify the dynamic value flows through correctly

Two files changed, ~10 lines total. No DB migrations, no new APIs, no admin portal changes.
