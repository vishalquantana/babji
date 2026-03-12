# LinkedIn Posting Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up and upgrade the existing LinkedIn skill so tenants can create posts (text, images, articles), list their posts, and view engagement metrics via Telegram.

**Architecture:** Rewrite the existing `LinkedInHandler` to use LinkedIn's current Posts API (`/rest/posts`) instead of the deprecated UGC API. Add LinkedIn to the gateway's PROVIDER_CONFIGS and handler registration loop. Add LinkedIn token refresh support. Register the skill definition in the registry.

**Tech Stack:** Node.js `fetch` (no SDK), LinkedIn Community Management API v202601, existing OAuth portal infrastructure.

---

### Task 1: Add LinkedIn to token-refresh.ts

**Files:**
- Modify: `packages/gateway/src/token-refresh.ts:53-59`

**Step 1: Update the provider detection logic**

Currently `token-refresh.ts` lines 53-59 have a binary check: Atlassian or Google. Add LinkedIn as a third case.

```typescript
// Replace lines 53-59 with:
const isAtlassian = provider === "jira";
const isLinkedIn = provider === "linkedin";

let clientId: string | undefined;
let clientSecret: string | undefined;
let tokenUrl: string;

if (isAtlassian) {
  clientId = process.env.ATLASSIAN_CLIENT_ID;
  clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
  tokenUrl = "https://auth.atlassian.com/oauth/token";
} else if (isLinkedIn) {
  clientId = process.env.LINKEDIN_CLIENT_ID;
  clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  tokenUrl = "https://www.linkedin.com/oauth/v2/accessToken";
} else {
  clientId = process.env.GOOGLE_CLIENT_ID;
  clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  tokenUrl = "https://oauth2.googleapis.com/token";
}
```

**Step 2: Verify no test breaks**

Run: `pnpm --filter @babji/gateway test`
Expected: All tests pass (existing tests don't cover token refresh directly but verify no import breakage).

**Step 3: Commit**

```bash
git add packages/gateway/src/token-refresh.ts
git commit -m "feat(linkedin): add LinkedIn token refresh support"
```

---

### Task 2: Add LinkedIn to PROVIDER_CONFIGS and handler registration

**Files:**
- Modify: `packages/gateway/src/message-handler.ts:9` (import)
- Modify: `packages/gateway/src/message-handler.ts:1019-1067` (PROVIDER_CONFIGS)
- Modify: `packages/gateway/src/message-handler.ts:379-411` (handler registration)
- Modify: `packages/gateway/src/message-handler.ts:93-117` (MessageHandlerDeps interface)
- Modify: `packages/gateway/src/index.ts:112-113` (deps instantiation)

**Step 1: Add LinkedInHandler import**

In `message-handler.ts` line 9, add `LinkedInHandler` to the import:

```typescript
import { GmailHandler, GoogleCalendarHandler, GoogleAdsHandler, GoogleAnalyticsHandler, JiraHandler, PeopleHandler, TodosHandler, GeneralResearchHandler, ImageGenHandler, ImageStore, LinkedInHandler } from "@babji/skills";
```

**Step 2: Add `linkedinClientId` to MessageHandlerDeps**

Add after `atlassianClientId` (line 106):

```typescript
linkedinClientId: string;
```

**Step 3: Add LinkedIn to PROVIDER_CONFIGS**

Add after the `jira` entry (after line 1066):

```typescript
linkedin: {
  displayName: "LinkedIn",
  scopes: ["openid", "profile", "w_member_social"],
  authUrl: "https://www.linkedin.com/oauth/v2/authorization",
},
```

**Step 4: Update generateConnectLink to use the right client ID**

In `generateConnectLink` (around line 1088-1102), update the client ID selection:

```typescript
const isAtlassian = provider === "jira";
const isLinkedIn = provider === "linkedin";
const clientId = isAtlassian
  ? this.deps.atlassianClientId
  : isLinkedIn
    ? this.deps.linkedinClientId
    : this.deps.googleClientId;
```

Also, LinkedIn does NOT use `access_type=offline` — it uses `scope` to request refresh tokens. Update the `else` block:

```typescript
if (isAtlassian) {
  params.set("audience", "api.atlassian.com");
} else if (!isLinkedIn) {
  params.set("access_type", "offline");
}
```

**Step 5: Register LinkedIn handler in the connection loop**

After the Jira block (after line 410), add:

```typescript
if (conn.provider === "linkedin") {
  toolExecutor.registerSkill("linkedin", new LinkedInHandler(accessToken));
}
```

**Step 6: Wire up linkedinClientId in index.ts**

In `packages/gateway/src/index.ts`, add to the MessageHandler constructor (after `atlassianClientId`):

```typescript
linkedinClientId: process.env.LINKEDIN_CLIENT_ID || "",
```

**Step 7: Run tests**

Run: `pnpm --filter @babji/gateway test`
Expected: All tests pass.

**Step 8: Commit**

```bash
git add packages/gateway/src/message-handler.ts packages/gateway/src/index.ts
git commit -m "feat(linkedin): wire up LinkedIn OAuth and handler registration"
```

---

### Task 3: Add LinkedIn skill definition to registry

**Files:**
- Modify: `packages/skills/src/registry.ts:1296` (allSkills array)
- Modify: `packages/skills/src/registry.ts:781` (connect_service description)

**Step 1: Add the linkedinSkill definition**

Add before the `allSkills` array (before line 1296):

```typescript
const linkedinSkill: SkillDefinition = {
  name: "linkedin",
  displayName: "LinkedIn",
  description: "Create posts, share articles, and view engagement on LinkedIn.",
  requiresAuth: {
    provider: "linkedin",
    scopes: ["openid", "profile", "w_member_social"],
  },
  actions: [
    {
      name: "create_post",
      description: "Create a LinkedIn post. Supports text, image, or article/link sharing.",
      parameters: {
        text: {
          type: "string",
          required: true,
          description: "The post text/commentary",
        },
        image_url: {
          type: "string",
          required: false,
          description: "URL of an image to attach. The image will be uploaded to LinkedIn.",
        },
        article_url: {
          type: "string",
          required: false,
          description: "URL of an article/link to share",
        },
        article_title: {
          type: "string",
          required: false,
          description: "Title for the shared article (optional, used with article_url)",
        },
        visibility: {
          type: "string",
          required: false,
          description: "Post visibility: 'PUBLIC' (default) or 'CONNECTIONS'",
        },
      },
    },
    {
      name: "list_posts",
      description: "List the user's recent LinkedIn posts.",
      parameters: {
        count: {
          type: "number",
          required: false,
          description: "Number of posts to return (1-50, default 10)",
        },
      },
    },
    {
      name: "get_post",
      description: "Get a single LinkedIn post with engagement metrics.",
      parameters: {
        post_id: {
          type: "string",
          required: true,
          description: "The LinkedIn post URN (from list_posts)",
        },
      },
    },
    {
      name: "get_profile",
      description: "Get the authenticated user's LinkedIn profile.",
      parameters: {},
    },
    {
      name: "get_post_analytics",
      description: "Get engagement metrics (likes, comments, shares) for recent posts.",
      parameters: {
        count: {
          type: "number",
          required: false,
          description: "Number of recent posts to get analytics for (1-10, default 5)",
        },
      },
    },
  ],
  creditsPerAction: 1,
};
```

**Step 2: Add to allSkills array**

Update line 1296:

```typescript
const allSkills: SkillDefinition[] = [gmailSkill, calendarSkill, googleAdsSkill, googleAnalyticsSkill, jiraSkill, checkWithTeacherSkill, peopleSkill, generalResearchSkill, imageGenSkill, linkedinSkill];
```

**Step 3: Update connect_service description**

On line 781, update the service_name description to include linkedin:

```typescript
description: "The service to connect. One of: gmail, google_calendar, google_ads, google_analytics, jira, linkedin",
```

**Step 4: Build skills package**

Run: `pnpm --filter @babji/skills build`
Expected: Clean build, no errors.

**Step 5: Run gateway tests**

Run: `pnpm --filter @babji/gateway test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add packages/skills/src/registry.ts
git commit -m "feat(linkedin): add LinkedIn skill definition to registry"
```

---

### Task 4: Rewrite LinkedInHandler with Posts API

**Files:**
- Rewrite: `packages/skills/src/linkedin/handler.ts`

**Step 1: Rewrite the handler**

Replace the entire contents of `packages/skills/src/linkedin/handler.ts` with:

```typescript
import type { SkillHandler } from "@babji/agent";

const LINKEDIN_API_BASE = "https://api.linkedin.com";

export class LinkedInHandler implements SkillHandler {
  private accessToken: string;
  private personUrn: string | null = null;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "get_profile":
        return this.getProfile();
      case "create_post":
        return this.createPost(params);
      case "list_posts":
        return this.listPosts(params);
      case "get_post":
        return this.getPost(params);
      case "get_post_analytics":
        return this.getPostAnalytics(params);
      default:
        throw new Error(`Unknown LinkedIn action: ${actionName}`);
    }
  }

  // ── Helpers ──────────────────────────────────────────────

  private requireParam(params: Record<string, unknown>, name: string, action: string): void {
    if (params[name] === undefined || params[name] === null || params[name] === "") {
      throw new Error(`Missing required parameter: ${name} for ${action}`);
    }
  }

  private wrapApiError(action: string, err: unknown): never {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`LinkedIn ${action} failed: ${message}`);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": "202601",
      ...extra,
    };
  }

  private async apiGet(path: string): Promise<unknown> {
    const res = await fetch(`${LINKEDIN_API_BASE}${path}`, {
      headers: this.headers(),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg: string;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed.message || parsed.error_description || `HTTP ${res.status}`;
      } catch {
        errorMsg = `HTTP ${res.status}`;
      }
      throw new Error(errorMsg);
    }

    return res.json();
  }

  private async apiPost(path: string, body: unknown): Promise<{ json: unknown; headers: Headers }> {
    const res = await fetch(`${LINKEDIN_API_BASE}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg: string;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed.message || parsed.error_description || `HTTP ${res.status}`;
      } catch {
        errorMsg = `HTTP ${res.status}`;
      }
      throw new Error(errorMsg);
    }

    const text = await res.text();
    return { json: text ? JSON.parse(text) : {}, headers: res.headers };
  }

  private async getPersonUrn(): Promise<string> {
    if (this.personUrn) return this.personUrn;
    const data = await this.apiGet("/v2/userinfo") as { sub?: string };
    if (!data.sub) throw new Error("Could not determine LinkedIn user ID");
    this.personUrn = `urn:li:person:${data.sub}`;
    return this.personUrn;
  }

  // ── Actions ──────────────────────────────────────────────

  private async getProfile() {
    try {
      const data = await this.apiGet("/v2/userinfo") as {
        sub?: string;
        name?: string;
        given_name?: string;
        family_name?: string;
        email?: string;
        picture?: string;
      };

      return {
        id: data.sub,
        name: data.name,
        firstName: data.given_name,
        lastName: data.family_name,
        email: data.email,
        pictureUrl: data.picture,
      };
    } catch (err) {
      this.wrapApiError("get_profile", err);
    }
  }

  private async createPost(params: Record<string, unknown>) {
    this.requireParam(params, "text", "create_post");

    const text = params.text as string;
    const imageUrl = params.image_url as string | undefined;
    const articleUrl = params.article_url as string | undefined;
    const articleTitle = params.article_title as string | undefined;
    const visibility = ((params.visibility as string) || "PUBLIC").toUpperCase();

    if (!["PUBLIC", "CONNECTIONS"].includes(visibility)) {
      throw new Error(`Invalid visibility: ${visibility}. Must be PUBLIC or CONNECTIONS.`);
    }

    try {
      const author = await this.getPersonUrn();

      const postBody: Record<string, unknown> = {
        author,
        commentary: text,
        visibility,
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      };

      // Image post: upload first, then attach
      if (imageUrl) {
        const imageUrn = await this.uploadImage(author, imageUrl);
        postBody.content = {
          media: { title: "Image", id: imageUrn },
        };
      }
      // Article/link post
      else if (articleUrl) {
        postBody.content = {
          article: {
            source: articleUrl,
            ...(articleTitle ? { title: articleTitle } : {}),
          },
        };
      }

      const { headers } = await this.apiPost("/rest/posts", postBody);

      // Posts API returns the post URN in the x-restli-id header
      const postUrn = headers.get("x-restli-id") || headers.get("x-linkedin-id");

      return {
        created: true,
        postUrn,
        visibility,
        hasImage: !!imageUrl,
        hasArticle: !!articleUrl,
      };
    } catch (err) {
      this.wrapApiError("create_post", err);
    }
  }

  private async uploadImage(ownerUrn: string, sourceUrl: string): Promise<string> {
    // Step 1: Initialize upload
    const initRes = await this.apiPost("/rest/images?action=initializeUpload", {
      initializeUploadRequest: { owner: ownerUrn },
    });

    const initData = initRes.json as {
      value?: {
        uploadUrl?: string;
        image?: string;
      };
    };

    const uploadUrl = initData.value?.uploadUrl;
    const imageUrn = initData.value?.image;

    if (!uploadUrl || !imageUrn) {
      throw new Error("Failed to initialize LinkedIn image upload");
    }

    // Step 2: Fetch the image from the source URL
    const imageRes = await fetch(sourceUrl);
    if (!imageRes.ok) {
      throw new Error(`Failed to fetch image from ${sourceUrl}: HTTP ${imageRes.status}`);
    }
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

    // Step 3: Upload binary to LinkedIn
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: imageBuffer,
    });

    if (!putRes.ok) {
      throw new Error(`Failed to upload image to LinkedIn: HTTP ${putRes.status}`);
    }

    return imageUrn;
  }

  private async listPosts(params: Record<string, unknown>) {
    const count = Math.min(Math.max((params.count as number) || 10, 1), 50);

    try {
      const author = await this.getPersonUrn();
      const encodedAuthor = encodeURIComponent(author);

      const data = await this.apiGet(
        `/rest/posts?q=author&author=${encodedAuthor}&count=${count}&sortBy=LAST_MODIFIED`
      ) as { elements?: Array<Record<string, unknown>> };

      const posts = (data.elements || []).map((post) => ({
        postUrn: post.id,
        text: (post.commentary as string)?.substring(0, 200),
        visibility: post.visibility,
        createdAt: post.createdAt
          ? new Date(post.createdAt as number).toISOString()
          : undefined,
        hasMedia: !!post.content,
        lifecycleState: post.lifecycleState,
      }));

      return { posts, count: posts.length };
    } catch (err) {
      this.wrapApiError("list_posts", err);
    }
  }

  private async getPost(params: Record<string, unknown>) {
    this.requireParam(params, "post_id", "get_post");
    const postId = params.post_id as string;

    try {
      const encodedUrn = encodeURIComponent(postId);
      const data = await this.apiGet(`/rest/posts/${encodedUrn}`) as Record<string, unknown>;

      return {
        postUrn: data.id,
        text: data.commentary,
        visibility: data.visibility,
        createdAt: data.createdAt
          ? new Date(data.createdAt as number).toISOString()
          : undefined,
        lifecycleState: data.lifecycleState,
        content: data.content,
      };
    } catch (err) {
      this.wrapApiError("get_post", err);
    }
  }

  private async getPostAnalytics(params: Record<string, unknown>) {
    const count = Math.min(Math.max((params.count as number) || 5, 1), 10);

    try {
      const author = await this.getPersonUrn();
      const encodedAuthor = encodeURIComponent(author);

      // Fetch recent posts
      const data = await this.apiGet(
        `/rest/posts?q=author&author=${encodedAuthor}&count=${count}&sortBy=LAST_MODIFIED`
      ) as { elements?: Array<Record<string, unknown>> };

      // For each post, try to get social action counts
      const analytics = await Promise.all(
        (data.elements || []).map(async (post) => {
          const postUrn = post.id as string;
          const encodedPostUrn = encodeURIComponent(postUrn);

          let likes = 0;
          let comments = 0;

          try {
            const socialCounts = await this.apiGet(
              `/rest/socialActions/${encodedPostUrn}`
            ) as Record<string, unknown>;
            likes = (socialCounts.likesSummary as Record<string, unknown>)?.totalLikes as number || 0;
            comments = (socialCounts.commentsSummary as Record<string, unknown>)?.totalFirstLevelComments as number || 0;
          } catch {
            // Social actions endpoint may not be available for all posts
          }

          return {
            postUrn,
            text: (post.commentary as string)?.substring(0, 100),
            createdAt: post.createdAt
              ? new Date(post.createdAt as number).toISOString()
              : undefined,
            likes,
            comments,
          };
        })
      );

      return { analytics, count: analytics.length };
    } catch (err) {
      this.wrapApiError("get_post_analytics", err);
    }
  }
}
```

**Step 2: Build skills package**

Run: `pnpm --filter @babji/skills build`
Expected: Clean build, no errors.

**Step 3: Build gateway**

Run: `pnpm --filter @babji/gateway build`
Expected: Clean build.

**Step 4: Run tests**

Run: `pnpm --filter @babji/gateway test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add packages/skills/src/linkedin/handler.ts
git commit -m "feat(linkedin): rewrite handler with Posts API, image upload, and analytics"
```

---

### Task 5: Build, verify, and deploy

**Files:**
- No new files. Verification and deploy only.

**Step 1: Full build**

Run: `pnpm --filter @babji/skills build && pnpm --filter @babji/gateway build`
Expected: Both build cleanly.

**Step 2: Run all tests**

Run: `pnpm --filter @babji/gateway test`
Expected: All tests pass.

**Step 3: Sync to server**

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data --exclude .worktrees \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/
```

**Step 4: Install deps and rebuild on server**

```bash
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile && pnpm --filter @babji/skills build && pnpm --filter @babji/gateway build'
```

**Step 5: Restart gateway**

```bash
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'
```

**Step 6: Verify health**

```bash
ssh root@65.20.76.199 'sleep 2 && curl -s http://localhost:3000/health'
```

**Step 7: Commit plan doc**

```bash
git add docs/plans/2026-03-12-linkedin-posting-plan.md
git commit -m "docs: add LinkedIn posting skill implementation plan"
```

---

### Post-Deploy: Manual Steps (not automatable)

1. **Create LinkedIn App** at [developer.linkedin.com](https://developer.linkedin.com):
   - Add "Share on LinkedIn" product
   - Add "Sign In with LinkedIn using OpenID Connect" product
   - Note the Client ID and Client Secret

2. **Add env vars to production**:
   ```bash
   ssh root@65.20.76.199 'echo "LINKEDIN_CLIENT_ID=<your-id>" >> /opt/babji/.env && echo "LINKEDIN_CLIENT_SECRET=<your-secret>" >> /opt/babji/.env'
   ```

3. **Restart gateway** after adding env vars:
   ```bash
   ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'
   ```

4. **Test via Telegram**: Send "connect linkedin" to Babji, complete OAuth, then try "post on linkedin: Hello from Babji!"
