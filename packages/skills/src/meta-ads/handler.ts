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
      },
    };

    if (method === "GET") {
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}access_token=${this.accessToken}`;
    } else {
      options.body = JSON.stringify({ ...body, access_token: this.accessToken });
    }

    const res = await fetch(url, options);

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorBody}`);
    }

    return res.json();
  }

  private async listCampaigns(params: Record<string, unknown>) {
    const adAccountId = params.ad_account_id as string;
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

    try {
      const data = await this.apiRequest(
        "GET",
        `${GRAPH_API_BASE}/${campaignId}/insights?fields=impressions,clicks,spend,ctr,cpc,conversions,reach&time_range={"since":"${startDate}","until":"${endDate}"}`
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
