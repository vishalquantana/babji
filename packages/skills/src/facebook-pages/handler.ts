import type { SkillHandler } from "@babji/agent";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

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

export class FacebookPagesHandler implements SkillHandler {
  private accessToken: string;
  private deps: FacebookPagesDeps;

  constructor(accessToken: string, deps?: FacebookPagesDeps) {
    this.accessToken = accessToken;
    this.deps = deps || {};
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "list_pages":
        return this.listPages(params);
      case "create_post":
        this.requireParam(params, "page_id", actionName);
        this.requireParam(params, "message", actionName);
        return this.createPost(params);
      case "get_insights":
        this.requireParam(params, "page_id", actionName);
        return this.getInsights(params);
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
      default:
        throw new Error(`Unknown FacebookPages action: ${actionName}`);
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
    throw new Error(`FacebookPages ${action} failed: ${message}`);
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

  private async listPages(params: Record<string, unknown>) {
    const maxResults = Math.min(Math.max((params.max_results as number) || 10, 1), 50);

    try {
      const data = await this.apiGet(
        `${GRAPH_API_BASE}/me/accounts?fields=id,name,category,fan_count&limit=${maxResults}`
      );

      const responseData = data as { data?: Array<{
        id?: string; name?: string; category?: string; fan_count?: number;
      }> };

      const pages = (responseData.data || []).map((page) => ({
        id: page.id,
        name: page.name,
        category: page.category,
        fanCount: page.fan_count,
      }));

      return { pages, count: pages.length };
    } catch (err) {
      this.wrapApiError("list_pages", err);
    }
  }

  private async createPost(params: Record<string, unknown>) {
    const pageId = params.page_id as string;
    this.validateId(pageId, "page_id");
    const message = params.message as string;
    const link = params.link as string | undefined;

    try {
      const body: Record<string, unknown> = { message };
      if (link) body.link = link;

      const data = await this.apiPost(
        `${GRAPH_API_BASE}/${pageId}/feed`,
        body
      ) as { id?: string };

      return {
        created: true,
        postId: data.id,
      };
    } catch (err) {
      this.wrapApiError("create_post", err);
    }
  }

  private async getInsights(params: Record<string, unknown>) {
    const pageId = params.page_id as string;
    this.validateId(pageId, "page_id");
    const metrics = (params.metrics as string[]) || [
      "page_impressions",
      "page_engaged_users",
      "page_fans",
    ];
    const period = (params.period as string) || "day";

    try {
      const data = await this.apiGet(
        `${GRAPH_API_BASE}/${pageId}/insights?metric=${metrics.join(",")}&period=${period}`
      );

      const responseData = data as { data?: Array<{
        name?: string; period?: string; values?: Array<{ value?: unknown; end_time?: string }>;
      }> };

      const insights = (responseData.data || []).map((metric) => ({
        name: metric.name,
        period: metric.period,
        values: metric.values,
      }));

      return { insights, pageId };
    } catch (err) {
      this.wrapApiError("get_insights", err);
    }
  }

  // ── Scheduling ──────────────────────────────────────────

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

    const payload: ScheduledFacebookPayload = {
      page_id: params.page_id as string,
      message: params.message as string,
      link: params.link as string | undefined,
    };

    const jobId = await this.deps.schedulePost(scheduledTime, payload);

    return {
      scheduled: true,
      jobId,
      scheduledAt: scheduledTime.toISOString(),
      message: payload.message.substring(0, 100) + (payload.message.length > 100 ? "..." : ""),
      hint: `Your Facebook post is scheduled for ${scheduledTime.toISOString()}. It will be published automatically.`,
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
        ? "No scheduled Facebook posts."
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
}
