import type { SkillHandler } from "@babji/agent";

const ADS_API_BASE = "https://googleads.googleapis.com/v17";

export class GoogleAdsHandler implements SkillHandler {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "list_campaigns":
        this.requireParam(params, "customer_id", actionName);
        return this.listCampaigns(params);
      case "get_campaign_report":
        this.requireParam(params, "customer_id", actionName);
        this.requireParam(params, "campaign_id", actionName);
        this.requireParam(params, "start_date", actionName);
        this.requireParam(params, "end_date", actionName);
        return this.getCampaignReport(params);
      case "update_budget":
        this.requireParam(params, "customer_id", actionName);
        this.requireParam(params, "campaign_id", actionName);
        this.requireParam(params, "budget_amount_micros", actionName);
        return this.updateBudget(params);
      default:
        throw new Error(`Unknown GoogleAds action: ${actionName}`);
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
    throw new Error(`GoogleAds ${action} failed: ${message}`);
  }

  private async apiRequest(
    method: string,
    url: string,
    body?: unknown
  ): Promise<unknown> {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorBody}`);
    }

    return res.json();
  }

  private async listCampaigns(params: Record<string, unknown>) {
    const customerId = params.customer_id as string;
    const maxResults = Math.min(Math.max((params.max_results as number) || 20, 1), 100);

    const query = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign ORDER BY campaign.name LIMIT ${maxResults}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await this.apiRequest(
        "POST",
        `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`,
        { query }
      )) as any;

      const results = data.results || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const campaigns = results.map((row: any) => ({
        id: row.campaign?.id,
        name: row.campaign?.name,
        status: row.campaign?.status,
        channelType: row.campaign?.advertisingChannelType,
        budgetMicros: row.campaignBudget?.amountMicros,
      }));

      return { campaigns, count: campaigns.length };
    } catch (err) {
      this.wrapApiError("list_campaigns", err);
    }
  }

  private async getCampaignReport(params: Record<string, unknown>) {
    const customerId = params.customer_id as string;
    const campaignId = params.campaign_id as string;
    const startDate = params.start_date as string;
    const endDate = params.end_date as string;

    const query = `SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc FROM campaign WHERE campaign.id = '${campaignId}' AND segments.date BETWEEN '${startDate}' AND '${endDate}'`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await this.apiRequest(
        "POST",
        `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`,
        { query }
      )) as any;

      const results = data.results || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metrics = results.map((row: any) => ({
        campaignId: row.campaign?.id,
        campaignName: row.campaign?.name,
        impressions: row.metrics?.impressions,
        clicks: row.metrics?.clicks,
        costMicros: row.metrics?.costMicros,
        conversions: row.metrics?.conversions,
        ctr: row.metrics?.ctr,
        averageCpc: row.metrics?.averageCpc,
      }));

      return { report: metrics, dateRange: { startDate, endDate } };
    } catch (err) {
      this.wrapApiError("get_campaign_report", err);
    }
  }

  private async updateBudget(params: Record<string, unknown>) {
    const customerId = params.customer_id as string;
    const campaignId = params.campaign_id as string;
    const budgetAmountMicros = params.budget_amount_micros as number;

    // First, get the campaign's budget resource name
    const budgetQuery = `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = '${campaignId}' LIMIT 1`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const budgetData = (await this.apiRequest(
        "POST",
        `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`,
        { query: budgetQuery }
      )) as any;

      const results = budgetData.results || [];
      if (results.length === 0) {
        throw new Error(`Campaign ${campaignId} not found`);
      }

      const budgetResourceName = results[0]?.campaign?.campaignBudget;
      if (!budgetResourceName) {
        throw new Error(`No budget found for campaign ${campaignId}`);
      }

      await this.apiRequest(
        "POST",
        `${ADS_API_BASE}/customers/${customerId}/campaignBudgets:mutate`,
        {
          operations: [
            {
              update: {
                resourceName: budgetResourceName,
                amountMicros: String(budgetAmountMicros),
              },
              updateMask: "amount_micros",
            },
          ],
        }
      );

      return {
        updated: true,
        campaignId,
        budgetAmountMicros,
      };
    } catch (err) {
      this.wrapApiError("update_budget", err);
    }
  }
}
