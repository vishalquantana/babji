import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { GoogleAdsHandler } from "../google-ads/index.js";

describe("GoogleAdsHandler", () => {
  let handler: GoogleAdsHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new GoogleAdsHandler("fake-token");
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
        results: [
          {
            campaign: {
              id: "camp1",
              name: "Summer Sale",
              status: "ENABLED",
              advertisingChannelType: "SEARCH",
            },
            campaignBudget: { amountMicros: "5000000" },
          },
        ],
      });

      const result = (await handler.execute("list_campaigns", {
        customer_id: "1234567890",
      })) as { campaigns: Array<Record<string, unknown>>; count: number };

      expect(result.count).toBe(1);
      expect(result.campaigns[0]).toEqual({
        id: "camp1",
        name: "Summer Sale",
        status: "ENABLED",
        channelType: "SEARCH",
        budgetMicros: "5000000",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/customers/1234567890/googleAds:searchStream"),
        expect.objectContaining({ method: "POST" })
      );
    });

    it("clamps maxResults to 100", async () => {
      mockFetchOk({ results: [] });

      await handler.execute("list_campaigns", {
        customer_id: "123",
        max_results: 999,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toContain("LIMIT 100");
    });

    it("clamps maxResults minimum to 1", async () => {
      mockFetchOk({ results: [] });

      await handler.execute("list_campaigns", {
        customer_id: "123",
        max_results: -5,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toContain("LIMIT 1");
    });

    it("requires customer_id parameter", async () => {
      await expect(
        handler.execute("list_campaigns", {})
      ).rejects.toThrow("Missing required parameter: customer_id for list_campaigns");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(401, "unauthorized");

      await expect(
        handler.execute("list_campaigns", { customer_id: "123" })
      ).rejects.toThrow("GoogleAds list_campaigns failed: HTTP 401");
    });

    it("rejects invalid customer_id characters", async () => {
      await expect(
        handler.execute("list_campaigns", { customer_id: "123; DROP" })
      ).rejects.toThrow("Invalid customer_id: contains disallowed characters");
    });
  });

  // -------- get_campaign_report --------

  describe("get_campaign_report", () => {
    it("returns campaign report metrics", async () => {
      mockFetchOk({
        results: [
          {
            campaign: { id: "camp1", name: "Summer Sale" },
            metrics: {
              impressions: "10000",
              clicks: "500",
              costMicros: "2500000",
              conversions: "50",
              ctr: 0.05,
              averageCpc: "5000",
            },
          },
        ],
      });

      const result = (await handler.execute("get_campaign_report", {
        customer_id: "123",
        campaign_id: "456",
        start_date: "2025-01-01",
        end_date: "2025-01-31",
      })) as { report: Array<Record<string, unknown>>; dateRange: { startDate: string; endDate: string } };

      expect(result.report).toHaveLength(1);
      expect(result.report[0].impressions).toBe("10000");
      expect(result.report[0].clicks).toBe("500");
      expect(result.dateRange.startDate).toBe("2025-01-01");
      expect(result.dateRange.endDate).toBe("2025-01-31");
    });

    it("requires customer_id parameter", async () => {
      await expect(
        handler.execute("get_campaign_report", {
          campaign_id: "camp1",
          start_date: "2025-01-01",
          end_date: "2025-01-31",
        })
      ).rejects.toThrow("Missing required parameter: customer_id for get_campaign_report");
    });

    it("requires campaign_id parameter", async () => {
      await expect(
        handler.execute("get_campaign_report", {
          customer_id: "123",
          start_date: "2025-01-01",
          end_date: "2025-01-31",
        })
      ).rejects.toThrow("Missing required parameter: campaign_id for get_campaign_report");
    });

    it("requires start_date parameter", async () => {
      await expect(
        handler.execute("get_campaign_report", {
          customer_id: "123",
          campaign_id: "camp1",
          end_date: "2025-01-31",
        })
      ).rejects.toThrow("Missing required parameter: start_date for get_campaign_report");
    });

    it("requires end_date parameter", async () => {
      await expect(
        handler.execute("get_campaign_report", {
          customer_id: "123",
          campaign_id: "camp1",
          start_date: "2025-01-01",
        })
      ).rejects.toThrow("Missing required parameter: end_date for get_campaign_report");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(400, "bad request");

      await expect(
        handler.execute("get_campaign_report", {
          customer_id: "123",
          campaign_id: "456",
          start_date: "2025-01-01",
          end_date: "2025-01-31",
        })
      ).rejects.toThrow("GoogleAds get_campaign_report failed: HTTP 400");
    });

    it("rejects non-numeric campaign_id", async () => {
      await expect(
        handler.execute("get_campaign_report", {
          customer_id: "123",
          campaign_id: "camp1",
          start_date: "2025-01-01",
          end_date: "2025-01-31",
        })
      ).rejects.toThrow("Invalid campaign_id: must be numeric");
    });

    it("rejects invalid start_date format", async () => {
      await expect(
        handler.execute("get_campaign_report", {
          customer_id: "123",
          campaign_id: "456",
          start_date: "01-01-2025",
          end_date: "2025-01-31",
        })
      ).rejects.toThrow("Invalid start_date: must be in YYYY-MM-DD format");
    });

    it("rejects invalid end_date format", async () => {
      await expect(
        handler.execute("get_campaign_report", {
          customer_id: "123",
          campaign_id: "456",
          start_date: "2025-01-01",
          end_date: "Jan 31, 2025",
        })
      ).rejects.toThrow("Invalid end_date: must be in YYYY-MM-DD format");
    });
  });

  // -------- update_budget --------

  describe("update_budget", () => {
    it("updates campaign budget", async () => {
      // First call: get budget resource name
      mockFetchOk({
        results: [
          { campaign: { campaignBudget: "customers/123/campaignBudgets/456" } },
        ],
      });
      // Second call: update budget
      mockFetchOk({ results: [{ campaignBudget: { amountMicros: "10000000" } }] });

      const result = (await handler.execute("update_budget", {
        customer_id: "123",
        campaign_id: "789",
        budget_amount_micros: 10000000,
      })) as { updated: boolean; campaignId: string; budgetAmountMicros: number };

      expect(result.updated).toBe(true);
      expect(result.campaignId).toBe("789");
      expect(result.budgetAmountMicros).toBe(10000000);
    });

    it("throws when campaign not found", async () => {
      mockFetchOk({ results: [] });

      await expect(
        handler.execute("update_budget", {
          customer_id: "123",
          campaign_id: "999",
          budget_amount_micros: 5000000,
        })
      ).rejects.toThrow("GoogleAds update_budget failed: Campaign 999 not found");
    });

    it("requires customer_id parameter", async () => {
      await expect(
        handler.execute("update_budget", {
          campaign_id: "camp1",
          budget_amount_micros: 5000000,
        })
      ).rejects.toThrow("Missing required parameter: customer_id for update_budget");
    });

    it("requires campaign_id parameter", async () => {
      await expect(
        handler.execute("update_budget", {
          customer_id: "123",
          budget_amount_micros: 5000000,
        })
      ).rejects.toThrow("Missing required parameter: campaign_id for update_budget");
    });

    it("requires budget_amount_micros parameter", async () => {
      await expect(
        handler.execute("update_budget", {
          customer_id: "123",
          campaign_id: "789",
        })
      ).rejects.toThrow("Missing required parameter: budget_amount_micros for update_budget");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(403, "forbidden");

      await expect(
        handler.execute("update_budget", {
          customer_id: "123",
          campaign_id: "789",
          budget_amount_micros: 5000000,
        })
      ).rejects.toThrow("GoogleAds update_budget failed: HTTP 403");
    });

    it("rejects non-numeric campaign_id", async () => {
      await expect(
        handler.execute("update_budget", {
          customer_id: "123",
          campaign_id: "camp1",
          budget_amount_micros: 5000000,
        })
      ).rejects.toThrow("Invalid campaign_id: must be numeric");
    });
  });

  // -------- unknown action --------

  it("throws on unknown action", async () => {
    await expect(
      handler.execute("nonexistent_action", {})
    ).rejects.toThrow("Unknown GoogleAds action: nonexistent_action");
  });
});
