import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { MetaAdsHandler } from "../meta-ads/index.js";

describe("MetaAdsHandler", () => {
  let handler: MetaAdsHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new MetaAdsHandler("fake-token");
  });

  function mockFetchOk(data: unknown) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    });
  }

  function mockFetchError(status: number, body: string) {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      text: () => Promise.resolve(body),
    });
  }

  // -------- list_campaigns --------

  describe("list_campaigns", () => {
    it("returns formatted campaign list", async () => {
      mockFetchOk({
        data: [
          {
            id: "camp1",
            name: "Brand Awareness",
            status: "ACTIVE",
            objective: "BRAND_AWARENESS",
            daily_budget: "5000",
            lifetime_budget: "0",
          },
        ],
      });

      const result = (await handler.execute("list_campaigns", {
        ad_account_id: "act_123456",
      })) as { campaigns: Array<Record<string, unknown>>; count: number };

      expect(result.count).toBe(1);
      expect(result.campaigns[0]).toEqual({
        id: "camp1",
        name: "Brand Awareness",
        status: "ACTIVE",
        objective: "BRAND_AWARENESS",
        dailyBudget: "5000",
        lifetimeBudget: "0",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("act_123456/campaigns"),
        expect.any(Object)
      );
    });

    it("clamps maxResults to 100", async () => {
      mockFetchOk({ data: [] });

      await handler.execute("list_campaigns", {
        ad_account_id: "act_123",
        max_results: 999,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=100"),
        expect.any(Object)
      );
    });

    it("clamps maxResults minimum to 1", async () => {
      mockFetchOk({ data: [] });

      await handler.execute("list_campaigns", {
        ad_account_id: "act_123",
        max_results: -5,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=1"),
        expect.any(Object)
      );
    });

    it("requires ad_account_id parameter", async () => {
      await expect(
        handler.execute("list_campaigns", {})
      ).rejects.toThrow("Missing required parameter: ad_account_id for list_campaigns");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(401, "invalid token");

      await expect(
        handler.execute("list_campaigns", { ad_account_id: "act_123" })
      ).rejects.toThrow("MetaAds list_campaigns failed: HTTP 401");
    });

    it("rejects invalid ad_account_id characters", async () => {
      await expect(
        handler.execute("list_campaigns", { ad_account_id: "act_123; DROP TABLE" })
      ).rejects.toThrow("Invalid ad_account_id: contains disallowed characters");
    });
  });

  // -------- get_campaign_insights --------

  describe("get_campaign_insights", () => {
    it("returns campaign insights", async () => {
      mockFetchOk({
        data: [
          {
            impressions: "50000",
            clicks: "2500",
            spend: "150.00",
            ctr: "0.05",
            cpc: "0.06",
            conversions: "100",
            reach: "40000",
          },
        ],
      });

      const result = (await handler.execute("get_campaign_insights", {
        campaign_id: "camp1",
        start_date: "2025-01-01",
        end_date: "2025-01-31",
      })) as { insights: Array<Record<string, unknown>>; campaignId: string; dateRange: { startDate: string; endDate: string } };

      expect(result.insights).toHaveLength(1);
      expect(result.insights[0].impressions).toBe("50000");
      expect(result.campaignId).toBe("camp1");
      expect(result.dateRange.startDate).toBe("2025-01-01");
    });

    it("requires campaign_id parameter", async () => {
      await expect(
        handler.execute("get_campaign_insights", {
          start_date: "2025-01-01",
          end_date: "2025-01-31",
        })
      ).rejects.toThrow("Missing required parameter: campaign_id for get_campaign_insights");
    });

    it("requires start_date parameter", async () => {
      await expect(
        handler.execute("get_campaign_insights", {
          campaign_id: "camp1",
          end_date: "2025-01-31",
        })
      ).rejects.toThrow("Missing required parameter: start_date for get_campaign_insights");
    });

    it("requires end_date parameter", async () => {
      await expect(
        handler.execute("get_campaign_insights", {
          campaign_id: "camp1",
          start_date: "2025-01-01",
        })
      ).rejects.toThrow("Missing required parameter: end_date for get_campaign_insights");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(400, "bad request");

      await expect(
        handler.execute("get_campaign_insights", {
          campaign_id: "camp1",
          start_date: "2025-01-01",
          end_date: "2025-01-31",
        })
      ).rejects.toThrow("MetaAds get_campaign_insights failed: HTTP 400");
    });

    it("rejects invalid date format for start_date", async () => {
      await expect(
        handler.execute("get_campaign_insights", {
          campaign_id: "camp1",
          start_date: "01-01-2025",
          end_date: "2025-01-31",
        })
      ).rejects.toThrow("Invalid start_date: must be in YYYY-MM-DD format");
    });

    it("rejects invalid date format for end_date", async () => {
      await expect(
        handler.execute("get_campaign_insights", {
          campaign_id: "camp1",
          start_date: "2025-01-01",
          end_date: "Jan 31, 2025",
        })
      ).rejects.toThrow("Invalid end_date: must be in YYYY-MM-DD format");
    });

    it("encodes time_range parameter in URL", async () => {
      mockFetchOk({ data: [] });

      await handler.execute("get_campaign_insights", {
        campaign_id: "camp1",
        start_date: "2025-01-01",
        end_date: "2025-01-31",
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("time_range=" + encodeURIComponent(JSON.stringify({ since: "2025-01-01", until: "2025-01-31" })));
    });
  });

  // -------- update_campaign_status --------

  describe("update_campaign_status", () => {
    it("updates campaign status", async () => {
      mockFetchOk({ success: true });

      const result = (await handler.execute("update_campaign_status", {
        campaign_id: "camp1",
        status: "PAUSED",
      })) as { updated: boolean; campaignId: string; status: string };

      expect(result.updated).toBe(true);
      expect(result.campaignId).toBe("camp1");
      expect(result.status).toBe("PAUSED");
    });

    it("rejects invalid status", async () => {
      await expect(
        handler.execute("update_campaign_status", {
          campaign_id: "camp1",
          status: "INVALID",
        })
      ).rejects.toThrow("Invalid status: INVALID. Must be one of: ACTIVE, PAUSED, ARCHIVED");
    });

    it("requires campaign_id parameter", async () => {
      await expect(
        handler.execute("update_campaign_status", { status: "ACTIVE" })
      ).rejects.toThrow("Missing required parameter: campaign_id for update_campaign_status");
    });

    it("requires status parameter", async () => {
      await expect(
        handler.execute("update_campaign_status", { campaign_id: "camp1" })
      ).rejects.toThrow("Missing required parameter: status for update_campaign_status");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(403, "insufficient permissions");

      await expect(
        handler.execute("update_campaign_status", {
          campaign_id: "camp1",
          status: "ACTIVE",
        })
      ).rejects.toThrow("MetaAds update_campaign_status failed: HTTP 403");
    });
  });

  // -------- unknown action --------

  it("throws on unknown action", async () => {
    await expect(
      handler.execute("nonexistent_action", {})
    ).rejects.toThrow("Unknown MetaAds action: nonexistent_action");
  });
});
