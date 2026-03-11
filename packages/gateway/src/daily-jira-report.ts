import { eq } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import { TokenVault } from "@babji/crypto";
import { JiraHandler } from "@babji/skills";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ensureValidToken } from "./token-refresh.js";
import { logger } from "./logger.js";

const REPORT_MODEL = "gemini-3.1-flash-lite-preview";

export interface DailyJiraReportDeps {
  db: Database;
  vault: TokenVault;
  googleApiKey: string;
}

interface ReportSection {
  label: string;
  content: string;
}

interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  priority: string;
  type: string;
  updated: string;
}

export class DailyJiraReportService {
  constructor(private deps: DailyJiraReportDeps) {}

  async generateReport(
    tenant: typeof schema.tenants.$inferSelect,
    timezone: string,
  ): Promise<string | null> {
    const tenantId = tenant.id;

    // Get Jira token + cloudId
    const tokenResult = await ensureValidToken(tenantId, "jira", this.deps.vault, this.deps.db);
    if (!tokenResult || tokenResult.status === "expired") {
      logger.warn({ tenantId }, "Jira token expired for daily report, skipping");
      return null;
    }

    const cloudId = tokenResult.cloudId;
    if (!cloudId) {
      logger.warn({ tenantId }, "No Jira cloudId available for daily report, skipping");
      return null;
    }

    const jira = new JiraHandler(tokenResult.accessToken, cloudId);
    const sections: ReportSection[] = [];

    // Fetch assigned issues and recently updated in parallel
    const [assignedSection, recentSection] = await Promise.all([
      this.getAssignedIssuesSection(jira, tenantId),
      this.getRecentActivitySection(jira, tenantId),
    ]);

    if (assignedSection) sections.push(assignedSection);
    if (recentSection) {
      // Deduplicate: remove issues from "recent" that are already in "assigned"
      if (assignedSection) {
        const assignedKeys = new Set(
          (assignedSection as ReportSection & { _keys?: string[] })._keys || [],
        );
        const filtered = (recentSection as ReportSection & { _keys?: string[]; _raw?: JiraIssue[] })
          ._raw?.filter((i) => !assignedKeys.has(i.key));
        if (filtered && filtered.length > 0) {
          const lines = filtered.map(
            (i) => `- ${i.key}: ${i.summary} (${i.status}, by ${i.assignee})`,
          );
          sections.push({
            label: "Recent activity in your projects",
            content: lines.join("\n"),
          });
        }
      } else {
        sections.push(recentSection);
      }
    }

    if (sections.length === 0) return null;

    return this.composeReport(tenant.name, timezone, sections);
  }

  private async getAssignedIssuesSection(
    jira: JiraHandler,
    tenantId: string,
  ): Promise<(ReportSection & { _keys: string[] }) | null> {
    try {
      const result = (await jira.execute("search_issues", {
        jql: "assignee = currentUser() AND status != Done ORDER BY status, priority DESC",
        max_results: 30,
      })) as { issues: JiraIssue[]; total: number };

      if (result.issues.length === 0) return null;

      // Group by status
      const byStatus = new Map<string, JiraIssue[]>();
      for (const issue of result.issues) {
        const group = byStatus.get(issue.status) || [];
        group.push(issue);
        byStatus.set(issue.status, group);
      }

      const lines: string[] = [];
      for (const [status, issues] of byStatus) {
        lines.push(`${status} (${issues.length}):`);
        for (const i of issues) {
          lines.push(`- ${i.key}: ${i.summary} (${i.priority})`);
        }
      }

      return {
        label: `Your assigned issues (${result.issues.length})`,
        content: lines.join("\n"),
        _keys: result.issues.map((i) => i.key),
      };
    } catch (err) {
      logger.warn({ err, tenantId }, "Daily Jira report: assigned issues fetch failed");
      return null;
    }
  }

  private async getRecentActivitySection(
    jira: JiraHandler,
    tenantId: string,
  ): Promise<(ReportSection & { _keys: string[]; _raw: JiraIssue[] }) | null> {
    try {
      // First get assigned issues to find project keys
      const assigned = (await jira.execute("search_issues", {
        jql: "assignee = currentUser() AND status != Done",
        max_results: 50,
      })) as { issues: JiraIssue[] };

      const projectKeys = new Set(assigned.issues.map((i) => i.key.split("-")[0]));
      if (projectKeys.size === 0) return null;

      const projectList = Array.from(projectKeys).join(", ");
      const jql = `project IN (${projectList}) AND updated >= -24h AND assignee != currentUser() ORDER BY updated DESC`;

      const result = (await jira.execute("search_issues", {
        jql,
        max_results: 20,
      })) as { issues: JiraIssue[] };

      if (result.issues.length === 0) return null;

      const lines = result.issues.map(
        (i) => `- ${i.key}: ${i.summary} (${i.status}, by ${i.assignee})`,
      );

      return {
        label: "Recent activity in your projects",
        content: lines.join("\n"),
        _keys: result.issues.map((i) => i.key),
        _raw: result.issues,
      };
    } catch (err) {
      logger.warn({ err, tenantId }, "Daily Jira report: recent activity fetch failed");
      return null;
    }
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
            content: `You are Babji, a business assistant. Compose a concise daily Jira report for ${userName}. Rules:
- Start with "Here's your Jira report for today:"
- Group assigned issues by status
- Separately list what changed in their projects in the last 24 hours
- Use plain text only -- no markdown, no emojis, no bold/italic
- Use line breaks and dashes for structure
- Keep the total message under 2000 characters
- End with a brief one-liner like "Want me to update any of these?"`,
          },
          {
            role: "user",
            content: rawData,
          },
        ],
      });

      return result.text.trim();
    } catch (err) {
      logger.warn({ err }, "Daily Jira report: LLM composition failed, using raw format");
      const lines = [`Here's your Jira report for today:\n`];
      for (const s of sections) {
        lines.push(`-- ${s.label} --`);
        lines.push(s.content);
        lines.push("");
      }
      return lines.join("\n");
    }
  }
}
