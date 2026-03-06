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
        return this.readEmail(params.message_id as string);
      case "send_email":
        return this.sendEmail(
          params.to as string,
          params.subject as string,
          params.body as string
        );
      case "block_sender":
        return this.blockSender(params.email as string);
      default:
        throw new Error(`Unknown Gmail action: ${actionName}`);
    }
  }

  private async listEmails(query?: string, maxResults = 10) {
    const res = await this.gmail.users.messages.list({
      userId: "me",
      q: query || "",
      maxResults,
    });

    const messages = res.data.messages || [];
    const summaries = await Promise.all(
      messages.slice(0, maxResults).map(async (msg) => {
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
  }

  private async readEmail(messageId: string) {
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
  }

  private async sendEmail(to: string, subject: string, body: string) {
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString("base64url");

    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    return { sent: true, messageId: res.data.id };
  }

  private async blockSender(email: string) {
    await this.gmail.users.settings.filters.create({
      userId: "me",
      requestBody: {
        criteria: { from: email },
        action: { removeLabelIds: ["INBOX"], addLabelIds: ["TRASH"] },
      },
    });

    return { blocked: true, email };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractBody(payload: any): string {
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
