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
