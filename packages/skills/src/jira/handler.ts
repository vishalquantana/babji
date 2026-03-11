import type { SkillHandler } from "@babji/agent";

/**
 * Jira skill handler — uses Atlassian REST API v3 via OAuth 2.0 (3LO).
 *
 * Requires an access token AND a cloudId (fetched during OAuth callback
 * from the accessible-resources endpoint).
 *
 * API base: https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3
 */
export class JiraHandler implements SkillHandler {
  private baseUrl: string;

  constructor(
    private accessToken: string,
    private cloudId: string,
  ) {
    this.baseUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "search_issues":
        return this.searchIssues(params);
      case "get_issue":
        this.requireParam(params, "issue_key", actionName);
        return this.getIssue(params.issue_key as string);
      case "create_issue":
        this.requireParam(params, "project_key", actionName);
        this.requireParam(params, "summary", actionName);
        return this.createIssue(params);
      case "update_issue":
        this.requireParam(params, "issue_key", actionName);
        return this.updateIssue(params);
      case "transition_issue":
        this.requireParam(params, "issue_key", actionName);
        this.requireParam(params, "transition_name", actionName);
        return this.transitionIssue(params);
      case "add_comment":
        this.requireParam(params, "issue_key", actionName);
        this.requireParam(params, "comment", actionName);
        return this.addComment(params);
      case "list_projects":
        return this.listProjects();
      case "assign_issue":
        this.requireParam(params, "issue_key", actionName);
        return this.assignIssue(params);
      default:
        throw new Error(`Unknown Jira action: ${actionName}`);
    }
  }

  // ── API helpers ──────────────────────────────────────────────────────

  private async api(path: string, options: RequestInit = {}): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Jira API ${res.status}: ${body}`);
    }

    // Some endpoints return 204 No Content
    if (res.status === 204) return { success: true };

    return res.json();
  }

  private requireParam(params: Record<string, unknown>, name: string, action: string): void {
    if (params[name] === undefined || params[name] === null || params[name] === "") {
      throw new Error(`Missing required parameter: ${name} for ${action}`);
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────

  private async searchIssues(params: Record<string, unknown>) {
    const jql = (params.jql as string) || "assignee = currentUser() AND status != Done ORDER BY updated DESC";
    const maxResults = Math.min(Math.max((params.max_results as number) || 20, 1), 50);

    const data = await this.api(`/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,assignee,priority,issuetype,created,updated`) as {
      issues: Array<{
        key: string;
        fields: {
          summary: string;
          status: { name: string };
          assignee?: { displayName: string };
          priority?: { name: string };
          issuetype: { name: string };
          created: string;
          updated: string;
        };
      }>;
      total: number;
    };

    const issues = data.issues.map((i) => ({
      key: i.key,
      summary: i.fields.summary,
      status: i.fields.status.name,
      assignee: i.fields.assignee?.displayName ?? "Unassigned",
      priority: i.fields.priority?.name ?? "None",
      type: i.fields.issuetype.name,
      updated: i.fields.updated,
    }));

    return { issues, total: data.total, count: issues.length };
  }

  private async getIssue(issueKey: string) {
    const data = await this.api(`/issue/${issueKey}?fields=summary,description,status,assignee,reporter,priority,issuetype,created,updated,comment,labels,fixVersions`) as {
      key: string;
      fields: {
        summary: string;
        description?: { content?: Array<{ content?: Array<{ text?: string }> }> };
        status: { name: string };
        assignee?: { displayName: string; emailAddress?: string };
        reporter?: { displayName: string };
        priority?: { name: string };
        issuetype: { name: string };
        created: string;
        updated: string;
        labels: string[];
        comment: { comments: Array<{ author: { displayName: string }; body?: { content?: Array<{ content?: Array<{ text?: string }> }> }; created: string }> };
      };
    };

    // Extract plain text from ADF description
    const descriptionText = this.extractAdfText(data.fields.description);

    // Get last 5 comments
    const comments = data.fields.comment.comments.slice(-5).map((c) => ({
      author: c.author.displayName,
      text: this.extractAdfText(c.body),
      created: c.created,
    }));

    return {
      key: data.key,
      summary: data.fields.summary,
      description: descriptionText,
      status: data.fields.status.name,
      type: data.fields.issuetype.name,
      assignee: data.fields.assignee?.displayName ?? "Unassigned",
      reporter: data.fields.reporter?.displayName ?? "Unknown",
      priority: data.fields.priority?.name ?? "None",
      labels: data.fields.labels,
      created: data.fields.created,
      updated: data.fields.updated,
      recentComments: comments,
    };
  }

  private async createIssue(params: Record<string, unknown>) {
    const projectKey = params.project_key as string;
    const issueType = (params.issue_type as string) || "Task";
    const summary = params.summary as string;
    const description = params.description as string | undefined;
    const assignee = params.assignee_account_id as string | undefined;
    const priority = params.priority as string | undefined;
    const labels = params.labels as string[] | undefined;

    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      issuetype: { name: issueType },
      summary,
    };

    if (description) {
      fields.description = {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
      };
    }
    if (assignee) fields.assignee = { accountId: assignee };
    if (priority) fields.priority = { name: priority };
    if (labels) fields.labels = labels;

    const data = await this.api("/issue", {
      method: "POST",
      body: JSON.stringify({ fields }),
    }) as { id: string; key: string; self: string };

    return {
      success: true,
      key: data.key,
      id: data.id,
      message: `Created ${data.key}: ${summary}`,
    };
  }

  private async updateIssue(params: Record<string, unknown>) {
    const issueKey = params.issue_key as string;
    const fields: Record<string, unknown> = {};

    if (params.summary) fields.summary = params.summary;
    if (params.description) {
      fields.description = {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: params.description as string }] }],
      };
    }
    if (params.priority) fields.priority = { name: params.priority };
    if (params.assignee_account_id) fields.assignee = { accountId: params.assignee_account_id };
    if (params.labels) fields.labels = params.labels;

    if (Object.keys(fields).length === 0) {
      return { success: false, error: "No fields to update" };
    }

    await this.api(`/issue/${issueKey}`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });

    return { success: true, key: issueKey, message: `Updated ${issueKey}` };
  }

  private async transitionIssue(params: Record<string, unknown>) {
    const issueKey = params.issue_key as string;
    const transitionName = (params.transition_name as string).toLowerCase();

    // First, get available transitions
    const transitionsData = await this.api(`/issue/${issueKey}/transitions`) as {
      transitions: Array<{ id: string; name: string }>;
    };

    const match = transitionsData.transitions.find(
      (t) => t.name.toLowerCase() === transitionName,
    );

    if (!match) {
      const available = transitionsData.transitions.map((t) => t.name).join(", ");
      return {
        success: false,
        error: `Transition "${params.transition_name}" not found. Available: ${available}`,
      };
    }

    await this.api(`/issue/${issueKey}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: match.id } }),
    });

    return { success: true, key: issueKey, message: `${issueKey} moved to ${match.name}` };
  }

  private async addComment(params: Record<string, unknown>) {
    const issueKey = params.issue_key as string;
    const commentText = params.comment as string;

    await this.api(`/issue/${issueKey}/comment`, {
      method: "POST",
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: commentText }] }],
        },
      }),
    });

    return { success: true, key: issueKey, message: `Comment added to ${issueKey}` };
  }

  private async listProjects() {
    const data = await this.api("/project/search?maxResults=50&orderBy=name") as {
      values: Array<{
        key: string;
        name: string;
        projectTypeKey: string;
        lead?: { displayName: string };
      }>;
      total: number;
    };

    const projects = data.values.map((p) => ({
      key: p.key,
      name: p.name,
      type: p.projectTypeKey,
      lead: p.lead?.displayName ?? "Unknown",
    }));

    return { projects, total: data.total };
  }

  private async assignIssue(params: Record<string, unknown>) {
    const issueKey = params.issue_key as string;
    const accountId = (params.assignee_account_id as string) || null; // null = unassign

    await this.api(`/issue/${issueKey}/assignee`, {
      method: "PUT",
      body: JSON.stringify({ accountId }),
    });

    return {
      success: true,
      key: issueKey,
      message: accountId ? `${issueKey} assigned` : `${issueKey} unassigned`,
    };
  }

  // ── ADF text extraction ──────────────────────────────────────────────

  private extractAdfText(adf?: { content?: Array<{ content?: Array<{ text?: string }> }> }): string {
    if (!adf?.content) return "";
    return adf.content
      .flatMap((block) => block.content?.map((c) => c.text ?? "") ?? [])
      .join("\n")
      .trim();
  }
}
