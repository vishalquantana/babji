import { google } from "googleapis";
import type { SkillHandler } from "@babji/agent";

export class GmailHandler implements SkillHandler {
  private gmail;

  constructor(accessToken: string) {
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
      case "block_sender":
        this.requireParam(params, "email", actionName);
        return this.blockSender(params.email as string);
      case "unsubscribe":
        this.requireParam(params, "message_id", actionName);
        return this.unsubscribe(params.message_id as string);
      default:
        throw new Error(`Unknown Gmail action: ${actionName}`);
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
