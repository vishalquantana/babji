import type { SkillHandler } from "@babji/agent";

const DEFAULT_BASE_URL = "https://api.postiz.com/public/v1";

export interface PostizDeps {
  apiKey: string;
  baseUrl?: string;
}

export class PostizHandler implements SkillHandler {
  private apiKey: string;
  private baseUrl: string;

  constructor(deps: PostizDeps) {
    this.apiKey = deps.apiKey;
    this.baseUrl = deps.baseUrl || DEFAULT_BASE_URL;
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "list_channels":
        return this.listChannels();
      case "create_post":
        return this.createPost(params);
      case "schedule_post":
        return this.schedulePost(params);
      case "list_posts":
        return this.listPosts();
      case "delete_post":
        return this.deletePost(params);
      case "upload_image":
        return this.uploadFromUrl(params);
      default:
        throw new Error(`Unknown social_media action: ${actionName}`);
    }
  }

  // ── Helpers ──────────────────────────────────────────

  private requireParam(params: Record<string, unknown>, name: string, action: string): void {
    if (params[name] === undefined || params[name] === null || params[name] === "") {
      throw new Error(`Missing required parameter: ${name} for ${action}`);
    }
  }

  private async apiGet(path: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: this.apiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      let msg: string;
      try {
        const parsed = JSON.parse(body);
        msg = parsed.message || parsed.error || `HTTP ${res.status}`;
      } catch {
        msg = `HTTP ${res.status}`;
      }
      throw new Error(`Postiz API error: ${msg}`);
    }

    return res.json();
  }

  private async apiPost(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const respBody = await res.text();
      let msg: string;
      try {
        const parsed = JSON.parse(respBody);
        msg = parsed.message || parsed.error || `HTTP ${res.status}`;
      } catch {
        msg = `HTTP ${res.status}`;
      }
      throw new Error(`Postiz API error: ${msg}`);
    }

    return res.json();
  }

  private async apiDelete(path: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: { Authorization: this.apiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      let msg: string;
      try {
        const parsed = JSON.parse(body);
        msg = parsed.message || parsed.error || `HTTP ${res.status}`;
      } catch {
        msg = `HTTP ${res.status}`;
      }
      throw new Error(`Postiz API error: ${msg}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : { deleted: true };
  }

  // ── Actions ──────────────────────────────────────────

  private async listChannels() {
    const data = await this.apiGet("/integrations") as Array<{
      id: string;
      name: string;
      identifier: string;
      picture?: string;
      disabled?: boolean;
      profile?: string;
    }>;

    const channels = (Array.isArray(data) ? data : []).map((ch) => ({
      id: ch.id,
      name: ch.name,
      platform: ch.identifier,
      profile: ch.profile,
      disabled: ch.disabled || false,
    }));

    return {
      channels,
      count: channels.length,
      hint: channels.length === 0
        ? "No social media channels connected yet. Connect channels in your Postiz dashboard."
        : "Use the channel ID when creating or scheduling posts.",
    };
  }

  private async createPost(params: Record<string, unknown>) {
    this.requireParam(params, "channel_id", "create_post");
    this.requireParam(params, "content", "create_post");

    const channelId = params.channel_id as string;
    const content = params.content as string;
    const images = params.image_urls as string[] | undefined;
    const platform = params.platform as string | undefined;

    // Upload images if provided as external URLs
    const uploadedImages: string[] = [];
    if (images && images.length > 0) {
      for (const url of images) {
        const uploaded = await this.uploadFromUrl({ url });
        const path = (uploaded as { path?: string }).path;
        if (path) uploadedImages.push(path);
      }
    }

    const body = {
      type: "now",
      date: new Date().toISOString(),
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: channelId },
          value: [
            {
              content,
              image: uploadedImages,
            },
          ],
          settings: {
            __type: platform || "instagram",
          },
        },
      ],
    };

    const result = await this.apiPost("/posts", body);
    return {
      posted: true,
      result,
      hint: "Post published successfully!",
    };
  }

  private async schedulePost(params: Record<string, unknown>) {
    this.requireParam(params, "channel_id", "schedule_post");
    this.requireParam(params, "content", "schedule_post");
    this.requireParam(params, "scheduled_time", "schedule_post");

    const channelId = params.channel_id as string;
    const content = params.content as string;
    const scheduledTime = new Date(params.scheduled_time as string);
    const images = params.image_urls as string[] | undefined;
    const platform = params.platform as string | undefined;

    if (isNaN(scheduledTime.getTime())) {
      throw new Error("Invalid scheduled_time. Use ISO 8601 format.");
    }
    if (scheduledTime <= new Date()) {
      throw new Error("Scheduled time must be in the future. Use create_post for immediate posting.");
    }

    // Upload images if provided as external URLs
    const uploadedImages: string[] = [];
    if (images && images.length > 0) {
      for (const url of images) {
        const uploaded = await this.uploadFromUrl({ url });
        const path = (uploaded as { path?: string }).path;
        if (path) uploadedImages.push(path);
      }
    }

    const body = {
      type: "schedule",
      date: scheduledTime.toISOString(),
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: channelId },
          value: [
            {
              content,
              image: uploadedImages,
            },
          ],
          settings: {
            __type: platform || "instagram",
          },
        },
      ],
    };

    const result = await this.apiPost("/posts", body);
    return {
      scheduled: true,
      scheduledAt: scheduledTime.toISOString(),
      result,
      hint: `Post scheduled for ${scheduledTime.toISOString()}. Postiz will publish it automatically.`,
    };
  }

  private async listPosts() {
    const data = await this.apiGet("/posts") as {
      posts?: Array<{
        id: string;
        content: string;
        publishDate: string;
        state: string;
        releaseURL?: string;
        integration?: {
          id: string;
          providerIdentifier: string;
          name: string;
        };
      }>;
    };

    const posts = (data.posts || []).map((p) => ({
      id: p.id,
      content: p.content?.substring(0, 150),
      publishDate: p.publishDate,
      state: p.state,
      platform: p.integration?.providerIdentifier,
      channelName: p.integration?.name,
      url: p.releaseURL,
    }));

    return {
      posts,
      count: posts.length,
    };
  }

  private async deletePost(params: Record<string, unknown>) {
    this.requireParam(params, "post_id", "delete_post");
    const postId = params.post_id as string;

    await this.apiDelete(`/posts/${encodeURIComponent(postId)}`);
    return { deleted: true, postId };
  }

  private async uploadFromUrl(params: Record<string, unknown>) {
    this.requireParam(params, "url", "upload_image");
    const url = params.url as string;

    const result = await this.apiPost("/upload-from-url", { url }) as {
      id: string;
      name: string;
      path: string;
    };

    return {
      id: result.id,
      name: result.name,
      path: result.path,
    };
  }
}
