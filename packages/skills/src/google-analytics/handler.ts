import { google } from "googleapis";
import type { SkillHandler } from "@babji/agent";

export class GoogleAnalyticsHandler implements SkillHandler {
  private analyticsData;
  private analyticsAdmin;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.analyticsData = google.analyticsdata({ version: "v1beta", auth });
    this.analyticsAdmin = google.analyticsadmin({ version: "v1beta", auth });
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "list_accounts":
        return this.listAccounts();
      case "get_traffic_overview":
        this.requireParam(params, "property_id", actionName);
        return this.getTrafficOverview(params);
      case "get_traffic_sources":
        this.requireParam(params, "property_id", actionName);
        return this.getTrafficSources(params);
      case "get_top_pages":
        this.requireParam(params, "property_id", actionName);
        return this.getTopPages(params);
      case "get_conversions":
        this.requireParam(params, "property_id", actionName);
        return this.getConversions(params);
      case "get_audience_demographics":
        this.requireParam(params, "property_id", actionName);
        return this.getAudienceDemographics(params);
      case "get_realtime_report":
        this.requireParam(params, "property_id", actionName);
        return this.getRealtimeReport(params);
      case "get_acquisition_report":
        this.requireParam(params, "property_id", actionName);
        return this.getAcquisitionReport(params);
      default:
        throw new Error(`Unknown GoogleAnalytics action: ${actionName}`);
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
    throw new Error(`GoogleAnalytics ${action} failed: ${message}`);
  }

  private getDateRange(params: Record<string, unknown>): { startDate: string; endDate: string } {
    const startDate = (params.start_date as string) || "28daysAgo";
    const endDate = (params.end_date as string) || "today";
    return { startDate, endDate };
  }

  private formatPropertyId(propertyId: string): string {
    // Ensure property ID is in the format "properties/XXXXXX"
    return propertyId.startsWith("properties/") ? propertyId : `properties/${propertyId}`;
  }

  private async listAccounts() {
    try {
      const res = await this.analyticsAdmin.accounts.list();
      const accounts = (res.data.accounts || []).map((account) => ({
        name: account.name,
        displayName: account.displayName,
        createTime: account.createTime,
        updateTime: account.updateTime,
      }));

      // For each account, get its properties
      const accountsWithProperties = await Promise.all(
        accounts.map(async (account) => {
          try {
            const propsRes = await this.analyticsAdmin.properties.list({
              filter: `parent:${account.name}`,
            });
            const properties = (propsRes.data.properties || []).map((prop) => ({
              name: prop.name,
              displayName: prop.displayName,
              propertyType: prop.propertyType,
              timeZone: prop.timeZone,
              currencyCode: prop.currencyCode,
              industryCategory: prop.industryCategory,
            }));
            return { ...account, properties };
          } catch {
            return { ...account, properties: [] };
          }
        })
      );

      return { accounts: accountsWithProperties, count: accountsWithProperties.length };
    } catch (err) {
      this.wrapApiError("list_accounts", err);
    }
  }

  private async getTrafficOverview(params: Record<string, unknown>) {
    const property = this.formatPropertyId(params.property_id as string);
    const { startDate, endDate } = this.getDateRange(params);

    try {
      const res = await this.analyticsData.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
            { name: "newUsers" },
            { name: "screenPageViews" },
            { name: "bounceRate" },
            { name: "averageSessionDuration" },
            { name: "engagedSessions" },
            { name: "engagementRate" },
          ],
        },
      });

      const row = res.data.rows?.[0];
      const values = row?.metricValues || [];

      return {
        dateRange: { startDate, endDate },
        sessions: values[0]?.value,
        totalUsers: values[1]?.value,
        newUsers: values[2]?.value,
        pageViews: values[3]?.value,
        bounceRate: values[4]?.value,
        avgSessionDuration: values[5]?.value,
        engagedSessions: values[6]?.value,
        engagementRate: values[7]?.value,
      };
    } catch (err) {
      this.wrapApiError("get_traffic_overview", err);
    }
  }

  private async getTrafficSources(params: Record<string, unknown>) {
    const property = this.formatPropertyId(params.property_id as string);
    const { startDate, endDate } = this.getDateRange(params);
    const maxResults = Math.min(Math.max((params.max_results as number) || 20, 1), 50);

    try {
      const res = await this.analyticsData.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [
            { name: "sessionSource" },
            { name: "sessionMedium" },
          ],
          metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
            { name: "bounceRate" },
            { name: "averageSessionDuration" },
            { name: "conversions" },
          ],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: String(maxResults),
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sources = ((res.data as any).rows || []).map((row: any) => ({
        source: row.dimensionValues?.[0]?.value,
        medium: row.dimensionValues?.[1]?.value,
        sessions: row.metricValues?.[0]?.value,
        users: row.metricValues?.[1]?.value,
        bounceRate: row.metricValues?.[2]?.value,
        avgSessionDuration: row.metricValues?.[3]?.value,
        conversions: row.metricValues?.[4]?.value,
      }));

      return { sources, dateRange: { startDate, endDate }, count: sources.length };
    } catch (err) {
      this.wrapApiError("get_traffic_sources", err);
    }
  }

  private async getTopPages(params: Record<string, unknown>) {
    const property = this.formatPropertyId(params.property_id as string);
    const { startDate, endDate } = this.getDateRange(params);
    const maxResults = Math.min(Math.max((params.max_results as number) || 20, 1), 50);

    try {
      const res = await this.analyticsData.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [
            { name: "pagePath" },
            { name: "pageTitle" },
          ],
          metrics: [
            { name: "screenPageViews" },
            { name: "totalUsers" },
            { name: "averageSessionDuration" },
            { name: "bounceRate" },
            { name: "engagementRate" },
          ],
          orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
          limit: String(maxResults),
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pages = ((res.data as any).rows || []).map((row: any) => ({
        path: row.dimensionValues?.[0]?.value,
        title: row.dimensionValues?.[1]?.value,
        pageViews: row.metricValues?.[0]?.value,
        users: row.metricValues?.[1]?.value,
        avgTimeOnPage: row.metricValues?.[2]?.value,
        bounceRate: row.metricValues?.[3]?.value,
        engagementRate: row.metricValues?.[4]?.value,
      }));

      return { pages, dateRange: { startDate, endDate }, count: pages.length };
    } catch (err) {
      this.wrapApiError("get_top_pages", err);
    }
  }

  private async getConversions(params: Record<string, unknown>) {
    const property = this.formatPropertyId(params.property_id as string);
    const { startDate, endDate } = this.getDateRange(params);
    const eventNames = params.event_names as string[] | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: any = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: "eventName" },
      ],
      metrics: [
        { name: "eventCount" },
        { name: "totalUsers" },
        { name: "eventValue" },
      ],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: "50",
    };

    if (eventNames && eventNames.length > 0) {
      requestBody.dimensionFilter = {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: eventNames },
        },
      };
    }

    try {
      const res = await this.analyticsData.properties.runReport({
        property,
        requestBody,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conversions = ((res.data as any).rows || []).map((row: any) => ({
        eventName: row.dimensionValues?.[0]?.value,
        count: row.metricValues?.[0]?.value,
        users: row.metricValues?.[1]?.value,
        value: row.metricValues?.[2]?.value,
      }));

      return { conversions, dateRange: { startDate, endDate }, count: conversions.length };
    } catch (err) {
      this.wrapApiError("get_conversions", err);
    }
  }

  private async getAudienceDemographics(params: Record<string, unknown>) {
    const property = this.formatPropertyId(params.property_id as string);
    const { startDate, endDate } = this.getDateRange(params);

    try {
      // Run all demographic queries in parallel
      const [countryRes, deviceRes] = await Promise.all([
        this.analyticsData.properties.runReport({
          property,
          requestBody: {
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: "country" }, { name: "city" }],
            metrics: [{ name: "totalUsers" }, { name: "sessions" }],
            orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
            limit: "20",
          },
        }),
        this.analyticsData.properties.runReport({
          property,
          requestBody: {
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: "deviceCategory" }],
            metrics: [
              { name: "totalUsers" },
              { name: "sessions" },
              { name: "bounceRate" },
              { name: "averageSessionDuration" },
            ],
            orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
          },
        }),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const locations = ((countryRes.data as any).rows || []).map((row: any) => ({
        country: row.dimensionValues?.[0]?.value,
        city: row.dimensionValues?.[1]?.value,
        users: row.metricValues?.[0]?.value,
        sessions: row.metricValues?.[1]?.value,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const devices = ((deviceRes.data as any).rows || []).map((row: any) => ({
        device: row.dimensionValues?.[0]?.value,
        users: row.metricValues?.[0]?.value,
        sessions: row.metricValues?.[1]?.value,
        bounceRate: row.metricValues?.[2]?.value,
        avgSessionDuration: row.metricValues?.[3]?.value,
      }));

      return {
        locations,
        devices,
        dateRange: { startDate, endDate },
      };
    } catch (err) {
      this.wrapApiError("get_audience_demographics", err);
    }
  }

  private async getRealtimeReport(params: Record<string, unknown>) {
    const property = this.formatPropertyId(params.property_id as string);

    try {
      const res = await this.analyticsData.properties.runRealtimeReport({
        property,
        requestBody: {
          dimensions: [
            { name: "unifiedScreenName" },
          ],
          metrics: [
            { name: "activeUsers" },
          ],
          limit: "10",
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resData = res.data as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const topPages = (resData.rows || []).map((row: any) => ({
        page: row.dimensionValues?.[0]?.value,
        activeUsers: row.metricValues?.[0]?.value,
      }));

      // Total active users
      const totalRes = await this.analyticsData.properties.runRealtimeReport({
        property,
        requestBody: {
          metrics: [{ name: "activeUsers" }],
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalActiveUsers = (totalRes.data as any).rows?.[0]?.metricValues?.[0]?.value || "0";

      // By traffic source
      const sourceRes = await this.analyticsData.properties.runRealtimeReport({
        property,
        requestBody: {
          dimensions: [{ name: "source" }],
          metrics: [{ name: "activeUsers" }],
          limit: "10",
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const topSources = ((sourceRes.data as any).rows || []).map((row: any) => ({
        source: row.dimensionValues?.[0]?.value,
        activeUsers: row.metricValues?.[0]?.value,
      }));

      return {
        totalActiveUsers,
        topPages,
        topSources,
      };
    } catch (err) {
      this.wrapApiError("get_realtime_report", err);
    }
  }

  private async getAcquisitionReport(params: Record<string, unknown>) {
    const property = this.formatPropertyId(params.property_id as string);
    const { startDate, endDate } = this.getDateRange(params);
    const maxResults = Math.min(Math.max((params.max_results as number) || 20, 1), 50);

    try {
      const [channelRes, newVsReturningRes] = await Promise.all([
        this.analyticsData.properties.runReport({
          property,
          requestBody: {
            dateRanges: [{ startDate, endDate }],
            dimensions: [
              { name: "firstUserDefaultChannelGroup" },
            ],
            metrics: [
              { name: "totalUsers" },
              { name: "newUsers" },
              { name: "sessions" },
              { name: "engagementRate" },
              { name: "conversions" },
            ],
            orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
            limit: String(maxResults),
          },
        }),
        this.analyticsData.properties.runReport({
          property,
          requestBody: {
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: "newVsReturning" }],
            metrics: [
              { name: "totalUsers" },
              { name: "sessions" },
              { name: "bounceRate" },
              { name: "averageSessionDuration" },
              { name: "conversions" },
            ],
          },
        }),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const channels = ((channelRes.data as any).rows || []).map((row: any) => ({
        channel: row.dimensionValues?.[0]?.value,
        totalUsers: row.metricValues?.[0]?.value,
        newUsers: row.metricValues?.[1]?.value,
        sessions: row.metricValues?.[2]?.value,
        engagementRate: row.metricValues?.[3]?.value,
        conversions: row.metricValues?.[4]?.value,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newVsReturning = ((newVsReturningRes.data as any).rows || []).map((row: any) => ({
        type: row.dimensionValues?.[0]?.value,
        users: row.metricValues?.[0]?.value,
        sessions: row.metricValues?.[1]?.value,
        bounceRate: row.metricValues?.[2]?.value,
        avgSessionDuration: row.metricValues?.[3]?.value,
        conversions: row.metricValues?.[4]?.value,
      }));

      return {
        channels,
        newVsReturning,
        dateRange: { startDate, endDate },
      };
    } catch (err) {
      this.wrapApiError("get_acquisition_report", err);
    }
  }
}
