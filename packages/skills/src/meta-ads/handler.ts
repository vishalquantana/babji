import type { SkillHandler } from "@babji/agent";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

export class MetaAdsHandler implements SkillHandler {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "list_campaigns":
        this.requireParam(params, "ad_account_id", actionName);
        return this.listCampaigns(params);
      case "get_campaign_insights":
        this.requireParam(params, "campaign_id", actionName);
        this.requireParam(params, "start_date", actionName);
        this.requireParam(params, "end_date", actionName);
        return this.getCampaignInsights(params);
      case "update_campaign_status":
        this.requireParam(params, "campaign_id", actionName);
        this.requireParam(params, "status", actionName);
        return this.updateCampaignStatus(params);
      default:
        throw new Error(`Unknown MetaAds action: ${actionName}`);
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

  private validateDateFormat(value: string, name: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`Invalid ${name}: must be in YYYY-MM-DD format`);
    }
  }

  private wrapApiError(action: string, err: unknown): never {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`MetaAds ${action} failed: ${message}`);
  }

  private async apiRequest(
    method: string,
    url: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
    };

    if (method !== "GET") {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

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

  private async listCampaigns(params: Record<string, unknown>) {
    const adAccountId = params.ad_account_id as string;
    this.validateId(adAccountId, "ad_account_id");
    const maxResults = Math.min(Math.max((params.max_results as number) || 20, 1), 100);

    try {
      const data = await this.apiRequest(
        "GET",
        `${GRAPH_API_BASE}/${adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget&limit=${maxResults}`
      );

      const responseData = data as { data?: Array<{ id?: string; name?: string; status?: string; objective?: string; daily_budget?: string; lifetime_budget?: string }> };
      const campaigns = (responseData.data || []).map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        dailyBudget: campaign.daily_budget,
        lifetimeBudget: campaign.lifetime_budget,
      }));

      return { campaigns, count: campaigns.length };
    } catch (err) {
      this.wrapApiError("list_campaigns", err);
    }
  }

  private async getCampaignInsights(params: Record<string, unknown>) {
    const campaignId = params.campaign_id as string;
    const startDate = params.start_date as string;
    const endDate = params.end_date as string;

    this.validateId(campaignId, "campaign_id");
    this.validateDateFormat(startDate, "start_date");
    this.validateDateFormat(endDate, "end_date");

    const timeRange = encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }));

    try {
      const data = await this.apiRequest(
        "GET",
        `${GRAPH_API_BASE}/${campaignId}/insights?fields=impressions,clicks,spend,ctr,cpc,conversions,reach&time_range=${timeRange}`
      );

      const responseData = data as { data?: Array<{ impressions?: string; clicks?: string; spend?: string; ctr?: string; cpc?: string; conversions?: string; reach?: string }> };
      const insights = (responseData.data || []).map((row) => ({
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        ctr: row.ctr,
        cpc: row.cpc,
        conversions: row.conversions,
        reach: row.reach,
      }));

      return { insights, campaignId, dateRange: { startDate, endDate } };
    } catch (err) {
      this.wrapApiError("get_campaign_insights", err);
    }
  }

  private async updateCampaignStatus(params: Record<string, unknown>) {
    const campaignId = params.campaign_id as string;
    this.validateId(campaignId, "campaign_id");
    const status = params.status as string;

    const validStatuses = ["ACTIVE", "PAUSED", "ARCHIVED"];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(", ")}`);
    }

    try {
      await this.apiRequest(
        "POST",
        `${GRAPH_API_BASE}/${campaignId}`,
        { status }
      );

      return { updated: true, campaignId, status };
    } catch (err) {
      this.wrapApiError("update_campaign_status", err);
    }
  }
}
