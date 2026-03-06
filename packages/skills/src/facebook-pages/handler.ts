import type { SkillHandler } from "@babji/agent";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

export class FacebookPagesHandler implements SkillHandler {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
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
}
