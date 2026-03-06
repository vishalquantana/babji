import type { SkillHandler } from "@babji/agent";

const LINKEDIN_API_BASE = "https://api.linkedin.com/v2";

export class LinkedInHandler implements SkillHandler {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "get_profile":
        return this.getProfile();
      case "create_post":
        this.requireParam(params, "text", actionName);
        return this.createPost(params);
      case "list_posts":
        return this.listPosts(params);
      default:
        throw new Error(`Unknown LinkedIn action: ${actionName}`);
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

  private wrapApiError(action: string, err: unknown): never {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`LinkedIn ${action} failed: ${message}`);
  }

  private async apiGet(url: string): Promise<unknown> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorBody}`);
    }

    return res.json();
  }

  private async apiPost(url: string, body: unknown): Promise<unknown> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorBody}`);
    }

    // LinkedIn POST may return 201 with empty body or JSON
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  private async getProfile() {
    try {
      const data = await this.apiGet(
        `${LINKEDIN_API_BASE}/me?projection=(id,firstName,lastName,profilePicture(displayImage~:playableStreams))`
      );

      const profile = data as {
        id?: string;
        firstName?: { localized?: Record<string, string>; preferredLocale?: { language?: string; country?: string } };
        lastName?: { localized?: Record<string, string>; preferredLocale?: { language?: string; country?: string } };
      };

      const firstNameLocale = profile.firstName?.preferredLocale
        ? `${profile.firstName.preferredLocale.language}_${profile.firstName.preferredLocale.country}`
        : "en_US";
      const lastNameLocale = profile.lastName?.preferredLocale
        ? `${profile.lastName.preferredLocale.language}_${profile.lastName.preferredLocale.country}`
        : "en_US";

      return {
        id: profile.id,
        firstName: profile.firstName?.localized?.[firstNameLocale],
        lastName: profile.lastName?.localized?.[lastNameLocale],
      };
    } catch (err) {
      this.wrapApiError("get_profile", err);
    }
  }

  private async createPost(params: Record<string, unknown>) {
    const text = params.text as string;
    const visibility = (params.visibility as string) || "PUBLIC";

    try {
      // First get the user's URN
      const profile = await this.apiGet(`${LINKEDIN_API_BASE}/me`) as { id?: string };
      const authorUrn = `urn:li:person:${profile.id}`;

      const data = await this.apiPost(
        `${LINKEDIN_API_BASE}/ugcPosts`,
        {
          author: authorUrn,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text },
              shareMediaCategory: "NONE",
            },
          },
          visibility: {
            "com.linkedin.ugc.MemberNetworkVisibility": visibility,
          },
        }
      ) as { id?: string };

      return {
        created: true,
        postId: data.id,
      };
    } catch (err) {
      this.wrapApiError("create_post", err);
    }
  }

  private async listPosts(params: Record<string, unknown>) {
    const maxResults = Math.min(Math.max((params.max_results as number) || 10, 1), 50);

    try {
      const profile = await this.apiGet(`${LINKEDIN_API_BASE}/me`) as { id?: string };
      const authorUrn = `urn:li:person:${profile.id}`;

      const data = await this.apiGet(
        `${LINKEDIN_API_BASE}/ugcPosts?q=authors&authors=List(${encodeURIComponent(authorUrn)})&count=${maxResults}`
      );

      const responseData = data as { elements?: Array<{
        id?: string;
        created?: { time?: number };
        specificContent?: { "com.linkedin.ugc.ShareContent"?: { shareCommentary?: { text?: string } } };
        lifecycleState?: string;
      }> };

      const posts = (responseData.elements || []).map((post) => ({
        id: post.id,
        text: post.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareCommentary?.text,
        createdAt: post.created?.time ? new Date(post.created.time).toISOString() : undefined,
        lifecycleState: post.lifecycleState,
      }));

      return { posts, count: posts.length };
    } catch (err) {
      this.wrapApiError("list_posts", err);
    }
  }
}
