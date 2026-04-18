import type { SkillHandler } from "@babji/agent";

const LINKEDIN_API_BASE = "https://api.linkedin.com";
const DEFAULT_DAILY_POST_LIMIT = 2;

export interface ScheduledPostPayload {
  text: string;
  image_url?: string;
  article_url?: string;
  article_title?: string;
  visibility?: string;
}

export interface ScheduledPostInfo {
  jobId: string;
  scheduledAt: string;
  text: string;
  hasImage: boolean;
  hasArticle: boolean;
}

export interface LinkedInDeps {
  countTodayPosts: () => Promise<number>;
  dailyPostLimit?: number;
  schedulePost?: (scheduledAt: Date, payload: ScheduledPostPayload) => Promise<string>;
  listScheduledPosts?: () => Promise<ScheduledPostInfo[]>;
  cancelScheduledPost?: (jobId: string) => Promise<boolean>;
}

export class LinkedInHandler implements SkillHandler {
  private accessToken: string;
  private personUrn: string | null = null;
  private deps: LinkedInDeps;

  constructor(accessToken: string, deps: LinkedInDeps) {
    this.accessToken = accessToken;
    this.deps = deps;
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
      case "schedule_post":
        return this.schedulePost(params);
      case "list_scheduled_posts":
        return this.listScheduledPosts();
      case "cancel_scheduled_post":
        return this.cancelScheduledPost(params);
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

    // Check daily post limit
    const limit = this.deps.dailyPostLimit ?? DEFAULT_DAILY_POST_LIMIT;
    const todayCount = await this.deps.countTodayPosts();
    if (todayCount >= limit) {
      throw new Error(
        `You've reached your daily LinkedIn post limit (${limit} posts per day). You've already posted ${todayCount} time${todayCount === 1 ? "" : "s"} today. Try again tomorrow!`
      );
    }

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

      const postsRemaining = limit - todayCount - 1;
      return {
        created: true,
        postUrn,
        visibility,
        hasImage: !!imageUrl,
        hasArticle: !!articleUrl,
        daily_limit: limit,
        posts_remaining_today: postsRemaining,
        hint: postsRemaining === 0
          ? "This was your last LinkedIn post for today. The limit resets tomorrow."
          : `You have ${postsRemaining} LinkedIn post${postsRemaining === 1 ? "" : "s"} remaining today (limit: ${limit}/day).`,
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

  // ── Scheduling Actions ──────────────────────────────────

  private async schedulePost(params: Record<string, unknown>) {
    this.requireParam(params, "text", "schedule_post");
    this.requireParam(params, "scheduled_time", "schedule_post");

    if (!this.deps.schedulePost) {
      throw new Error("Scheduling is not available. Please post directly using create_post.");
    }

    const text = params.text as string;
    const scheduledTime = new Date(params.scheduled_time as string);

    if (isNaN(scheduledTime.getTime())) {
      throw new Error("Invalid scheduled_time. Use ISO 8601 format (e.g. '2026-03-16T09:00:00').");
    }

    if (scheduledTime <= new Date()) {
      throw new Error("Scheduled time must be in the future. Use create_post for immediate posting.");
    }

    const payload: ScheduledPostPayload = {
      text,
      image_url: params.image_url as string | undefined,
      article_url: params.article_url as string | undefined,
      article_title: params.article_title as string | undefined,
      visibility: params.visibility as string | undefined,
    };

    const jobId = await this.deps.schedulePost(scheduledTime, payload);

    return {
      scheduled: true,
      jobId,
      scheduledAt: scheduledTime.toISOString(),
      text: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
      hasImage: !!payload.image_url,
      hasArticle: !!payload.article_url,
      hint: `Your LinkedIn post is scheduled for ${scheduledTime.toISOString()}. It will be published automatically. Use list_scheduled_posts to see all scheduled posts, or cancel_scheduled_post to cancel.`,
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
        ? "No scheduled LinkedIn posts. Use schedule_post to schedule one."
        : "Use cancel_scheduled_post with the job ID to cancel any scheduled post.",
    };
  }

  private async cancelScheduledPost(params: Record<string, unknown>) {
    this.requireParam(params, "job_id", "cancel_scheduled_post");

    if (!this.deps.cancelScheduledPost) {
      throw new Error("Scheduling is not available.");
    }

    const jobId = params.job_id as string;
    const cancelled = await this.deps.cancelScheduledPost(jobId);

    if (!cancelled) {
      throw new Error("Scheduled post not found or already published.");
    }

    return {
      cancelled: true,
      jobId,
      hint: "The scheduled LinkedIn post has been cancelled.",
    };
  }
}
