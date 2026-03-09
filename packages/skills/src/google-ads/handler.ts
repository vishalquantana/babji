import { google } from "googleapis";
import type { SkillHandler } from "@babji/agent";

const ADS_API_BASE = "https://googleads.googleapis.com/v17";

export class GoogleAdsHandler implements SkillHandler {
  private accessToken: string;
  private developerToken?: string;

  constructor(accessToken: string, developerToken?: string) {
    this.accessToken = accessToken;
    this.developerToken = developerToken;
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
      case "get_ad_group_report":
        this.requireParam(params, "customer_id", actionName);
        this.requireParam(params, "campaign_id", actionName);
        this.requireParam(params, "start_date", actionName);
        this.requireParam(params, "end_date", actionName);
        return this.getAdGroupReport(params);
      case "get_keyword_report":
        this.requireParam(params, "customer_id", actionName);
        this.requireParam(params, "campaign_id", actionName);
        this.requireParam(params, "start_date", actionName);
        this.requireParam(params, "end_date", actionName);
        return this.getKeywordReport(params);
      case "update_budget":
        this.requireParam(params, "customer_id", actionName);
        this.requireParam(params, "campaign_id", actionName);
        this.requireParam(params, "budget_amount_micros", actionName);
        return this.updateBudget(params);
      case "pause_campaign":
        this.requireParam(params, "customer_id", actionName);
        this.requireParam(params, "campaign_id", actionName);
        return this.setCampaignStatus(params, "PAUSED");
      case "enable_campaign":
        this.requireParam(params, "customer_id", actionName);
        this.requireParam(params, "campaign_id", actionName);
        return this.setCampaignStatus(params, "ENABLED");
      case "get_audience_insights":
        this.requireParam(params, "customer_id", actionName);
        this.requireParam(params, "campaign_id", actionName);
        this.requireParam(params, "start_date", actionName);
        this.requireParam(params, "end_date", actionName);
        return this.getAudienceInsights(params);
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

  private validateId(value: string, name: string): void {
    if (!/^[\w:.-]+$/.test(value)) {
      throw new Error(`Invalid ${name}: contains disallowed characters`);
    }
  }

  private validateCampaignId(value: string): void {
    if (!/^\d+$/.test(value)) {
      throw new Error("Invalid campaign_id: must be numeric");
    }
  }

  private validateDateFormat(value: string, name: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`Invalid ${name}: must be in YYYY-MM-DD format`);
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
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };
    if (this.developerToken) {
      headers["developer-token"] = this.developerToken;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
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

  private async listCampaigns(params: Record<string, unknown>) {
    const customerId = params.customer_id as string;
    this.validateId(customerId, "customer_id");
    const maxResults = Math.min(Math.max((params.max_results as number) || 20, 1), 100);

    const query = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign ORDER BY campaign.name LIMIT ${maxResults}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await this.apiRequest(
        "POST",
        `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`,
        { query }
      )) as any;

      const results = data[0]?.results || data.results || [];
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

    this.validateId(customerId, "customer_id");
    this.validateCampaignId(campaignId);
    this.validateDateFormat(startDate, "start_date");
    this.validateDateFormat(endDate, "end_date");

    const query = `SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc FROM campaign WHERE campaign.id = '${campaignId}' AND segments.date BETWEEN '${startDate}' AND '${endDate}'`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await this.apiRequest(
        "POST",
        `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`,
        { query }
      )) as any;

      const results = data[0]?.results || data.results || [];
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

  private async getAdGroupReport(params: Record<string, unknown>) {
    const customerId = params.customer_id as string;
    const campaignId = params.campaign_id as string;
    const startDate = params.start_date as string;
    const endDate = params.end_date as string;

    this.validateId(customerId, "customer_id");
    this.validateCampaignId(campaignId);
    this.validateDateFormat(startDate, "start_date");
    this.validateDateFormat(endDate, "end_date");

    const query = `SELECT ad_group.id, ad_group.name, ad_group.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc FROM ad_group WHERE campaign.id = '${campaignId}' AND segments.date BETWEEN '${startDate}' AND '${endDate}' ORDER BY metrics.impressions DESC`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await this.apiRequest(
        "POST",
        `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`,
        { query }
      )) as any;

      const results = data[0]?.results || data.results || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adGroups = results.map((row: any) => ({
        id: row.adGroup?.id,
        name: row.adGroup?.name,
        status: row.adGroup?.status,
        impressions: row.metrics?.impressions,
        clicks: row.metrics?.clicks,
        costMicros: row.metrics?.costMicros,
        conversions: row.metrics?.conversions,
        ctr: row.metrics?.ctr,
        averageCpc: row.metrics?.averageCpc,
      }));

      return { adGroups, dateRange: { startDate, endDate }, count: adGroups.length };
    } catch (err) {
      this.wrapApiError("get_ad_group_report", err);
    }
  }

  private async getKeywordReport(params: Record<string, unknown>) {
    const customerId = params.customer_id as string;
    const campaignId = params.campaign_id as string;
    const startDate = params.start_date as string;
    const endDate = params.end_date as string;

    this.validateId(customerId, "customer_id");
    this.validateCampaignId(campaignId);
    this.validateDateFormat(startDate, "start_date");
    this.validateDateFormat(endDate, "end_date");

    const maxResults = Math.min(Math.max((params.max_results as number) || 50, 1), 100);

    const query = `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc FROM keyword_view WHERE campaign.id = '${campaignId}' AND segments.date BETWEEN '${startDate}' AND '${endDate}' ORDER BY metrics.impressions DESC LIMIT ${maxResults}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await this.apiRequest(
        "POST",
        `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`,
        { query }
      )) as any;

      const results = data[0]?.results || data.results || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const keywords = results.map((row: any) => ({
        keyword: row.adGroupCriterion?.keyword?.text,
        matchType: row.adGroupCriterion?.keyword?.matchType,
        status: row.adGroupCriterion?.status,
        impressions: row.metrics?.impressions,
        clicks: row.metrics?.clicks,
        costMicros: row.metrics?.costMicros,
        conversions: row.metrics?.conversions,
        ctr: row.metrics?.ctr,
        averageCpc: row.metrics?.averageCpc,
      }));

      return { keywords, dateRange: { startDate, endDate }, count: keywords.length };
    } catch (err) {
      this.wrapApiError("get_keyword_report", err);
    }
  }

  private async updateBudget(params: Record<string, unknown>) {
    const customerId = params.customer_id as string;
    const campaignId = params.campaign_id as string;
    const budgetAmountMicros = params.budget_amount_micros as number;

    this.validateId(customerId, "customer_id");
    this.validateCampaignId(campaignId);

    const budgetQuery = `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = '${campaignId}' LIMIT 1`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const budgetData = (await this.apiRequest(
        "POST",
        `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`,
        { query: budgetQuery }
      )) as any;

      const results = budgetData[0]?.results || budgetData.results || [];
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

  private async setCampaignStatus(params: Record<string, unknown>, status: "PAUSED" | "ENABLED") {
    const customerId = params.customer_id as string;
    const campaignId = params.campaign_id as string;

    this.validateId(customerId, "customer_id");
    this.validateCampaignId(campaignId);

    const resourceName = `customers/${customerId}/campaigns/${campaignId}`;

    try {
      await this.apiRequest(
        "POST",
        `${ADS_API_BASE}/customers/${customerId}/campaigns:mutate`,
        {
          operations: [
            {
              update: {
                resourceName,
                status,
              },
              updateMask: "status",
            },
          ],
        }
      );

      return {
        updated: true,
        campaignId,
        status,
      };
    } catch (err) {
      this.wrapApiError(status === "PAUSED" ? "pause_campaign" : "enable_campaign", err);
    }
  }

  private async getAudienceInsights(params: Record<string, unknown>) {
    const customerId = params.customer_id as string;
    const campaignId = params.campaign_id as string;
    const startDate = params.start_date as string;
    const endDate = params.end_date as string;

    this.validateId(customerId, "customer_id");
    this.validateCampaignId(campaignId);
    this.validateDateFormat(startDate, "start_date");
    this.validateDateFormat(endDate, "end_date");

    // Gender breakdown
    const genderQuery = `SELECT gender_view.resource_name, ad_group_criterion.gender.type, metrics.impressions, metrics.clicks, metrics.conversions FROM gender_view WHERE campaign.id = '${campaignId}' AND segments.date BETWEEN '${startDate}' AND '${endDate}'`;

    // Age breakdown
    const ageQuery = `SELECT age_range_view.resource_name, ad_group_criterion.age_range.type, metrics.impressions, metrics.clicks, metrics.conversions FROM age_range_view WHERE campaign.id = '${campaignId}' AND segments.date BETWEEN '${startDate}' AND '${endDate}'`;

    // Device breakdown
    const deviceQuery = `SELECT segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.id = '${campaignId}' AND segments.date BETWEEN '${startDate}' AND '${endDate}'`;

    try {
      const [genderData, ageData, deviceData] = await Promise.all([
        this.apiRequest("POST", `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`, { query: genderQuery }),
        this.apiRequest("POST", `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`, { query: ageQuery }),
        this.apiRequest("POST", `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`, { query: deviceQuery }),
      ]) as any[];

      const genderResults = genderData[0]?.results || genderData.results || [];
      const ageResults = ageData[0]?.results || ageData.results || [];
      const deviceResults = deviceData[0]?.results || deviceData.results || [];

      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gender: genderResults.map((row: any) => ({
          type: row.adGroupCriterion?.gender?.type,
          impressions: row.metrics?.impressions,
          clicks: row.metrics?.clicks,
          conversions: row.metrics?.conversions,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ageRange: ageResults.map((row: any) => ({
          type: row.adGroupCriterion?.ageRange?.type,
          impressions: row.metrics?.impressions,
          clicks: row.metrics?.clicks,
          conversions: row.metrics?.conversions,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        device: deviceResults.map((row: any) => ({
          device: row.segments?.device,
          impressions: row.metrics?.impressions,
          clicks: row.metrics?.clicks,
          costMicros: row.metrics?.costMicros,
          conversions: row.metrics?.conversions,
        })),
        dateRange: { startDate, endDate },
      };
    } catch (err) {
      this.wrapApiError("get_audience_insights", err);
    }
  }
}
