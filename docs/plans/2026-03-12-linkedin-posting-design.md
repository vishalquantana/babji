# LinkedIn Posting Skill Design

**Date:** 2026-03-12
**Jira:** BAB-41
**Status:** Approved

## Goal

Enable Babji tenants to create LinkedIn posts (text, images, articles), read their own posts, and view engagement analytics — all via Telegram chat.

## Scope

- **Content types:** Text, single image, article/link shares
- **Profile type:** Personal profiles only (`w_member_social`, self-service — no LinkedIn approval needed)
- **Read access:** List own posts, get individual post details, engagement metrics (likes, comments, shares)

## Existing State

A partial LinkedIn handler already exists but is **not wired up**:

- `packages/skills/src/linkedin/handler.ts` — 3 actions using deprecated v2 UGC API (`/v2/ugcPosts`)
- `apps/oauth-portal/src/lib/providers.ts` — LinkedIn OAuth config already registered (scopes: `openid`, `profile`, `w_member_social`)
- `packages/gateway/src/message-handler.ts` — `PROVIDER_ALIASES` has `linkedin` but `PROVIDER_CONFIGS` does not

## Actions

| Action | Description | Parameters |
|--------|-------------|------------|
| `create_post` | Create a text, image, or article post | `text` (required), `image_url` (optional), `article_url` (optional), `article_title` (optional), `visibility` (optional: PUBLIC/CONNECTIONS, default PUBLIC) |
| `list_posts` | List recent posts by the authenticated user | `count` (optional, default 10, max 50) |
| `get_post` | Get a single post with engagement stats | `post_id` (required) |
| `get_profile` | Get the authenticated user's LinkedIn profile | none |
| `get_post_analytics` | Get engagement metrics for recent posts | `count` (optional, default 5) |

## API Details

### Migration: UGC API -> Posts API

The existing handler uses the deprecated `/v2/ugcPosts` endpoint. Rewrite to use the Community Management Posts API:

- **Create post:** `POST https://api.linkedin.com/rest/posts`
- **List posts:** `GET https://api.linkedin.com/rest/posts?q=author&author={urn}`
- **Get post:** `GET https://api.linkedin.com/rest/posts/{encoded_URN}`
- **Delete post:** `DELETE https://api.linkedin.com/rest/posts/{encoded_URN}`

All requests require:
```
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
X-Restli-Protocol-Version: 2.0.0
Linkedin-Version: 202601
```

### Image Upload (2-step)

1. `POST https://api.linkedin.com/rest/images?action=initializeUpload` with `{ initializeUploadRequest: { owner: "urn:li:person:{id}" } }`
2. `PUT {uploadUrl}` with binary image data
3. Reference `urn:li:image:{id}` in the post's `content.media.id` field

For Babji, the user sends an image URL via Telegram. The handler fetches the image bytes, uploads to LinkedIn, then creates the post.

### Article/Link Posts

No upload needed. Set `content.article` with:
```json
{
  "source": "https://example.com/article",
  "title": "Article Title",
  "description": "Optional description"
}
```

### Engagement Metrics

Social metadata is embedded in post responses (`likeCount`, `commentCount`, `shareCount` in `socialDetail`). For `get_post_analytics`, fetch recent posts and extract these fields.

## OAuth & Token Flow

- **Provider config:** Already in `providers.ts` — scopes: `openid`, `profile`, `w_member_social`
- **Token expiry:** 60 days. LinkedIn supports refresh tokens via `grant_type=refresh_token` at `https://www.linkedin.com/oauth/v2/accessToken`
- **Token storage:** Existing `TokenVault` (AES-256-GCM), same as Gmail
- **Token refresh:** Add LinkedIn case to `token-refresh.ts`

## Files to Change

| File | Change |
|------|--------|
| `packages/skills/src/linkedin/handler.ts` | Rewrite: Posts API, image upload, article posts, analytics |
| `packages/skills/src/registry.ts` | Add `linkedinSkill` definition to `allSkills[]`, add "linkedin" to `connect_service` description |
| `packages/gateway/src/message-handler.ts` | Add LinkedIn to `PROVIDER_CONFIGS`, register handler in connection loop |
| `packages/gateway/src/token-refresh.ts` | Add LinkedIn token refresh logic |
| Production `.env` | Add `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |

No new files. No schema changes. No new npm dependencies (use `fetch` directly).

## Not in Scope

- Company page posting (requires `w_organization_social` + LinkedIn approval)
- Video or document (PDF) uploads
- Poll creation
- Multi-image posts
- Scheduling posts for later
- Comment management
