// packages/gateway/src/stale-followups.ts
import { google } from "googleapis";
import { logger } from "./logger.js";

export interface StaleFollowUp {
  threadId: string;
  subject: string;
  sentTo: string;
  sentDate: string;
  daysSinceSent: number;
  snippet: string;
}

const MAX_SENT_TO_SCAN = 30;
const MAX_RESULTS = 5;

export async function getStaleFollowUps(
  accessToken: string,
  lookbackDays = 7,
): Promise<StaleFollowUp[]> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth });

  const afterEpoch = Math.floor(
    (Date.now() - lookbackDays * 86_400_000) / 1000,
  );

  const res = await gmail.users.messages.list({
    userId: "me",
    q: `in:sent after:${afterEpoch}`,
    maxResults: MAX_SENT_TO_SCAN,
  });

  const messages = res.data.messages || [];
  if (messages.length === 0) return [];

  // Fetch user email once
  const userProfile = await gmail.users.getProfile({ userId: "me" });
  const userEmail = userProfile.data.emailAddress || "";

  const stale: StaleFollowUp[] = [];

  for (const msg of messages) {
    if (stale.length >= MAX_RESULTS) break;

    try {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["To", "Subject", "Date"],
      });

      const threadId = detail.data.threadId!;
      const headers = detail.data.payload?.headers || [];
      const to = headers.find((h) => h.name === "To")?.value || "";
      const subject =
        headers.find((h) => h.name === "Subject")?.value || "(No subject)";
      const dateStr = headers.find((h) => h.name === "Date")?.value || "";

      // Check if thread has replies from others
      const thread = await gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "metadata",
        metadataHeaders: ["From"],
      });

      const threadMessages = thread.data.messages || [];
      const hasReply = threadMessages.some((tm) => {
        const fromHeader =
          tm.payload?.headers?.find((h) => h.name === "From")?.value || "";
        return !fromHeader.includes(userEmail);
      });

      if (hasReply) continue;

      const sentDate = dateStr ? new Date(dateStr) : new Date();
      const daysSinceSent = Math.floor(
        (Date.now() - sentDate.getTime()) / 86_400_000,
      );

      // Skip very recent emails (< 2 days)
      if (daysSinceSent < 2) continue;

      stale.push({
        threadId,
        subject,
        sentTo: to,
        sentDate: sentDate.toISOString(),
        daysSinceSent,
        snippet: detail.data.snippet || "",
      });
    } catch (err) {
      logger.warn({ err, messageId: msg.id }, "Failed to check sent message");
    }
  }

  return stale;
}
