# Image Generation Skill (`image_gen`) - Design Spec

**Date:** 2026-03-10
**Jira:** BAB-12 (Skill request: poster_generator from Tan)
**Status:** Approved

## Overview

A new skill that generates images via Gemini's image generation API (nano banana). Uses a two-action architecture: `enhance_prompt` prepares and confirms the prompt with the user, `generate_image` produces the image. The Brain's ReAct loop handles the confirmation conversation naturally.

No per-user OAuth required. Uses the platform's `GOOGLE_API_KEY`.

## Architecture

```
User: "Make me a poster for my coffee shop"
  -> Brain calls image_gen.enhance_prompt({ brief: "poster for my coffee shop" })
    -> Handler uses lite LLM to enhance prompt with user context
    -> Returns: { enhanced_prompt, suggested_aspect_ratio, suggested_model }
  -> Brain shows enhanced prompt to user, asks for approval
  -> User: "looks good" or "make it more vintage"
  -> Brain calls image_gen.generate_image({ prompt: "...", aspect_ratio: "..." })
    -> Handler calls Gemini generateContent with responseModalities: ["IMAGE"]
    -> Returns base64, uploads to S3, stores metadata in DB
    -> Returns: { image_url, s3_key }
  -> Gateway sends image via Telegram sendPhoto using the S3 URL
```

If the user's MEMORY.md contains a preference for direct generation (e.g., "prefers direct image generation without confirmation"), the Brain skips `enhance_prompt` and calls `generate_image` directly with an internally enhanced prompt.

## Skill Actions

### Action 1: `enhance_prompt`

- **Input:** `brief` (string, required) - the user's raw request
- **Behavior:** Calls `gemini-2.0-flash-lite` with the brief + metaprompting system prompt. Incorporates user context (name, business, brand, style preferences from memory).
- **Returns:** `{ enhanced_prompt, suggested_aspect_ratio, reasoning }`
- **Credits:** 0

### Action 2: `generate_image`

- **Input:**
  - `prompt` (string, required) - the approved/final prompt
  - `aspect_ratio` (string, optional, default "1:1") - one of: 1:1, 3:2, 2:3, 3:4, 4:3, 9:16, 16:9
  - `quality` (string, optional, default "standard") - "standard" or "pro"
- **Behavior:** Calls Gemini image generation API.
  - `standard` -> `gemini-3.1-flash-image-preview`
  - `pro` -> `gemini-3-pro-image-preview`
- **Returns:** `{ success, image_url, s3_key, mime_type, caption }`
- **Side effects:** Uploads PNG to S3, inserts row into `generated_images` table
- **Credits:** 1

### Action 3: `edit_image` (future, not implemented now)

## API Details

### Prompt Enhancement (enhance_prompt)

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent
Headers: x-goog-api-key: {GOOGLE_API_KEY}
Body: {
  contents: [{ parts: [{ text: metaprompt + brief }] }],
  generationConfig: { responseMimeType: "application/json" }
}
```

Metaprompting system prompt:

```
You are an expert image prompt engineer. Given a brief from a user,
create a detailed image generation prompt that will produce a
professional, high-quality result.

Context about the user:
{memory_excerpt}

Rules:
- Expand vague briefs into specific, detailed visual descriptions
- Include style, composition, lighting, color palette
- If the user's business/brand is known, incorporate it naturally
- Suggest an aspect ratio based on use case (poster=3:4, social=1:1, banner=16:9)
- Keep it under 200 words
- Output JSON: { "enhanced_prompt": "...", "suggested_aspect_ratio": "...", "reasoning": "..." }
```

### Image Generation (generate_image)

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
Headers: x-goog-api-key: {GOOGLE_API_KEY}
Body: {
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: {
    responseModalities: ["IMAGE"],
    imageConfig: { aspectRatio: "1:1", imageSize: "1K" }
  }
}
```

Response: `candidates[0].content.parts[0].inline_data.data` contains base64 PNG.

## S3 Storage

### Upload Flow

After Gemini returns the base64 image:

1. Decode base64 to Buffer
2. Upload to S3: `s3://{bucket}/tenants/{tenantId}/images/{timestamp}-{8-char-hash}.png`
3. Insert metadata row into `generated_images` table
4. Return the S3 URL (public or presigned depending on bucket config)

### Database: `generated_images` Table

```sql
CREATE TABLE generated_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  s3_key TEXT NOT NULL,
  s3_url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  original_brief TEXT,
  aspect_ratio TEXT DEFAULT '1:1',
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_generated_images_tenant ON generated_images(tenant_id, created_at DESC);
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `S3_BUCKET` | Bucket name |
| `S3_REGION` | AWS region |
| `S3_ACCESS_KEY_ID` | AWS access key |
| `S3_SECRET_ACCESS_KEY` | AWS secret key |
| `S3_ENDPOINT` | Optional - for S3-compatible providers |

### Dependencies

- `@aws-sdk/client-s3` - AWS S3 client (lightweight, tree-shakeable)

## Gateway Integration

### Handler Registration

Registered for every tenant unconditionally in message-handler.ts:

```typescript
toolExecutor.registerSkill("image_gen", new ImageGenHandler(
  config.googleApiKey,
  { name: userName, memory: memoryContent }
));
```

### Telegram Image Delivery

After Brain returns, scan tool results for `image_url`. If found:

1. Send via `bot.api.sendPhoto(chatId, image_url)` with caption (Telegram fetches from URL)
2. Send any remaining text response as a follow-up message

This is added to the message-handler's response path.

### Telegram Adapter

Add `sendPhoto` capability to the adapter alongside existing `sendMessage`.

## Preference: Skip Confirmation

When a user says "don't ask me again" or similar, the memory extractor naturally captures this as a fact in MEMORY.md. On subsequent requests, the Brain reads this preference from memory and skips `enhance_prompt`, calling `generate_image` directly.

No DB migration or new columns needed for this preference.

## Files Touched

| File | Change |
|------|--------|
| `packages/skills/src/image-gen/definition.yaml` | New - skill definition |
| `packages/skills/src/image-gen/handler.ts` | New - handler with S3 upload |
| `packages/skills/src/registry.ts` | Register image_gen skill |
| `packages/db/src/schema.ts` | Add `generated_images` table |
| `packages/db/src/index.ts` | Export new table |
| `packages/gateway/src/config.ts` | Add S3 config fields |
| `packages/gateway/src/message-handler.ts` | Register handler + image delivery |
| `packages/gateway/src/adapters/telegram.ts` | Add sendPhoto support |

## Not Building Now

- No gallery UI (future - data will be ready in DB + S3)
- No `edit_image` action (future)
- No multi-image generation (one per request)
- No explicit preference learning system (MEMORY.md handles this naturally for now)

## Model Selection

| Quality | Model | Use Case |
|---------|-------|----------|
| standard (default) | gemini-3.1-flash-image-preview | Quick images, social posts, casual requests |
| pro | gemini-3-pro-image-preview | Ad posters, professional assets, when user says "high quality" |
