# HubSpot CRM Integration Design

**Date:** 2026-03-10
**Jira:** BAB-8
**Status:** Approved

## Overview

Add a HubSpot CRM skill to Babji so tenants can manage contacts, companies, and deals via chat. Uses HubSpot's REST API v3 directly (no SDK) with per-tenant OAuth 2.0 tokens, following the same pattern as the existing Google Ads handler.

## Scope

CRM + deals pipeline for v1:
- **Contacts:** search, get, create, update
- **Companies:** search, get, create, update
- **Deals:** search, get, create, update, list pipeline stages

Not included in v1: marketing hub, service hub, tickets, custom objects, webhooks.

## OAuth Setup

| Field | Value |
|-------|-------|
| Provider key | `hubspot` |
| Auth URL | `https://app.hubspot.com/oauth/authorize` |
| Token URL | `https://api.hubapi.com/oauth/v1/token` |
| Client ID env | `HUBSPOT_CLIENT_ID` |
| Client Secret env | `HUBSPOT_CLIENT_SECRET` |
| Scopes | `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.companies.read`, `crm.objects.companies.write`, `crm.objects.deals.read`, `crm.objects.deals.write`, `crm.objects.owners.read` |

Prerequisites: Create a HubSpot developer app at developers.hubspot.com, configure redirect URI to `https://babji.quantana.top/api/callback/hubspot`, and add `HUBSPOT_CLIENT_ID` + `HUBSPOT_CLIENT_SECRET` to production `.env`.

The existing generic OAuth callback handler (`/api/callback/[provider]`) handles token exchange -- no changes needed there.

## Actions (13 total)

### Contacts

| Action | Description | Required Params | Optional Params |
|--------|-------------|-----------------|-----------------|
| `search_contacts` | Search by name, email, or any property | `query` | `max_results` (1-100, default 10) |
| `get_contact` | Get a contact by ID | `contact_id` | |
| `create_contact` | Create a new contact | `email` | `firstname`, `lastname`, `phone`, `company` |
| `update_contact` | Update contact properties | `contact_id`, `properties` | |

### Companies

| Action | Description | Required Params | Optional Params |
|--------|-------------|-----------------|-----------------|
| `search_companies` | Search by name or domain | `query` | `max_results` (1-100, default 10) |
| `get_company` | Get a company by ID | `company_id` | |
| `create_company` | Create a new company | `name` | `domain`, `industry`, `phone` |
| `update_company` | Update company properties | `company_id`, `properties` | |

### Deals

| Action | Description | Required Params | Optional Params |
|--------|-------------|-----------------|-----------------|
| `search_deals` | Search deals by name or stage | `query` | `max_results` (1-100, default 10) |
| `get_deal` | Get a deal by ID | `deal_id` | |
| `create_deal` | Create a new deal | `dealname` | `amount`, `dealstage`, `pipeline`, `closedate` |
| `update_deal` | Update deal properties or move stages | `deal_id`, `properties` | |
| `list_deal_stages` | List all pipelines and their stages | _(none)_ | |

The `properties` parameter on update actions is a key-value object (e.g. `{"phone": "555-1234"}`), keeping it flexible without hardcoding every HubSpot property.

`list_deal_stages` is needed because deal stage IDs are opaque -- the LLM needs to see available stages before creating/moving deals.

## Handler Architecture

```
HubSpotHandler implements SkillHandler
├── constructor(accessToken: string)
├── execute(actionName, params) → switch on 13 actions
├── private hubspotFetch(method, path, body?) → shared fetch wrapper
│   - Base URL: https://api.hubapi.com
│   - Auth: Bearer token header
│   - Error handling: 401→"reconnect", 429→rate limit message, 4xx/5xx→wrapped error
├── private searchObjects(objectType, query, maxResults)
│   - POST /crm/v3/objects/{type}/search
│   - Uses HubSpot's filterGroups query format
├── private getObject(objectType, id)
│   - GET /crm/v3/objects/{type}/{id}
├── private createObject(objectType, properties)
│   - POST /crm/v3/objects/{type}
├── private updateObject(objectType, id, properties)
│   - PATCH /crm/v3/objects/{type}/{id}
└── private listPipelines()
    - GET /crm/v3/pipelines/deals
```

All 3 CRM object types follow the same HubSpot API pattern, so the handler uses generic internal methods parameterized by `objectType`. The public `execute()` switch validates params and routes to these.

## API Patterns

**Search:** POST to `/crm/v3/objects/{type}/search` with body:
```json
{
  "query": "user search term",
  "limit": 10,
  "properties": ["email", "firstname", "lastname", "phone", "company"]
}
```

**Get:** GET `/crm/v3/objects/{type}/{id}?properties=email,firstname,lastname,phone`

**Create:** POST `/crm/v3/objects/{type}` with body:
```json
{ "properties": { "email": "jane@acme.com", "firstname": "Jane" } }
```

**Update:** PATCH `/crm/v3/objects/{type}/{id}` with body:
```json
{ "properties": { "phone": "555-1234" } }
```

**Pipelines:** GET `/crm/v3/pipelines/deals` returns all pipelines with stages.

**Rate limits:** HubSpot allows 100 requests per 10 seconds for private apps, 150/10s for OAuth apps. The handler returns a clear error message on 429 (no automatic retry -- let the user try again).

**Pagination:** HubSpot uses cursor-based pagination with `paging.next.after`. For v1, we cap results at `max_results` (default 10, max 100) which fits within a single page. Pagination can be added later if needed.

## Error Handling

| HTTP Status | Handler Behavior |
|-------------|-----------------|
| 401 | `"Your HubSpot connection has expired. Please reconnect by saying 'connect hubspot'."` |
| 429 | `"HubSpot rate limit reached. Please wait a moment and try again."` |
| 404 | `"Contact/Company/Deal not found with that ID."` |
| 4xx/5xx | Wrapped error: `"HubSpot {action} failed: {message}"` |

## Files to Create

| File | Purpose |
|------|---------|
| `packages/skills/src/hubspot/handler.ts` | HubSpotHandler class (~250 lines) |
| `packages/skills/src/hubspot/index.ts` | Re-exports handler |

## Files to Modify

| File | Change |
|------|--------|
| `apps/oauth-portal/src/lib/providers.ts` | Add `hubspot` provider config |
| `packages/skills/src/registry.ts` | Add `hubspotSkill` definition (13 actions) |
| `packages/gateway/src/message-handler.ts` | Register HubSpotHandler for connected tenants; add `"hubspot"` to `connect_service` allowed list |
| `packages/gateway/src/server.ts` | Add `hubspot` to `providerMeta` for post-connect summary prompt |

## Post-Connect Flow

When a user connects HubSpot, the gateway sends:
1. Immediate: "HubSpot connected! Let me take a look..."
2. Brain-powered summary using prompt: "I just connected my HubSpot. Give me a quick overview of my recent contacts and any open deals."

## Dependencies

None. Uses native `fetch` (Node 18+). No new npm packages.

## Production Setup

1. Create HubSpot developer app at developers.hubspot.com
2. Set redirect URI to `https://babji.quantana.top/api/callback/hubspot`
3. Add to production `.env`:
   ```
   HUBSPOT_CLIENT_ID=<from hubspot developer portal>
   HUBSPOT_CLIENT_SECRET=<from hubspot developer portal>
   ```
