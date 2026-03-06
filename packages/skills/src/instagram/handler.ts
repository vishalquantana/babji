import type { SkillHandler } from "@babji/agent";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

export class InstagramHandler implements SkillHandler {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "get_profile":
        this.requireParam(params, "ig_user_id", actionName);
        return this.getProfile(params);
      case "list_posts":
        this.requireParam(params, "ig_user_id", actionName);
        return this.listPosts(params);
      case "create_post":
        this.requireParam(params, "ig_user_id", actionName);
        this.requireParam(params, "image_url", actionName);
        return this.createPost(params);
      default:
        throw new Error(`Unknown Instagram action: ${actionName}`);
    }
  }

  private requireParam(
    params: Record<string, unknown>,
    name: string,
    action: string
  ): void {
    if (params[name] === undefined || params[name] === null || params[name] === "") {
      throw new Error(`Missing required parameter: ${name} for ${action}`);
    }
  }

  private validateId(value: string, name: string): void {
    if (!/^[\w:.-]+$/.test(value)) {
      throw new Error(`Invalid ${name}: contains disallowed characters`);
    }
  }

  private wrapApiError(action: string, err: unknown): never {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`Instagram ${action} failed: ${message}`);
  }

  private async apiGet(url: string): Promise<unknown> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg: string;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed.error?.message || parsed.error_description || `HTTP ${res.status}`;
      } catch {
        errorMsg = `HTTP ${res.status}`;
      }
      throw new Error(errorMsg);
    }

    return res.json();
  }

  private async apiPost(url: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg: string;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed.error?.message || parsed.error_description || `HTTP ${res.status}`;
      } catch {
        errorMsg = `HTTP ${res.status}`;
      }
      throw new Error(errorMsg);
    }

    return res.json();
  }

  private async getProfile(params: Record<string, unknown>) {
    const igUserId = params.ig_user_id as string;
    this.validateId(igUserId, "ig_user_id");

    try {
      const data = await this.apiGet(
        `${GRAPH_API_BASE}/${igUserId}?fields=id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url`
      );

      const profile = data as {
        id?: string; username?: string; name?: string; biography?: string;
        followers_count?: number; follows_count?: number; media_count?: number;
        profile_picture_url?: string;
      };

      return {
        id: profile.id,
        username: profile.username,
        name: profile.name,
        biography: profile.biography,
        followersCount: profile.followers_count,
        followsCount: profile.follows_count,
        mediaCount: profile.media_count,
        profilePictureUrl: profile.profile_picture_url,
      };
    } catch (err) {
      this.wrapApiError("get_profile", err);
    }
  }

  private async listPosts(params: Record<string, unknown>) {
    const igUserId = params.ig_user_id as string;
    this.validateId(igUserId, "ig_user_id");
    const maxResults = Math.min(Math.max((params.max_results as number) || 10, 1), 50);

    try {
      const data = await this.apiGet(
        `${GRAPH_API_BASE}/${igUserId}/media?fields=id,caption,media_type,media_url,timestamp,like_count,comments_count&limit=${maxResults}`
      );

      const responseData = data as { data?: Array<{
        id?: string; caption?: string; media_type?: string; media_url?: string;
        timestamp?: string; like_count?: number; comments_count?: number;
      }> };

      const posts = (responseData.data || []).map((post) => ({
        id: post.id,
        caption: post.caption,
        mediaType: post.media_type,
        mediaUrl: post.media_url,
        timestamp: post.timestamp,
        likeCount: post.like_count,
        commentsCount: post.comments_count,
      }));

      return { posts, count: posts.length };
    } catch (err) {
      this.wrapApiError("list_posts", err);
    }
  }

  private async createPost(params: Record<string, unknown>) {
    const igUserId = params.ig_user_id as string;
    this.validateId(igUserId, "ig_user_id");
    const imageUrl = params.image_url as string;
    const caption = (params.caption as string) || "";

    try {
      // Step 1: Create media container
      const container = await this.apiPost(
        `${GRAPH_API_BASE}/${igUserId}/media`,
        { image_url: imageUrl, caption }
      ) as { id?: string };

      if (!container.id) {
        throw new Error("Failed to create media container");
      }

      // Step 2: Publish the container
      const published = await this.apiPost(
        `${GRAPH_API_BASE}/${igUserId}/media_publish`,
        { creation_id: container.id }
      ) as { id?: string };

      return {
        created: true,
        postId: published.id,
      };
    } catch (err) {
      this.wrapApiError("create_post", err);
    }
  }
}
