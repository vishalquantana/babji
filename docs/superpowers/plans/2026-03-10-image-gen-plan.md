# Image Generation Skill Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `image_gen` skill with metaprompting (enhance_prompt + generate_image), S3 storage, Telegram photo delivery, and DB metadata tracking.

**Architecture:** Two-action skill using Gemini image API. `enhance_prompt` calls lite LLM to refine user briefs, `generate_image` calls Gemini image model and uploads result to Vultr S3. Gateway detects `image_url` in tool results and sends via Telegram `sendPhoto`. No per-user OAuth needed.

**Tech Stack:** Gemini REST API, `@aws-sdk/client-s3`, Drizzle ORM, grammy `sendPhoto`

**Spec:** `docs/superpowers/specs/2026-03-10-image-gen-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/skills/src/image-gen/handler.ts` | **New** — ImageGenHandler: enhance_prompt (lite LLM metaprompting) + generate_image (Gemini image API + S3 upload + DB insert) |
| `packages/skills/src/image-gen/s3.ts` | **New** — S3Client wrapper: uploadImage(buffer, key) -> url |
| `packages/skills/src/image-gen/index.ts` | **New** — barrel export |
| `packages/skills/src/registry.ts` | **Modify** — add imageGenSkill definition to allSkills array |
| `packages/skills/src/index.ts` | **Modify** — export ImageGenHandler |
| `packages/db/src/schema.ts` | **Modify** — add `generatedImages` table |
| `packages/gateway/src/config.ts` | **Modify** — add S3 config fields |
| `packages/gateway/src/message-handler.ts` | **Modify** — register image_gen skill, detect image_url in response |
| `packages/gateway/src/adapters/telegram.ts` | **Modify** — add sendPhoto support |
| `packages/gateway/src/index.ts` | **Modify** — pass S3 config to handler deps |

---

## Chunk 1: S3 Client + DB Schema

### Task 1: Add `generated_images` table to DB schema

**Files:**
- Modify: `packages/db/src/schema.ts:229` (append after auditLog table)

- [ ] **Step 1: Add the generated_images table definition**

Add at the end of `packages/db/src/schema.ts`:

```typescript
export const generatedImages = pgTable(
  "generated_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    s3Key: text("s3_key").notNull(),
    s3Url: text("s3_url").notNull(),
    prompt: text("prompt").notNull(),
    originalBrief: text("original_brief"),
    aspectRatio: varchar("aspect_ratio", { length: 10 }).default("1:1"),
    model: varchar("model", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_generated_images_tenant").on(table.tenantId, table.createdAt),
  ]
);
```

- [ ] **Step 2: Run the gateway build to verify schema compiles**

Run: `pnpm --filter @babji/db build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Push the migration to production DB**

Run on server via SSH:
```bash
ssh root@65.20.76.199 'cd /opt/babji && source .env && node -e "
const pg = require(\"postgres\");
const sql = pg(process.env.DATABASE_URL);
sql\`
CREATE TABLE IF NOT EXISTS generated_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  s3_key TEXT NOT NULL,
  s3_url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  original_brief TEXT,
  aspect_ratio VARCHAR(10) DEFAULT '\''1:1'\'',
  model VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_generated_images_tenant ON generated_images(tenant_id, created_at DESC);
\`.then(() => { console.log(\"Table created\"); sql.end(); })
.catch(e => { console.error(e); sql.end(); process.exit(1); });
"'
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat: add generated_images table for image generation skill"
```

---

### Task 2: Add S3 config to gateway

**Files:**
- Modify: `packages/gateway/src/config.ts:1-76`

- [ ] **Step 1: Add S3 fields to GatewayConfig interface**

In `packages/gateway/src/config.ts`, add after `people` field (line 35):

```typescript
  s3: {
    enabled: boolean;
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
  };
```

- [ ] **Step 2: Add S3 config loading in loadConfig()**

In `loadConfig()`, add after the `people` block (line 75):

```typescript
    s3: {
      enabled: !!process.env.S3_BUCKET && !!process.env.AWS_ACCESS_KEY_ID,
      bucket: process.env.S3_BUCKET || "",
      region: process.env.AWS_REGION || "us-east-1",
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      endpoint: process.env.AWS_S3_ENDPOINT || undefined,
    },
```

- [ ] **Step 3: Build to verify**

Run: `pnpm --filter @babji/gateway build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/config.ts
git commit -m "feat: add S3 config for image storage"
```

---

### Task 3: Create S3 upload module

**Files:**
- Create: `packages/skills/src/image-gen/s3.ts`

- [ ] **Step 1: Install @aws-sdk/client-s3 in skills package**

Run: `pnpm --filter @babji/skills add @aws-sdk/client-s3`

- [ ] **Step 2: Create the S3 upload module**

Create `packages/skills/src/image-gen/s3.ts`:

```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

export class ImageStore {
  private client: S3Client;
  private bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    });
  }

  /**
   * Upload a PNG buffer to S3 and return the public URL.
   * Key format: tenants/{tenantId}/images/{timestamp}-{hash}.png
   */
  async upload(tenantId: string, buffer: Buffer, hash: string): Promise<{ s3Key: string; s3Url: string }> {
    const timestamp = Date.now();
    const s3Key = `tenants/${tenantId}/images/${timestamp}-${hash}.png`;

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      Body: buffer,
      ContentType: "image/png",
      ACL: "public-read",
    }));

    // Build public URL
    const endpoint = this.client.config.endpoint;
    let s3Url: string;
    if (endpoint) {
      // S3-compatible (Vultr, MinIO): endpoint/bucket/key
      const base = typeof endpoint === "function"
        ? (await endpoint()).url.toString().replace(/\/$/, "")
        : String(endpoint).replace(/\/$/, "");
      s3Url = `${base}/${this.bucket}/${s3Key}`;
    } else {
      // Standard AWS S3
      s3Url = `https://${this.bucket}.s3.amazonaws.com/${s3Key}`;
    }

    return { s3Key, s3Url };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/skills/src/image-gen/s3.ts
git commit -m "feat: add S3 ImageStore for image uploads"
```

---

## Chunk 2: Image Gen Handler

### Task 4: Create the ImageGenHandler

**Files:**
- Create: `packages/skills/src/image-gen/handler.ts`
- Create: `packages/skills/src/image-gen/index.ts`

- [ ] **Step 1: Create the handler**

Create `packages/skills/src/image-gen/handler.ts`:

```typescript
import type { SkillHandler } from "@babji/agent";
import type { ImageStore } from "./s3.js";
import { createHash } from "node:crypto";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface UserContext {
  name?: string;
  memory?: string;
}

interface DbDeps {
  insertGeneratedImage: (row: {
    tenantId: string;
    s3Key: string;
    s3Url: string;
    prompt: string;
    originalBrief?: string;
    aspectRatio: string;
    model: string;
  }) => Promise<void>;
  tenantId: string;
}

export class ImageGenHandler implements SkillHandler {
  constructor(
    private googleApiKey: string,
    private userContext: UserContext,
    private imageStore: ImageStore | null,
    private dbDeps: DbDeps,
  ) {}

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "enhance_prompt":
        return this.enhancePrompt(params);
      case "generate_image":
        return this.generateImage(params);
      default:
        throw new Error(`Unknown image_gen action: ${actionName}`);
    }
  }

  private async enhancePrompt(params: Record<string, unknown>) {
    const brief = params.brief as string;
    if (!brief) throw new Error("Missing required parameter: brief");

    const memoryExcerpt = this.userContext.memory
      ? this.userContext.memory.slice(0, 1000)
      : "No information available about this user yet.";

    const userName = this.userContext.name || "the user";

    const metaprompt = `You are an expert image prompt engineer. Given a brief from a user named ${userName}, create a detailed image generation prompt that will produce a professional, high-quality result.

Context about the user:
${memoryExcerpt}

The user's brief: "${brief}"

Rules:
- Expand vague briefs into specific, detailed visual descriptions
- Include style, composition, lighting, color palette where appropriate
- If the user's business or brand is known from context, incorporate it naturally
- Suggest an aspect ratio based on the use case (poster = 3:4, social media post = 1:1, banner = 16:9, story = 9:16, landscape photo = 3:2)
- Keep the enhanced prompt under 200 words
- Do NOT include any text/words/letters in the image unless the user specifically requested text
- Output valid JSON: { "enhanced_prompt": "...", "suggested_aspect_ratio": "...", "reasoning": "..." }`;

    const response = await fetch(
      `${GEMINI_API_BASE}/models/gemini-2.0-flash-lite:generateContent?key=${this.googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: metaprompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Prompt enhancement failed: HTTP ${response.status} — ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Prompt enhancement returned empty result");

    try {
      const parsed = JSON.parse(text);
      return {
        enhanced_prompt: parsed.enhanced_prompt,
        suggested_aspect_ratio: parsed.suggested_aspect_ratio || "1:1",
        reasoning: parsed.reasoning || "",
        hint: "Show the enhanced_prompt to the user and ask if it looks good or if they want changes. If they approve, call image_gen.generate_image with the enhanced_prompt as the prompt parameter and the suggested_aspect_ratio.",
      };
    } catch {
      // LLM didn't return valid JSON — use the raw text as the prompt
      return {
        enhanced_prompt: text.slice(0, 1000),
        suggested_aspect_ratio: "1:1",
        reasoning: "",
        hint: "Show the enhanced_prompt to the user and ask if it looks good or if they want changes.",
      };
    }
  }

  private async generateImage(params: Record<string, unknown>) {
    const prompt = params.prompt as string;
    if (!prompt) throw new Error("Missing required parameter: prompt");

    const aspectRatio = (params.aspect_ratio as string) || "1:1";
    const quality = (params.quality as string) || "standard";

    const validAspectRatios = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"];
    const finalAspectRatio = validAspectRatios.includes(aspectRatio) ? aspectRatio : "1:1";

    const model = quality === "pro"
      ? "gemini-3-pro-image-preview"
      : "gemini-3.1-flash-image-preview";

    const response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:generateContent?key=${this.googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: {
              aspectRatio: finalAspectRatio,
              imageSize: "1K",
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Image generation failed: HTTP ${response.status} — ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as any;
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error("Image generation returned no content. The prompt may have been blocked by safety filters.");
    }

    // Find the image part
    const imagePart = parts.find((p: any) => p.inline_data?.mime_type?.startsWith("image/"));
    if (!imagePart) {
      // Might have returned text instead (safety block explanation)
      const textPart = parts.find((p: any) => p.text);
      throw new Error(`Image generation did not produce an image. ${textPart?.text || "Try a different prompt."}`);
    }

    const base64Data = imagePart.inline_data.data;
    const mimeType = imagePart.inline_data.mime_type || "image/png";
    const buffer = Buffer.from(base64Data, "base64");

    // Upload to S3 if configured
    let s3Key = "";
    let s3Url = "";
    const hash = createHash("md5").update(buffer).digest("hex").slice(0, 8);

    if (this.imageStore) {
      const upload = await this.imageStore.upload(this.dbDeps.tenantId, buffer, hash);
      s3Key = upload.s3Key;
      s3Url = upload.s3Url;

      // Store metadata in DB
      await this.dbDeps.insertGeneratedImage({
        tenantId: this.dbDeps.tenantId,
        s3Key,
        s3Url,
        prompt,
        originalBrief: (params.original_brief as string) || undefined,
        aspectRatio: finalAspectRatio,
        model,
      });
    }

    return {
      success: true,
      image_base64: base64Data,
      image_url: s3Url || undefined,
      s3_key: s3Key || undefined,
      mime_type: mimeType,
      caption: `Generated with ${quality === "pro" ? "high quality" : "standard"} model (${finalAspectRatio})`,
    };
  }
}
```

- [ ] **Step 2: Create barrel export**

Create `packages/skills/src/image-gen/index.ts`:

```typescript
export { ImageGenHandler } from "./handler.js";
export { ImageStore } from "./s3.js";
export type { S3Config } from "./s3.js";
```

- [ ] **Step 3: Export from skills package root**

In `packages/skills/src/index.ts`, add:

```typescript
export { ImageGenHandler, ImageStore } from "./image-gen/index.js";
export type { S3Config } from "./image-gen/index.js";
```

- [ ] **Step 4: Build to verify**

Run: `pnpm --filter @babji/skills build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/skills/src/image-gen/ packages/skills/src/index.ts
git commit -m "feat: add ImageGenHandler with metaprompting and S3 upload"
```

---

### Task 5: Register image_gen in skill registry

**Files:**
- Modify: `packages/skills/src/registry.ts:927`

- [ ] **Step 1: Add imageGenSkill definition**

In `packages/skills/src/registry.ts`, add before the `allSkills` array (before line 927):

```typescript
const imageGenSkill: SkillDefinition = {
  name: "image_gen",
  displayName: "Image Generation",
  description: "Generate professional images from text descriptions. First enhances the user's brief into a detailed prompt, then generates the image.",
  actions: [
    {
      name: "enhance_prompt",
      description: "Enhance a user's image brief into a detailed, professional prompt. Always call this FIRST before generate_image (unless the user's memory says they prefer direct generation). Show the enhanced prompt to the user and ask for approval or changes before generating.",
      parameters: {
        brief: {
          type: "string",
          required: true,
          description: "The user's raw image request or brief",
        },
      },
    },
    {
      name: "generate_image",
      description: "Generate an image from an approved prompt. Call this AFTER the user approves the enhanced prompt from enhance_prompt, or directly if the user prefers skipping confirmation.",
      parameters: {
        prompt: {
          type: "string",
          required: true,
          description: "The approved/final image generation prompt",
        },
        aspect_ratio: {
          type: "string",
          required: false,
          description: "Aspect ratio: 1:1 (default), 3:2, 2:3, 3:4, 4:3, 9:16, 16:9",
        },
        quality: {
          type: "string",
          required: false,
          description: "Image quality: 'standard' (default, fast) or 'pro' (highest quality, slower)",
        },
      },
    },
  ],
  creditsPerAction: 0, // enhance_prompt is free; generate_image costs are handled in handler
};
```

- [ ] **Step 2: Add to allSkills array**

Change line 927 from:
```typescript
const allSkills: SkillDefinition[] = [gmailSkill, calendarSkill, googleAdsSkill, googleAnalyticsSkill, checkWithTeacherSkill, peopleSkill, generalResearchSkill];
```
to:
```typescript
const allSkills: SkillDefinition[] = [gmailSkill, calendarSkill, googleAdsSkill, googleAnalyticsSkill, checkWithTeacherSkill, peopleSkill, generalResearchSkill, imageGenSkill];
```

- [ ] **Step 3: Build to verify**

Run: `pnpm --filter @babji/skills build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/skills/src/registry.ts
git commit -m "feat: register image_gen skill in registry"
```

---

## Chunk 3: Gateway Integration

### Task 6: Wire up ImageGenHandler in message-handler

**Files:**
- Modify: `packages/gateway/src/message-handler.ts:1-965`
- Modify: `packages/gateway/src/index.ts:1-207`

- [ ] **Step 1: Add import and S3 config to MessageHandlerDeps**

In `packages/gateway/src/message-handler.ts`:

Add to imports (line 9):
```typescript
import { GmailHandler, GoogleCalendarHandler, GoogleAdsHandler, GoogleAnalyticsHandler, PeopleHandler, TodosHandler, GeneralResearchHandler, ImageGenHandler, ImageStore } from "@babji/skills";
import type { S3Config } from "@babji/skills";
```
(Replaces the existing import line 9.)

Add to `MessageHandlerDeps` interface (after `googleModel: string;` at line 111):
```typescript
  s3Config?: S3Config;
```

- [ ] **Step 2: Register image_gen handler in the handle() method**

In `packages/gateway/src/message-handler.ts`, after the general_research registration block (after line 483, before `// ── Build AI SDK tool definitions`), add:

```typescript
      // ── Register image generation handler (no OAuth needed, uses platform API key) ──
      if (this.deps.googleApiKey) {
        const imageStore = this.deps.s3Config
          ? new ImageStore(this.deps.s3Config)
          : null;

        toolExecutor.registerSkill("image_gen", new ImageGenHandler(
          this.deps.googleApiKey,
          { name: tenant.name, memory: memoryContent },
          imageStore,
          {
            tenantId,
            insertGeneratedImage: async (row) => {
              await this.deps.db.insert(schema.generatedImages).values(row);
            },
          },
        ));
      }
```

- [ ] **Step 3: Add image detection in the response path**

In `packages/gateway/src/message-handler.ts`, the response is currently built at lines 638-643. We need to detect `image_url` or `image_base64` from tool results and attach it to the OutboundMessage.

Replace lines 638-643:
```typescript
      return {
        tenantId,
        channel,
        recipient: sender,
        text: responseText,
      };
```

With:
```typescript
      // Check if any tool call produced an image
      let imageMedia: OutboundMessage["media"] | undefined;
      for (const tc of result.toolCallsMade) {
        const tcResult = tc.result as Record<string, unknown> | undefined;
        if (tcResult?.image_url) {
          imageMedia = {
            type: "image",
            url: tcResult.image_url as string,
            mimeType: (tcResult.mime_type as string) || "image/png",
          };
          break;
        }
        if (tcResult?.image_base64 && !tcResult?.image_url) {
          // Fallback: base64 without S3 URL — encode as data URI
          imageMedia = {
            type: "image",
            url: `data:${(tcResult.mime_type as string) || "image/png"};base64,${tcResult.image_base64 as string}`,
            mimeType: (tcResult.mime_type as string) || "image/png",
          };
          break;
        }
      }

      return {
        tenantId,
        channel,
        recipient: sender,
        text: responseText,
        media: imageMedia,
      };
```

Note: This requires `ToolCall` in the Brain's output to include `result`. Check `packages/agent/src/brain.ts` — if `toolCallsMade` doesn't include `result`, we need to track it. Looking at the Brain code, `toolCallsMade` is typed as `ToolCall[]` which doesn't include results. We'll need to add a separate mechanism.

**Alternative approach:** Instead of inspecting tool results in message-handler, have the ImageGenHandler store the last generated image URL on a shared object. Simpler: add an `imageUrls` array to the Brain's `ProcessOutput`.

Actually, the simplest approach: scan the Brain's text response for the S3 URL pattern. But that's fragile.

**Best approach:** Add a `media` field to `ProcessOutput` in the Brain. The Brain already inspects tool results for truncation — we can also extract image URLs there.

- [ ] **Step 4: Add media field to Brain ProcessOutput**

In `packages/agent/src/brain.ts`, modify `ProcessOutput` to include:
```typescript
export interface ProcessOutput {
  content: string;
  toolCallsMade: ToolCall[];
  usage: { promptTokens: number; completionTokens: number };
  media?: Array<{ type: "image"; url: string; mimeType: string }>;
}
```

In the Brain's tool result processing loop, after truncation, check for image data:
```typescript
// Detect image URLs in tool results
if (typeof result.result === "object" && result.result !== null) {
  const r = result.result as Record<string, unknown>;
  if (r.image_url) {
    media.push({ type: "image", url: r.image_url as string, mimeType: (r.mime_type as string) || "image/png" });
  }
}
```

Then in the message-handler response path, use `result.media`:
```typescript
      const imageMedia = result.media?.[0]
        ? { type: "image" as const, url: result.media[0].url, mimeType: result.media[0].mimeType }
        : undefined;

      return {
        tenantId,
        channel,
        recipient: sender,
        text: responseText,
        media: imageMedia,
      };
```

- [ ] **Step 5: Pass S3 config in gateway index.ts**

In `packages/gateway/src/index.ts`, in the `MessageHandler` constructor (lines 87-106), add after `googleModel`:
```typescript
    s3Config: config.s3.enabled ? {
      bucket: config.s3.bucket,
      region: config.s3.region,
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
      endpoint: config.s3.endpoint,
    } : undefined,
```

- [ ] **Step 6: Build to verify**

Run: `pnpm --filter @babji/gateway build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/message-handler.ts packages/gateway/src/config.ts packages/gateway/src/index.ts packages/agent/src/brain.ts
git commit -m "feat: wire ImageGenHandler into gateway with image media detection"
```

---

### Task 7: Add sendPhoto to Telegram adapter

**Files:**
- Modify: `packages/gateway/src/adapters/telegram.ts:77-80`
- Modify: `packages/gateway/src/index.ts:113-118`

- [ ] **Step 1: Update TelegramAdapter.sendMessage to handle media**

In `packages/gateway/src/adapters/telegram.ts`, replace the `sendMessage` method (lines 77-79):

```typescript
  async sendMessage(message: OutboundMessage): Promise<void> {
    if (message.media?.type === "image" && message.media.url) {
      try {
        if (message.media.url.startsWith("data:")) {
          // Base64 data URI — decode and send as buffer
          const base64 = message.media.url.split(",")[1];
          const buffer = Buffer.from(base64, "base64");
          const { InputFile } = await import("grammy");
          await this.bot.api.sendPhoto(
            message.recipient,
            new InputFile(buffer, "image.png"),
            { caption: message.text?.slice(0, 1024) || undefined },
          );
        } else {
          // URL — let Telegram fetch it
          await this.bot.api.sendPhoto(
            message.recipient,
            message.media.url,
            { caption: message.text?.slice(0, 1024) || undefined },
          );
        }
        return;
      } catch (err) {
        logger.error({ err }, "Failed to send photo, falling back to text");
        // Fall through to text message
      }
    }

    await this.bot.api.sendMessage(message.recipient, message.text);
  }
```

- [ ] **Step 2: Build to verify**

Run: `pnpm --filter @babji/gateway build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/adapters/telegram.ts
git commit -m "feat: add sendPhoto support to Telegram adapter"
```

---

## Chunk 4: Test S3 Connection + Deploy

### Task 8: Test S3 connectivity

- [ ] **Step 1: Write a quick S3 connectivity test script**

Run locally:
```bash
node -e "
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const client = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: '30H3GDLQT4839YHNEJX5',
    secretAccessKey: 'ysZ8nhDg8ibC8gypfeqwCMchiau6JyiBhcikmc2k',
  },
  endpoint: 'https://del1.vultrobjects.com',
  forcePathStyle: true,
});
const testKey = 'test/connectivity-check.txt';
client.send(new PutObjectCommand({
  Bucket: 'tal',
  Key: testKey,
  Body: 'Babji S3 connectivity test ' + new Date().toISOString(),
  ContentType: 'text/plain',
  ACL: 'public-read',
}))
.then(() => {
  console.log('S3 upload OK: https://del1.vultrobjects.com/tal/' + testKey);
  return client.send(new DeleteObjectCommand({ Bucket: 'tal', Key: testKey }));
})
.then(() => console.log('S3 cleanup OK'))
.catch(e => console.error('S3 FAILED:', e.message));
"
```

Expected: "S3 upload OK" followed by "S3 cleanup OK".

- [ ] **Step 2: Push S3 env vars to production server**

```bash
ssh root@65.20.76.199 'grep -q S3_BUCKET /opt/babji/.env || cat >> /opt/babji/.env << EOF

# S3-compatible storage (Vultr Object Storage)
AWS_ACCESS_KEY_ID=30H3GDLQT4839YHNEJX5
AWS_SECRET_ACCESS_KEY=ysZ8nhDg8ibC8gypfeqwCMchiau6JyiBhcikmc2k
S3_BUCKET=tal
AWS_S3_ENDPOINT=https://del1.vultrobjects.com
AWS_REGION=us-east-1
EOF'
```

---

### Task 9: Build, deploy, and verify

- [ ] **Step 1: Build all changed packages**

```bash
pnpm --filter @babji/skills build && pnpm --filter @babji/agent build && pnpm --filter @babji/gateway build
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @babji/gateway test
```
Expected: All tests pass.

- [ ] **Step 3: Sync to server**

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/
```

- [ ] **Step 4: Install deps on server (new @aws-sdk/client-s3)**

```bash
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'
```

- [ ] **Step 5: Restart gateway**

```bash
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'
```

- [ ] **Step 6: Verify health and logs**

```bash
ssh root@65.20.76.199 'sleep 2 && curl -s http://localhost:3000/health'
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 logs babji-gateway --lines 10 --nostream'
```
Expected: Health check returns OK, logs show "Babji Gateway running" with image_gen in loaded skills.

- [ ] **Step 7: End-to-end test via Telegram**

Send to Babji on Telegram: "generate an image of a sunset over mountains"
Expected:
1. Babji calls `enhance_prompt` and shows an enhanced prompt
2. Reply "looks good"
3. Babji calls `generate_image` and sends a photo in the chat
4. Image appears in S3 bucket under `tenants/{id}/images/`
5. Row appears in `generated_images` table

- [ ] **Step 8: Final commit with CHANGELOG update**

```bash
git add CHANGELOG.md
git commit -m "feat: image generation skill with metaprompting and S3 storage (BAB-12)"
```
