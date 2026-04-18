import { google } from "googleapis";
import type { SkillHandler } from "@babji/agent";

export interface GoogleDocsDeps {
  /** Read a report's markdown content by report ID */
  getReportMarkdown: (reportId: string) => Promise<string | null>;
}

export class GoogleDocsHandler implements SkillHandler {
  private drive;
  private docs;

  constructor(
    accessToken: string,
    private deps: GoogleDocsDeps,
  ) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.drive = google.drive({ version: "v3", auth });
    this.docs = google.docs({ version: "v1", auth });
  }

  async execute(
    actionName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (actionName) {
      case "export_report":
        return this.exportReport(params);
      case "create_document":
        return this.createDocument(params);
      default:
        throw new Error(`Unknown google_docs action: ${actionName}`);
    }
  }

  /**
   * Export an existing Babji report to Google Docs.
   * Takes a report_id, fetches the markdown, converts to HTML,
   * and uploads as a Google Doc.
   */
  private async exportReport(params: Record<string, unknown>) {
    const reportId = params.report_id as string;
    if (!reportId) throw new Error("Missing required parameter: report_id");

    const markdown = await this.deps.getReportMarkdown(reportId);
    if (!markdown) {
      return { error: true, message: `Report '${reportId}' not found.` };
    }

    // Extract a title from the first heading or first line
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : "Babji Research Report";

    return this.uploadAsGoogleDoc(title, markdown);
  }

  /**
   * Create a new Google Doc from markdown content.
   * Useful for generating summary docs, memos, briefs, etc.
   */
  private async createDocument(params: Record<string, unknown>) {
    const title = (params.title as string) || "Untitled Document";
    const content = params.content as string;
    if (!content) throw new Error("Missing required parameter: content");

    return this.uploadAsGoogleDoc(title, content);
  }

  /**
   * Upload markdown content as a Google Doc via the Drive API.
   * Drive automatically converts HTML to Google Docs format.
   */
  private async uploadAsGoogleDoc(title: string, markdown: string) {
    const html = this.markdownToHtml(title, markdown);

    // Create Google Doc by uploading HTML (Drive converts it)
    const response = await this.drive.files.create({
      requestBody: {
        name: title,
        mimeType: "application/vnd.google-apps.document",
      },
      media: {
        mimeType: "text/html",
        body: html,
      },
      fields: "id,name,webViewLink",
    });

    const fileId = response.data.id;
    if (!fileId) throw new Error("Failed to create Google Doc — no file ID returned");

    // Make the doc viewable by anyone with the link
    await this.drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    return {
      success: true,
      document_id: fileId,
      document_url: response.data.webViewLink,
      title: response.data.name,
      hint: "Share the document_url with the user. The doc is viewable by anyone with the link.",
    };
  }

  /** Convert markdown to clean HTML suitable for Google Docs import */
  private markdownToHtml(title: string, md: string): string {
    let html = md
      .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^---$/gm, "<hr/>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

    html = html
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return "";
        if (/^<(h[1-4]|ul|li|hr|p|div|blockquote)/.test(trimmed)) return trimmed;
        return `<p>${trimmed}</p>`;
      })
      .join("\n");

    return `<!DOCTYPE html><html><head><title>${title}</title></head><body>${html}</body></html>`;
  }
}
