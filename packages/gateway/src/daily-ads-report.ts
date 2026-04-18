import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import { TokenVault } from "@babji/crypto";
import { GoogleAdsHandler } from "@babji/skills";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ensureValidToken } from "./token-refresh.js";
import { logger } from "./logger.js";

const REPORT_MODEL = "gemini-3.1-flash-lite-preview";

export interface DailyAdsReportDeps {
  db: Database;
  vault: TokenVault;
  googleApiKey: string;
  googleAdsDeveloperToken: string;
}

interface ReportSection {
  label: string;
  content: string;
}

export class DailyGoogleAdsReportService {
  constructor(private deps: DailyAdsReportDeps) {}

  async generateReport(
    tenant: typeof schema.tenants.$inferSelect,
    timezone: string,
  ): Promise<string | null> {
    const tenantId = tenant.id;

    // Ensure valid Google Ads token
    const tokenResult = await ensureValidToken(tenantId, "google_ads", this.deps.vault, this.deps.db);
    if (!tokenResult || tokenResult.status === "expired") {
      logger.warn({ tenantId }, "Google Ads token expired for daily report, skipping");
      return null;
    }

    const ads = new GoogleAdsHandler(tokenResult.accessToken, this.deps.googleAdsDeveloperToken);
    const sections: ReportSection[] = [];

    // Step 1: List accounts
    let accounts: { customerId: string; name: string | null; managerId?: string }[];
    try {
      const result = (await ads.execute("list_accounts", {})) as {
        accounts: { customerId: string; name: string | null; managerId?: string }[];
      };
      accounts = result.accounts || [];
    } catch (err) {
      logger.warn({ err, tenantId }, "Daily Ads report: failed to list accounts");
      return null;
    }

    if (accounts.length === 0) return null;

    // Step 2: For each account, get campaign performance (yesterday)
    const yesterday = this.getYesterday(timezone);

    for (const account of accounts.slice(0, 3)) {
      // Limit to 3 accounts to keep report manageable
      const campaignSection = await this.getCampaignPerformance(
        ads, tenantId, account, yesterday,
      );
      if (campaignSection) sections.push(campaignSection);
    }

    if (sections.length === 0) return null;

    return this.composeReport(tenant.name, timezone, sections);
  }

  private async getCampaignPerformance(
    ads: GoogleAdsHandler,
    tenantId: string,
    account: { customerId: string; name: string | null; managerId?: string },
    dateStr: string,
  ): Promise<ReportSection | null> {
    try {
      // List campaigns first
      const campaignResult = (await ads.execute("list_campaigns", {
        customer_id: account.customerId,
        login_customer_id: account.managerId,
        max_results: 10,
      })) as {
        campaigns: {
          id: string;
          name: string;
          status: string;
          budget: string;
          budgetAmount: number;
        }[];
      };

      const activeCampaigns = (campaignResult.campaigns || []).filter(
        (c) => c.status === "ENABLED",
      );

      if (activeCampaigns.length === 0) {
        return {
          label: `${account.name || account.customerId} — No active campaigns`,
          content: "All campaigns are paused or removed.",
        };
      }

      // Get performance for each active campaign
      const lines: string[] = [];
      let totalSpend = 0;
      let totalClicks = 0;
      let totalImpressions = 0;

      for (const campaign of activeCampaigns.slice(0, 5)) {
        try {
          const report = (await ads.execute("get_campaign_report", {
            customer_id: account.customerId,
            login_customer_id: account.managerId,
            campaign_id: campaign.id,
            start_date: dateStr,
            end_date: dateStr,
          })) as {
            metrics: {
              impressions: number;
              clicks: number;
              costMicros: number;
              conversions: number;
              ctr: string;
              averageCpc: number;
            };
          };

          const m = report.metrics || {} as Record<string, number>;
          const spend = (m.costMicros || 0) / 1_000_000;
          totalSpend += spend;
          totalClicks += m.clicks || 0;
          totalImpressions += m.impressions || 0;

          lines.push(
            `- ${campaign.name}: ${m.impressions || 0} impressions, ${m.clicks || 0} clicks, $${spend.toFixed(2)} spent` +
            (m.conversions ? `, ${m.conversions} conversions` : ""),
          );
        } catch (err) {
          lines.push(`- ${campaign.name}: data unavailable`);
        }
      }

      // Add totals
      lines.push(
        `\nTotals: ${totalImpressions} impressions, ${totalClicks} clicks, $${totalSpend.toFixed(2)} spent`,
      );

      return {
        label: account.name || `Account ${account.customerId}`,
        content: lines.join("\n"),
      };
    } catch (err) {
      logger.warn({ err, tenantId, customerId: account.customerId }, "Daily Ads report: campaign fetch failed");
      return null;
    }
  }

  private getYesterday(timezone: string): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // Get yesterday in the tenant's timezone
    const yesterday = new Date(now.getTime() - 86_400_000);
    return formatter.format(yesterday); // YYYY-MM-DD format
  }

  private async composeReport(
    userName: string,
    timezone: string,
    sections: ReportSection[],
  ): Promise<string> {
    const googleAi = createGoogleGenerativeAI({ apiKey: this.deps.googleApiKey });
    const rawData = sections.map((s) => `### ${s.label}\n${s.content}`).join("\n\n");

    try {
      const result = await generateText({
        model: googleAi(REPORT_MODEL),
        messages: [
          {
            role: "system",
            content: `You are Babji, a business assistant. Compose a concise daily Google Ads performance report for ${userName}. Rules:
- Start with "Here's your Google Ads report for yesterday:"
- Highlight top performers and any campaigns that need attention (high spend/low conversions, low CTR)
- Give 1-2 brief actionable recommendations based on the data
- Use plain text only -- no markdown, no emojis, no bold/italic
- Use line breaks and dashes for structure
- Keep the total message under 2000 characters
- End with something like "Want me to adjust any campaign budgets or dig deeper into a specific campaign?"`,
          },
          {
            role: "user",
            content: rawData,
          },
        ],
      });

      return result.text.trim();
    } catch (err) {
      logger.warn({ err }, "Daily Ads report: LLM composition failed, using raw format");
      const lines = [`Here's your Google Ads report for yesterday:\n`];
      for (const s of sections) {
        lines.push(`-- ${s.label} --`);
        lines.push(s.content);
        lines.push("");
      }
      return lines.join("\n");
    }
  }
}
