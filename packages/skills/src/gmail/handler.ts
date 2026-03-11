import { google } from "googleapis";
import { eq } from "drizzle-orm";
import type { SkillHandler } from "@babji/agent";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";

export class GmailHandler implements SkillHandler {
  private gmail;

  constructor(
    accessToken: string,
    private db?: Database,
    private tenantId?: string,
  ) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.gmail = google.gmail({ version: "v1", auth });
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "list_emails":
        return this.listEmails(params.query as string, params.max_results as number);
      case "read_email":
        this.requireParam(params, "message_id", actionName);
        return this.readEmail(params.message_id as string);
      case "send_email":
        this.requireParam(params, "to", actionName);
        this.requireParam(params, "subject", actionName);
        this.requireParam(params, "body", actionName);
        return this.sendEmail(
          params.to as string,
          params.subject as string,
          params.body as string
        );
      case "archive_emails":
        this.requireParam(params, "message_ids", actionName);
        return this.archiveEmails(params.message_ids as string[]);
      case "block_sender":
        this.requireParam(params, "email", actionName);
        return this.blockSender(params.email as string);
      case "unsubscribe":
        this.requireParam(params, "message_id", actionName);
        return this.unsubscribe(params.message_id as string);
      case "create_email_filter":
        this.requireParam(params, "action", actionName);
        return this.createEmailFilter(params);
      case "list_email_filters":
        return this.listEmailFilters();
      case "delete_email_filter":
        this.requireParam(params, "filter_id", actionName);
        return this.deleteEmailFilter(params.filter_id as string);
      default:
        throw new Error(`Unknown Gmail action: ${actionName}`);
    }
  }

  private requireDb(): { db: Database; tenantId: string } {
    if (!this.db || !this.tenantId) {
      throw new Error("Email filter operations require database access. Please reconnect Gmail.");
    }
    return { db: this.db, tenantId: this.tenantId };
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

  private validateHeader(value: string, name: string): void {
    if (/[\r\n]/.test(value)) {
      throw new Error(`Invalid ${name}: must not contain newline characters`);
    }
  }

  private wrapApiError(action: string, err: unknown): never {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`Gmail ${action} failed: ${message}`);
  }

  private async listEmails(query?: string, maxResults = 10) {
    const clamped = Math.min(Math.max(maxResults, 1), 50);

    try {
      const res = await this.gmail.users.messages.list({
        userId: "me",
        q: query || "",
        maxResults: clamped,
      });

      const messages = res.data.messages || [];
      const summaries = await Promise.all(
        messages.slice(0, clamped).map(async (msg) => {
          const detail = await this.gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });
          const headers = detail.data.payload?.headers || [];
          return {
            id: msg.id,
            from: headers.find((h) => h.name === "From")?.value,
            subject: headers.find((h) => h.name === "Subject")?.value,
            date: headers.find((h) => h.name === "Date")?.value,
            snippet: detail.data.snippet,
          };
        })
      );

      return { emails: summaries, total: res.data.resultSizeEstimate };
    } catch (err) {
      this.wrapApiError("list_emails", err);
    }
  }

  private async readEmail(messageId: string) {
    try {
      const res = await this.gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const headers = res.data.payload?.headers || [];
      const body = this.extractBody(res.data.payload);

      return {
        id: messageId,
        from: headers.find((h) => h.name === "From")?.value,
        to: headers.find((h) => h.name === "To")?.value,
        subject: headers.find((h) => h.name === "Subject")?.value,
        date: headers.find((h) => h.name === "Date")?.value,
        body,
      };
    } catch (err) {
      this.wrapApiError("read_email", err);
    }
  }

  private async sendEmail(to: string, subject: string, body: string) {
    this.validateHeader(to, "to");
    this.validateHeader(subject, "subject");

    try {
      const raw = Buffer.from(
        `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
      ).toString("base64url");

      const res = await this.gmail.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });

      return { sent: true, messageId: res.data.id };
    } catch (err) {
      this.wrapApiError("send_email", err);
    }
  }

  private async archiveEmails(messageIds: string[]) {
    try {
      const results = await Promise.all(
        messageIds.map(async (id) => {
          await this.gmail.users.messages.modify({
            userId: "me",
            id,
            requestBody: { removeLabelIds: ["INBOX"] },
          });
          return id;
        })
      );
      return { archived: true, count: results.length, messageIds: results };
    } catch (err) {
      this.wrapApiError("archive_emails", err);
    }
  }

  private async blockSender(email: string) {
    try {
      await this.gmail.users.settings.filters.create({
        userId: "me",
        requestBody: {
          criteria: { from: email },
          action: { removeLabelIds: ["INBOX"], addLabelIds: ["TRASH"] },
        },
      });

      return { blocked: true, email };
    } catch (err) {
      this.wrapApiError("block_sender", err);
    }
  }

  private async unsubscribe(messageId: string) {
    try {
      const res = await this.gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "metadata",
        metadataHeaders: ["List-Unsubscribe"],
      });

      const headers = res.data.payload?.headers || [];
      const unsubHeader = headers.find((h) => h.name === "List-Unsubscribe")?.value;

      if (!unsubHeader) {
        return { found: false, reason: "No List-Unsubscribe header found" };
      }

      // Extract URL from header (format: <https://...> or <mailto:...>)
      const urlMatch = unsubHeader.match(/<(https?:\/\/[^>]+)>/);
      if (urlMatch) {
        return {
          found: true,
          method: "url",
          url: urlMatch[1],
          action: "Visit this URL to complete unsubscription",
        };
      }

      const mailtoMatch = unsubHeader.match(/<mailto:([^>]+)>/);
      if (mailtoMatch) {
        return {
          found: true,
          method: "mailto",
          email: mailtoMatch[1],
          action: "Send email to this address to unsubscribe",
        };
      }

      return { found: false, reason: "Could not parse List-Unsubscribe header" };
    } catch (err) {
      this.wrapApiError("unsubscribe", err);
    }
  }

  private async createEmailFilter(params: Record<string, unknown>) {
    const { db, tenantId } = this.requireDb();

    const action = params.action as string;
    const criteria: Record<string, unknown> = {};
    if (params.from) criteria.from = params.from as string;
    if (params.to) criteria.to = params.to as string;
    if (params.subject) criteria.subject = params.subject as string;
    if (params.query) criteria.query = params.query as string;
    if (params.has_attachment) criteria.hasAttachment = true;

    if (Object.keys(criteria).length === 0) {
      throw new Error("At least one filter criteria is required (from, to, subject, query, or has_attachment)");
    }

    // Map action string to Gmail filter action object
    const gmailAction: { removeLabelIds?: string[]; addLabelIds?: string[] } = {};
    switch (action) {
      case "archive":
        gmailAction.removeLabelIds = ["INBOX"];
        break;
      case "trash":
        gmailAction.addLabelIds = ["TRASH"];
        break;
      case "star":
        gmailAction.addLabelIds = ["STARRED"];
        break;
      case "mark_read":
        gmailAction.removeLabelIds = ["UNREAD"];
        break;
      case "label": {
        const label = params.label as string;
        if (!label) throw new Error("'label' parameter is required when action is 'label'");
        gmailAction.addLabelIds = [label];
        break;
      }
      default:
        throw new Error(`Unknown filter action: ${action}. Use archive, trash, star, mark_read, or label.`);
    }

    try {
      const res = await this.gmail.users.settings.filters.create({
        userId: "me",
        requestBody: { criteria, action: gmailAction },
      });

      const gmailFilterId = res.data.id!;
      const description = (params.description as string) || `${action} emails matching: ${JSON.stringify(criteria)}`;

      await db.insert(schema.emailFilters).values({
        tenantId,
        gmailFilterId,
        description,
        criteria,
        actions: gmailAction,
      });

      return {
        created: true,
        filterId: gmailFilterId,
        description,
        criteria,
        action,
      };
    } catch (err) {
      this.wrapApiError("create_email_filter", err);
    }
  }

  private async listEmailFilters() {
    const { db, tenantId } = this.requireDb();

    const filters = await db
      .select()
      .from(schema.emailFilters)
      .where(eq(schema.emailFilters.tenantId, tenantId));

    return {
      filters: filters.map((f) => ({
        id: f.id,
        description: f.description,
        criteria: f.criteria,
        actions: f.actions,
        createdAt: f.createdAt,
      })),
      total: filters.length,
    };
  }

  private async deleteEmailFilter(filterId: string) {
    const { db, tenantId } = this.requireDb();

    const filter = await db
      .select()
      .from(schema.emailFilters)
      .where(eq(schema.emailFilters.id, filterId))
      .then((rows) => rows[0]);

    if (!filter || filter.tenantId !== tenantId) {
      throw new Error("Email filter not found");
    }

    try {
      await this.gmail.users.settings.filters.delete({
        userId: "me",
        id: filter.gmailFilterId,
      });
    } catch (err) {
      // If Gmail filter is already gone, still clean up our DB
      const message = err instanceof Error ? err.message : "";
      if (!message.includes("not found") && !message.includes("404")) {
        this.wrapApiError("delete_email_filter", err);
      }
    }

    await db
      .delete(schema.emailFilters)
      .where(eq(schema.emailFilters.id, filterId));

    return { deleted: true, filterId, description: filter.description };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractBody(payload: any): string {
    if (!payload) return "";
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, "base64").toString("utf-8");
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          return Buffer.from(part.body.data, "base64").toString("utf-8");
        }
      }
      for (const part of payload.parts) {
        const nested = this.extractBody(part);
        if (nested) return nested;
      }
    }
    return "";
  }
}
