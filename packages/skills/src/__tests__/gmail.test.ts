import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock googleapis ----
const mockMessagesList = vi.fn();
const mockMessagesGet = vi.fn();
const mockMessagesSend = vi.fn();
const mockFiltersCreate = vi.fn();

vi.mock("googleapis", () => {
  const gmailClient = {
    users: {
      messages: {
        list: (...args: unknown[]) => mockMessagesList(...args),
        get: (...args: unknown[]) => mockMessagesGet(...args),
        send: (...args: unknown[]) => mockMessagesSend(...args),
      },
      settings: {
        filters: {
          create: (...args: unknown[]) => mockFiltersCreate(...args),
        },
      },
    },
  };

  return {
    google: {
      auth: {
        OAuth2: vi.fn().mockImplementation(() => ({
          setCredentials: vi.fn(),
        })),
      },
      gmail: vi.fn(() => gmailClient),
    },
  };
});

import { GmailHandler } from "../gmail/index.js";

describe("GmailHandler", () => {
  let handler: GmailHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new GmailHandler("fake-token");
  });

  // -------- list_emails --------

  describe("list_emails", () => {
    it("returns formatted email summaries", async () => {
      mockMessagesList.mockResolvedValue({
        data: {
          messages: [{ id: "msg1" }, { id: "msg2" }],
          resultSizeEstimate: 42,
        },
      });
      mockMessagesGet.mockImplementation(({ id }: { id: string }) =>
        Promise.resolve({
          data: {
            payload: {
              headers: [
                { name: "From", value: `sender-${id}@test.com` },
                { name: "Subject", value: `Subject ${id}` },
                { name: "Date", value: "Mon, 1 Jan 2025 00:00:00 +0000" },
              ],
            },
            snippet: `Snippet for ${id}`,
          },
        })
      );

      const result = (await handler.execute("list_emails", {
        query: "is:unread",
        max_results: 5,
      })) as { emails: Array<Record<string, unknown>>; total: number };

      expect(result.total).toBe(42);
      expect(result.emails).toHaveLength(2);
      expect(result.emails[0]).toEqual({
        id: "msg1",
        from: "sender-msg1@test.com",
        subject: "Subject msg1",
        date: "Mon, 1 Jan 2025 00:00:00 +0000",
        snippet: "Snippet for msg1",
      });
      expect(mockMessagesList).toHaveBeenCalledWith(
        expect.objectContaining({ q: "is:unread", maxResults: 5 })
      );
    });

    it("clamps maxResults to 50", async () => {
      mockMessagesList.mockResolvedValue({
        data: { messages: [], resultSizeEstimate: 0 },
      });

      await handler.execute("list_emails", { max_results: 999 });

      expect(mockMessagesList).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 50 })
      );
    });

    it("clamps maxResults minimum to 1", async () => {
      mockMessagesList.mockResolvedValue({
        data: { messages: [], resultSizeEstimate: 0 },
      });

      await handler.execute("list_emails", { max_results: -5 });

      expect(mockMessagesList).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 1 })
      );
    });

    it("wraps API errors with sanitized message", async () => {
      mockMessagesList.mockRejectedValue(new Error("quota exceeded"));

      await expect(handler.execute("list_emails", {})).rejects.toThrow(
        "Gmail list_emails failed: quota exceeded"
      );
    });
  });

  // -------- read_email --------

  describe("read_email", () => {
    it("returns full email with extracted body", async () => {
      const bodyBase64 = Buffer.from("Hello World").toString("base64");
      mockMessagesGet.mockResolvedValue({
        data: {
          payload: {
            headers: [
              { name: "From", value: "alice@test.com" },
              { name: "To", value: "bob@test.com" },
              { name: "Subject", value: "Greetings" },
              { name: "Date", value: "Tue, 2 Jan 2025 12:00:00 +0000" },
            ],
            parts: [
              {
                mimeType: "text/plain",
                body: { data: bodyBase64 },
              },
            ],
          },
        },
      });

      const result = (await handler.execute("read_email", {
        message_id: "msg123",
      })) as Record<string, unknown>;

      expect(result.id).toBe("msg123");
      expect(result.from).toBe("alice@test.com");
      expect(result.subject).toBe("Greetings");
      expect(result.body).toBe("Hello World");
    });

    it("requires message_id parameter", async () => {
      await expect(handler.execute("read_email", {})).rejects.toThrow(
        "Missing required parameter: message_id for read_email"
      );
    });

    it("wraps API errors with sanitized message", async () => {
      mockMessagesGet.mockRejectedValue(new Error("not found"));

      await expect(
        handler.execute("read_email", { message_id: "bad" })
      ).rejects.toThrow("Gmail read_email failed: not found");
    });
  });

  // -------- send_email --------

  describe("send_email", () => {
    it("sends base64url-encoded raw message", async () => {
      mockMessagesSend.mockResolvedValue({
        data: { id: "sent-1" },
      });

      const result = (await handler.execute("send_email", {
        to: "bob@test.com",
        subject: "Hi",
        body: "Hello!",
      })) as { sent: boolean; messageId: string };

      expect(result.sent).toBe(true);
      expect(result.messageId).toBe("sent-1");

      // Verify the raw param is base64url encoded
      const callArgs = mockMessagesSend.mock.calls[0][0];
      const raw = callArgs.requestBody.raw;
      // base64url should not contain + / = characters
      expect(raw).not.toMatch(/[+/=]/);
      // Decode and check contents
      const decoded = Buffer.from(raw, "base64url").toString("utf-8");
      expect(decoded).toContain("To: bob@test.com");
      expect(decoded).toContain("Subject: Hi");
      expect(decoded).toContain("Hello!");
    });

    it("requires to, subject, body parameters", async () => {
      await expect(
        handler.execute("send_email", { subject: "Hi", body: "Hello" })
      ).rejects.toThrow("Missing required parameter: to for send_email");

      await expect(
        handler.execute("send_email", { to: "a@b.com", body: "Hello" })
      ).rejects.toThrow("Missing required parameter: subject for send_email");

      await expect(
        handler.execute("send_email", { to: "a@b.com", subject: "Hi" })
      ).rejects.toThrow("Missing required parameter: body for send_email");
    });

    it("rejects 'to' with newline characters (header injection)", async () => {
      await expect(
        handler.execute("send_email", {
          to: "evil@test.com\r\nBcc: spy@test.com",
          subject: "Hi",
          body: "Hello",
        })
      ).rejects.toThrow("Invalid to: must not contain newline characters");
    });

    it("rejects 'subject' with newline characters (header injection)", async () => {
      await expect(
        handler.execute("send_email", {
          to: "bob@test.com",
          subject: "Hi\nBcc: spy@test.com",
          body: "Hello",
        })
      ).rejects.toThrow("Invalid subject: must not contain newline characters");
    });

    it("wraps API errors with sanitized message", async () => {
      mockMessagesSend.mockRejectedValue(new Error("auth revoked"));

      await expect(
        handler.execute("send_email", {
          to: "a@b.com",
          subject: "s",
          body: "b",
        })
      ).rejects.toThrow("Gmail send_email failed: auth revoked");
    });
  });

  // -------- block_sender --------

  describe("block_sender", () => {
    it("creates filter with correct criteria", async () => {
      mockFiltersCreate.mockResolvedValue({ data: {} });

      const result = (await handler.execute("block_sender", {
        email: "spam@evil.com",
      })) as { blocked: boolean; email: string };

      expect(result.blocked).toBe(true);
      expect(result.email).toBe("spam@evil.com");

      expect(mockFiltersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "me",
          requestBody: {
            criteria: { from: "spam@evil.com" },
            action: { removeLabelIds: ["INBOX"], addLabelIds: ["TRASH"] },
          },
        })
      );
    });

    it("requires email parameter", async () => {
      await expect(handler.execute("block_sender", {})).rejects.toThrow(
        "Missing required parameter: email for block_sender"
      );
    });

    it("wraps API errors with sanitized message", async () => {
      mockFiltersCreate.mockRejectedValue(new Error("filter limit reached"));

      await expect(
        handler.execute("block_sender", { email: "x@y.com" })
      ).rejects.toThrow("Gmail block_sender failed: filter limit reached");
    });
  });

  // -------- unsubscribe --------

  describe("unsubscribe", () => {
    it("returns URL when List-Unsubscribe contains https link", async () => {
      mockMessagesGet.mockResolvedValue({
        data: {
          payload: {
            headers: [
              {
                name: "List-Unsubscribe",
                value: "<https://example.com/unsub?token=abc123>",
              },
            ],
          },
        },
      });

      const result = (await handler.execute("unsubscribe", {
        message_id: "msg-unsub-1",
      })) as Record<string, unknown>;

      expect(result.found).toBe(true);
      expect(result.method).toBe("url");
      expect(result.url).toBe("https://example.com/unsub?token=abc123");
      expect(result.action).toBe("Visit this URL to complete unsubscription");
    });

    it("returns mailto when List-Unsubscribe contains mailto", async () => {
      mockMessagesGet.mockResolvedValue({
        data: {
          payload: {
            headers: [
              {
                name: "List-Unsubscribe",
                value: "<mailto:unsub@lists.example.com>",
              },
            ],
          },
        },
      });

      const result = (await handler.execute("unsubscribe", {
        message_id: "msg-unsub-2",
      })) as Record<string, unknown>;

      expect(result.found).toBe(true);
      expect(result.method).toBe("mailto");
      expect(result.email).toBe("unsub@lists.example.com");
      expect(result.action).toBe(
        "Send email to this address to unsubscribe"
      );
    });

    it("returns found:false when no List-Unsubscribe header", async () => {
      mockMessagesGet.mockResolvedValue({
        data: {
          payload: {
            headers: [{ name: "Subject", value: "Newsletter #42" }],
          },
        },
      });

      const result = (await handler.execute("unsubscribe", {
        message_id: "msg-nosub",
      })) as Record<string, unknown>;

      expect(result.found).toBe(false);
      expect(result.reason).toBe("No List-Unsubscribe header found");
      // Should NOT have the old misleading field
      expect(result).not.toHaveProperty("unsubscribed");
    });

    it("requires message_id parameter", async () => {
      await expect(handler.execute("unsubscribe", {})).rejects.toThrow(
        "Missing required parameter: message_id for unsubscribe"
      );
    });

    it("wraps API errors with sanitized message", async () => {
      mockMessagesGet.mockRejectedValue(new Error("message not found"));

      await expect(
        handler.execute("unsubscribe", { message_id: "gone" })
      ).rejects.toThrow("Gmail unsubscribe failed: message not found");
    });
  });

  // -------- unknown action --------

  it("throws on unknown action", async () => {
    await expect(
      handler.execute("nonexistent_action", {})
    ).rejects.toThrow("Unknown Gmail action: nonexistent_action");
  });
});
