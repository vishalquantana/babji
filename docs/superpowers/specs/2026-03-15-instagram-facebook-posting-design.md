# Instagram & Facebook Posting

**Date:** 2026-03-15
**Status:** Approved

## Goal

Enable Babji users to post and schedule content to Instagram and Facebook through conversational commands. The existing handlers, OAuth config, and provider mapping are already in place — this work wires them into the Brain and adds scheduling.

## Existing Infrastructure

| Component | Status | Location |
|-----------|--------|----------|
| Instagram handler (`create_post`, `list_posts`, `get_profile`) | Implemented | `packages/skills/src/instagram/handler.ts` |
| Facebook Pages handler (`list_pages`, `create_post`, `get_insights`) | Implemented | `packages/skills/src/facebook-pages/handler.ts` |
| Meta OAuth (FB + IG scopes) | Configured | `apps/oauth-portal/src/lib/providers.ts` |
| Provider alias mapping (`meta`/`facebook`/`instagram` → `"meta"`) | Configured | `packages/gateway/src/message-handler.ts` |
| Image generation skill | Working | `packages/skills/src/image-gen/handler.ts` |
| LinkedIn scheduling pattern | Working | `packages/gateway/src/job-runner.ts` |

## Changes

### 1. Skill Definitions in Registry (`packages/skills/src/registry.ts`)

**Instagram skill:**
- `create_post` — requires `image_url` + optional `caption`. Instagram requires an image for every post.
- `list_posts` — optional `count` param
- `get_profile` — no params
- `schedule_post` — `image_url`, `caption`, `scheduled_time`
- `list_scheduled_posts` — no params
- `cancel_scheduled_post` — `job_id`

**Facebook Pages skill:**
- `list_pages` — no params
- `create_post` — `page_id`, `message`, optional `link`
- `get_insights` — `page_id`, optional `metric`, `period`
- `schedule_post` — `page_id`, `message`, `scheduled_time`, optional `link`
- `list_scheduled_posts` — no params
- `cancel_scheduled_post` — `job_id`

### 2. Skill Registration in Message Handler (`packages/gateway/src/message-handler.ts`)

When `conn.provider === "meta"`:
- Register `instagram` skill with `InstagramHandler` + scheduling callbacks
- Register `facebook_pages` skill with `FacebookPagesHandler` + scheduling callbacks
- Scheduling callbacks follow the LinkedIn pattern: store in `scheduled_jobs` with `jobType` = `scheduled_instagram_post` or `scheduled_facebook_post`

### 3. Job Runner (`packages/gateway/src/job-runner.ts`)

Add two new cases in the job type switch:
- `scheduled_instagram_post` — get fresh Meta token, call `instagram.create_post`, notify user
- `scheduled_facebook_post` — get fresh Meta token, call `facebook_pages.create_post`, notify user

Both follow the LinkedIn pattern: one-time job, mark completed after execution, notify user on success/failure/token expiry.

### 4. Post-Connect Flow (`packages/gateway/src/server.ts`)

Add `meta` to `providerMeta` with display name "Instagram & Facebook" and a post-connect prompt like "I just connected my Instagram and Facebook. What pages do I manage?"

### 5. Handler Extensions

**InstagramHandler** — add `schedule_post`, `list_scheduled_posts`, `cancel_scheduled_post` methods + `InstagramDeps` interface with scheduling callbacks (same pattern as `LinkedInDeps`).

**FacebookPagesHandler** — same additions with `FacebookPagesDeps` interface.

## Out of Scope

- Meta Ads skill (handler exists, separate feature)
- Facebook Stories / Reels
- Instagram Stories / Reels
- Comment management
- New database tables

## User Experience

1. "connect instagram" → Meta OAuth → "Instagram & Facebook connected! Let me see what pages you manage..."
2. "Post this image to Instagram with caption about AI trends" → Brain calls `instagram.create_post`
3. "Create a post about our new product and put it on Instagram and Facebook" → Brain generates image, posts to both
4. "Schedule an Instagram post for tomorrow at 10am" → Brain calls `instagram.schedule_post` → published automatically → Telegram notification
