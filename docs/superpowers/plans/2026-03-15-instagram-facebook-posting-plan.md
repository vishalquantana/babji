# Instagram & Facebook Posting Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire existing Instagram and Facebook handlers into the Brain with scheduling support, so users can post and schedule content conversationally.

**Architecture:** Add skill definitions to registry, extend handlers with scheduling deps (same pattern as LinkedIn), register skills when Meta OAuth token exists, add two new job types to JobRunner for scheduled publishing.

**Tech Stack:** TypeScript, Meta Graph API v21.0, Drizzle ORM (scheduled_jobs table), existing InstagramHandler + FacebookPagesHandler

**Spec:** `docs/superpowers/specs/2026-03-15-instagram-facebook-posting-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/skills/src/instagram/handler.ts` | Modify | Add `InstagramDeps` interface, scheduling methods, extend constructor |
| `packages/skills/src/instagram/index.ts` | Modify | Re-export new types |
| `packages/skills/src/facebook-pages/handler.ts` | Modify | Add `FacebookPagesDeps` interface, scheduling methods, extend constructor |
| `packages/skills/src/facebook-pages/index.ts` | Modify | Re-export new types |
| `packages/skills/src/index.ts` | Modify | Re-export new types |
| `packages/skills/src/registry.ts` | Modify | Add `instagramSkill` and `facebookPagesSkill` definitions |
| `packages/gateway/src/message-handler.ts` | Modify | Register instagram + facebook_pages skills when `meta` connection exists |
| `packages/gateway/src/job-runner.ts` | Modify | Add `scheduled_instagram_post` and `scheduled_facebook_post` job types |
| `packages/gateway/src/server.ts` | Modify | Add `meta` to post-connect providerMeta |

---

## Task 1: Extend Instagram Handler with Scheduling Deps

**Files:**
- Modify: `packages/skills/src/instagram/handler.ts`
- Modify: `packages/skills/src/instagram/index.ts`

- [ ] **Step 1: Add InstagramDeps interface and update constructor**

In `packages/skills/src/instagram/handler.ts`, add before the class:

```typescript
export interface ScheduledInstagramPayload {
  ig_user_id: string;
  image_url: string;
  caption?: string;
}

export interface ScheduledInstagramInfo {
  jobId: string;
  scheduledAt: string;
  caption: string;
  hasImage: boolean;
}

export interface InstagramDeps {
  schedulePost?: (scheduledAt: Date, payload: ScheduledInstagramPayload) => Promise<string>;
  listScheduledPosts?: () => Promise<ScheduledInstagramInfo[]>;
  cancelScheduledPost?: (jobId: string) => Promise<boolean>;
}
```

Update constructor to accept optional deps:

```typescript
private deps: InstagramDeps;

constructor(accessToken: string, deps?: InstagramDeps) {
  this.accessToken = accessToken;
  this.deps = deps || {};
}
```

- [ ] **Step 2: Add scheduling cases to execute switch**

Add to the switch in `execute()`:

```typescript
case "schedule_post":
  this.requireParam(params, "ig_user_id", actionName);
  this.requireParam(params, "image_url", actionName);
  this.requireParam(params, "scheduled_time", actionName);
  return this.schedulePost(params);
case "list_scheduled_posts":
  return this.listScheduledPosts();
case "cancel_scheduled_post":
  this.requireParam(params, "job_id", actionName);
  return this.cancelScheduledPost(params);
```

- [ ] **Step 3: Add scheduling methods at end of class**

```typescript
private async schedulePost(params: Record<string, unknown>) {
  if (!this.deps.schedulePost) {
    throw new Error("Scheduling is not available. Please post directly using create_post.");
  }

  const scheduledTime = new Date(params.scheduled_time as string);
  if (isNaN(scheduledTime.getTime())) {
    throw new Error("Invalid scheduled_time. Use ISO 8601 format.");
  }
  if (scheduledTime <= new Date()) {
    throw new Error("Scheduled time must be in the future. Use create_post for immediate posting.");
  }

  const payload: ScheduledInstagramPayload = {
    ig_user_id: params.ig_user_id as string,
    image_url: params.image_url as string,
    caption: params.caption as string | undefined,
  };

  const jobId = await this.deps.schedulePost(scheduledTime, payload);
  const caption = payload.caption || "";

  return {
    scheduled: true,
    jobId,
    scheduledAt: scheduledTime.toISOString(),
    caption: caption.substring(0, 100) + (caption.length > 100 ? "..." : ""),
    hint: `Your Instagram post is scheduled for ${scheduledTime.toISOString()}. It will be published automatically.`,
  };
}

private async listScheduledPosts() {
  if (!this.deps.listScheduledPosts) {
    throw new Error("Scheduling is not available.");
  }
  const posts = await this.deps.listScheduledPosts();
  return {
    scheduled_posts: posts,
    count: posts.length,
    hint: posts.length === 0
      ? "No scheduled Instagram posts."
      : "Use cancel_scheduled_post with the job ID to cancel.",
  };
}

private async cancelScheduledPost(params: Record<string, unknown>) {
  if (!this.deps.cancelScheduledPost) {
    throw new Error("Scheduling is not available.");
  }
  const jobId = params.job_id as string;
  const cancelled = await this.deps.cancelScheduledPost(jobId);
  if (!cancelled) {
    throw new Error("Scheduled post not found or already published.");
  }
  return { cancelled: true, jobId };
}
```

- [ ] **Step 4: Update index.ts exports**

In `packages/skills/src/instagram/index.ts`:

```typescript
export { InstagramHandler } from "./handler.js";
export type { InstagramDeps, ScheduledInstagramPayload, ScheduledInstagramInfo } from "./handler.js";
```

- [ ] **Step 5: Build and verify**

Run: `pnpm --filter @babji/skills build`

---

## Task 2: Extend Facebook Pages Handler with Scheduling Deps

**Files:**
- Modify: `packages/skills/src/facebook-pages/handler.ts`
- Modify: `packages/skills/src/facebook-pages/index.ts`

Same pattern as Task 1.

- [ ] **Step 1: Add FacebookPagesDeps interface and update constructor**

In `packages/skills/src/facebook-pages/handler.ts`, add before the class:

```typescript
export interface ScheduledFacebookPayload {
  page_id: string;
  message: string;
  link?: string;
}

export interface ScheduledFacebookInfo {
  jobId: string;
  scheduledAt: string;
  message: string;
  hasLink: boolean;
}

export interface FacebookPagesDeps {
  schedulePost?: (scheduledAt: Date, payload: ScheduledFacebookPayload) => Promise<string>;
  listScheduledPosts?: () => Promise<ScheduledFacebookInfo[]>;
  cancelScheduledPost?: (jobId: string) => Promise<boolean>;
}
```

Update constructor:

```typescript
private deps: FacebookPagesDeps;

constructor(accessToken: string, deps?: FacebookPagesDeps) {
  this.accessToken = accessToken;
  this.deps = deps || {};
}
```

- [ ] **Step 2: Add scheduling cases to execute switch**

```typescript
case "schedule_post":
  this.requireParam(params, "page_id", actionName);
  this.requireParam(params, "message", actionName);
  this.requireParam(params, "scheduled_time", actionName);
  return this.schedulePost(params);
case "list_scheduled_posts":
  return this.listScheduledPosts();
case "cancel_scheduled_post":
  this.requireParam(params, "job_id", actionName);
  return this.cancelScheduledPost(params);
```

- [ ] **Step 3: Add scheduling methods** (same pattern as Instagram, adapted for FB fields: `page_id`, `message`, `link`)

- [ ] **Step 4: Update index.ts exports**

```typescript
export { FacebookPagesHandler } from "./handler.js";
export type { FacebookPagesDeps, ScheduledFacebookPayload, ScheduledFacebookInfo } from "./handler.js";
```

- [ ] **Step 5: Update skills package index** (`packages/skills/src/index.ts`)

Add re-exports:

```typescript
export type { InstagramDeps, ScheduledInstagramPayload, ScheduledInstagramInfo } from "./instagram/index.js";
export type { FacebookPagesDeps, ScheduledFacebookPayload, ScheduledFacebookInfo } from "./facebook-pages/index.js";
```

- [ ] **Step 6: Build and verify**

Run: `pnpm --filter @babji/skills build`

---

## Task 3: Add Skill Definitions to Registry

**Files:**
- Modify: `packages/skills/src/registry.ts`

- [ ] **Step 1: Add instagramSkill definition**

Add before `const allSkills`:

```typescript
const instagramSkill: SkillDefinition = {
  name: "instagram",
  displayName: "Instagram",
  description: "Post photos and view your Instagram Business account. Requires a connected Facebook/Instagram account.",
  requiresAuth: {
    provider: "meta",
    scopes: ["instagram_basic", "instagram_content_publish"],
  },
  actions: [
    {
      name: "get_profile",
      description: "Get the user's Instagram Business profile info.",
      parameters: {
        ig_user_id: {
          type: "string",
          required: true,
          description: "The Instagram Business user ID (from service connection metadata)",
        },
      },
    },
    {
      name: "list_posts",
      description: "List recent Instagram posts with engagement metrics.",
      parameters: {
        ig_user_id: {
          type: "string",
          required: true,
          description: "The Instagram Business user ID",
        },
        max_results: {
          type: "number",
          required: false,
          description: "Number of posts to return (1-50, default 10)",
        },
      },
    },
    {
      name: "create_post",
      description: "Create an Instagram post. REQUIRES an image URL — Instagram does not support text-only posts. Use the image_gen skill first if you need to generate an image.",
      parameters: {
        ig_user_id: {
          type: "string",
          required: true,
          description: "The Instagram Business user ID",
        },
        image_url: {
          type: "string",
          required: true,
          description: "Public URL of the image to post (must be JPEG or PNG, accessible via HTTP)",
        },
        caption: {
          type: "string",
          required: false,
          description: "Post caption with optional hashtags",
        },
      },
    },
    {
      name: "schedule_post",
      description: "Schedule an Instagram post for future publication. REQUIRES an image URL.",
      parameters: {
        ig_user_id: {
          type: "string",
          required: true,
          description: "The Instagram Business user ID",
        },
        image_url: {
          type: "string",
          required: true,
          description: "Public URL of the image to post",
        },
        caption: {
          type: "string",
          required: false,
          description: "Post caption with optional hashtags",
        },
        scheduled_time: {
          type: "string",
          required: true,
          description: "ISO 8601 datetime for when to publish",
        },
      },
    },
    {
      name: "list_scheduled_posts",
      description: "List all pending scheduled Instagram posts.",
      parameters: {},
    },
    {
      name: "cancel_scheduled_post",
      description: "Cancel a scheduled Instagram post.",
      parameters: {
        job_id: {
          type: "string",
          required: true,
          description: "The scheduled post job ID",
        },
      },
    },
  ],
  creditsPerAction: 1,
};
```

- [ ] **Step 2: Add facebookPagesSkill definition**

```typescript
const facebookPagesSkill: SkillDefinition = {
  name: "facebook_pages",
  displayName: "Facebook Pages",
  description: "Post to Facebook Pages and view page insights. Requires a connected Facebook account with page management permissions.",
  requiresAuth: {
    provider: "meta",
    scopes: ["pages_manage_posts"],
  },
  actions: [
    {
      name: "list_pages",
      description: "List Facebook Pages the user manages.",
      parameters: {
        max_results: {
          type: "number",
          required: false,
          description: "Number of pages to return (1-50, default 10)",
        },
      },
    },
    {
      name: "create_post",
      description: "Create a post on a Facebook Page.",
      parameters: {
        page_id: {
          type: "string",
          required: true,
          description: "The Facebook Page ID (from list_pages)",
        },
        message: {
          type: "string",
          required: true,
          description: "The post text",
        },
        link: {
          type: "string",
          required: false,
          description: "Optional URL to share with the post",
        },
      },
    },
    {
      name: "get_insights",
      description: "Get analytics/insights for a Facebook Page.",
      parameters: {
        page_id: {
          type: "string",
          required: true,
          description: "The Facebook Page ID",
        },
        period: {
          type: "string",
          required: false,
          description: "Aggregation period: 'day', 'week', or 'days_28' (default: 'day')",
        },
      },
    },
    {
      name: "schedule_post",
      description: "Schedule a Facebook Page post for future publication.",
      parameters: {
        page_id: {
          type: "string",
          required: true,
          description: "The Facebook Page ID",
        },
        message: {
          type: "string",
          required: true,
          description: "The post text",
        },
        link: {
          type: "string",
          required: false,
          description: "Optional URL to share",
        },
        scheduled_time: {
          type: "string",
          required: true,
          description: "ISO 8601 datetime for when to publish",
        },
      },
    },
    {
      name: "list_scheduled_posts",
      description: "List all pending scheduled Facebook Page posts.",
      parameters: {},
    },
    {
      name: "cancel_scheduled_post",
      description: "Cancel a scheduled Facebook Page post.",
      parameters: {
        job_id: {
          type: "string",
          required: true,
          description: "The scheduled post job ID",
        },
      },
    },
  ],
  creditsPerAction: 1,
};
```

- [ ] **Step 3: Add to allSkills array**

Change:
```typescript
const allSkills: SkillDefinition[] = [gmailSkill, calendarSkill, googleAdsSkill, googleAnalyticsSkill, jiraSkill, checkWithTeacherSkill, peopleSkill, generalResearchSkill, imageGenSkill, linkedinSkill, googleDocsSkill];
```
To:
```typescript
const allSkills: SkillDefinition[] = [gmailSkill, calendarSkill, googleAdsSkill, googleAnalyticsSkill, jiraSkill, checkWithTeacherSkill, peopleSkill, generalResearchSkill, imageGenSkill, linkedinSkill, instagramSkill, facebookPagesSkill, googleDocsSkill];
```

- [ ] **Step 4: Build and verify**

Run: `pnpm --filter @babji/skills build`

---

## Task 4: Register Skills in Message Handler

**Files:**
- Modify: `packages/gateway/src/message-handler.ts`

- [ ] **Step 1: Add Instagram + Facebook registration when meta connection exists**

After the existing `if (conn.provider === "linkedin")` block (around line 449), add:

```typescript
if (conn.provider === "meta") {
  // Register Instagram skill
  toolExecutor.registerSkill("instagram", new InstagramHandler(accessToken, {
    schedulePost: async (scheduledAt, payload) => {
      const [row] = await this.deps.db.insert(schema.scheduledJobs).values({
        tenantId,
        jobType: "scheduled_instagram_post",
        scheduleType: "once",
        scheduledAt,
        payload: payload as unknown as Record<string, unknown>,
        status: "active",
      }).returning({ id: schema.scheduledJobs.id });
      return row.id;
    },
    listScheduledPosts: async () => {
      const jobs = await this.deps.db.query.scheduledJobs.findMany({
        where: and(
          eq(schema.scheduledJobs.tenantId, tenantId),
          eq(schema.scheduledJobs.jobType, "scheduled_instagram_post"),
          eq(schema.scheduledJobs.status, "active"),
        ),
      });
      return jobs.map((j) => {
        const p = (j.payload || {}) as Record<string, string | undefined>;
        return {
          jobId: j.id,
          scheduledAt: j.scheduledAt.toISOString(),
          caption: (p.caption || "").substring(0, 100),
          hasImage: !!p.image_url,
        };
      });
    },
    cancelScheduledPost: async (jobId) => {
      const job = await this.deps.db.query.scheduledJobs.findFirst({
        where: and(
          eq(schema.scheduledJobs.id, jobId),
          eq(schema.scheduledJobs.tenantId, tenantId),
          eq(schema.scheduledJobs.jobType, "scheduled_instagram_post"),
          eq(schema.scheduledJobs.status, "active"),
        ),
      });
      if (!job) return false;
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, jobId));
      return true;
    },
  }));

  // Register Facebook Pages skill
  toolExecutor.registerSkill("facebook_pages", new FacebookPagesHandler(accessToken, {
    schedulePost: async (scheduledAt, payload) => {
      const [row] = await this.deps.db.insert(schema.scheduledJobs).values({
        tenantId,
        jobType: "scheduled_facebook_post",
        scheduleType: "once",
        scheduledAt,
        payload: payload as unknown as Record<string, unknown>,
        status: "active",
      }).returning({ id: schema.scheduledJobs.id });
      return row.id;
    },
    listScheduledPosts: async () => {
      const jobs = await this.deps.db.query.scheduledJobs.findMany({
        where: and(
          eq(schema.scheduledJobs.tenantId, tenantId),
          eq(schema.scheduledJobs.jobType, "scheduled_facebook_post"),
          eq(schema.scheduledJobs.status, "active"),
        ),
      });
      return jobs.map((j) => {
        const p = (j.payload || {}) as Record<string, string | undefined>;
        return {
          jobId: j.id,
          scheduledAt: j.scheduledAt.toISOString(),
          message: (p.message || "").substring(0, 100),
          hasLink: !!p.link,
        };
      });
    },
    cancelScheduledPost: async (jobId) => {
      const job = await this.deps.db.query.scheduledJobs.findFirst({
        where: and(
          eq(schema.scheduledJobs.id, jobId),
          eq(schema.scheduledJobs.tenantId, tenantId),
          eq(schema.scheduledJobs.jobType, "scheduled_facebook_post"),
          eq(schema.scheduledJobs.status, "active"),
        ),
      });
      if (!job) return false;
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, jobId));
      return true;
    },
  }));
}
```

- [ ] **Step 2: Ensure InstagramHandler and FacebookPagesHandler are imported**

Check the import line at the top — both should already be imported. If not, add them.

- [ ] **Step 3: Build and test**

Run: `pnpm --filter @babji/gateway build && pnpm --filter @babji/gateway test`

---

## Task 5: Add Job Types to Job Runner

**Files:**
- Modify: `packages/gateway/src/job-runner.ts`

- [ ] **Step 1: Add cases in the job type switch**

After `case "scheduled_linkedin_post"`:

```typescript
case "scheduled_instagram_post":
  await this.runScheduledInstagramPost(job);
  break;
case "scheduled_facebook_post":
  await this.runScheduledFacebookPost(job);
  break;
```

- [ ] **Step 2: Add runScheduledInstagramPost method**

Same pattern as `runScheduledLinkedInPost` — get tenant, ensure Meta token, import `InstagramHandler`, call `create_post`, notify user, mark completed.

Key differences:
- Provider is `"meta"` (not `"linkedin"`)
- Payload has `ig_user_id`, `image_url`, `caption`
- Uses `InstagramHandler` instead of `LinkedInHandler`

- [ ] **Step 3: Add runScheduledFacebookPost method**

Same pattern. Key differences:
- Provider is `"meta"`
- Payload has `page_id`, `message`, optional `link`
- Uses `FacebookPagesHandler` instead

- [ ] **Step 4: Build and test**

Run: `pnpm --filter @babji/gateway build && pnpm --filter @babji/gateway test`

---

## Task 6: Post-Connect Flow for Meta

**Files:**
- Modify: `packages/gateway/src/server.ts`

- [ ] **Step 1: Add meta to providerMeta in /api/connect-complete**

```typescript
meta: {
  displayName: "Instagram & Facebook",
  prompt: "I just connected my Instagram and Facebook accounts. Show me which Facebook Pages I manage and my Instagram profile.",
},
```

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @babji/gateway build`

---

## Task 7: Build, Test, Deploy

- [ ] **Step 1: Full build**

```bash
pnpm --filter @babji/skills build
pnpm --filter @babji/agent build
pnpm --filter @babji/gateway build
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @babji/gateway test
```

Expected: 48/48 pass

- [ ] **Step 3: Deploy to production**

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data --exclude .worktrees \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'
ssh root@65.20.76.199 'sleep 2 && curl -s http://localhost:3000/health'
```

- [ ] **Step 4: Verify health**

Expected: `{"status":"ok",...}`
