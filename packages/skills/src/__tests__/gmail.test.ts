import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock googleapis ----
const mockMessagesList = vi.fn();
const mockMessagesGet = vi.fn();
const mockMessagesSend = vi.fn();
const mockMessagesModify = vi.fn();
const mockFiltersCreate = vi.fn();
const mockFiltersDelete = vi.fn();

vi.mock("googleapis", () => {
  const gmailClient = {
    users: {
      messages: {
        list: (...args: unknown[]) => mockMessagesList(...args),
        get: (...args: unknown[]) => mockMessagesGet(...args),
        send: (...args: unknown[]) => mockMessagesSend(...args),
        modify: (...args: unknown[]) => mockMessagesModify(...args),
      },
      settings: {
        filters: {
          create: (...args: unknown[]) => mockFiltersCreate(...args),
          delete: (...args: unknown[]) => mockFiltersDelete(...args),
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

  // -------- email filter CRUD --------

  describe("create_email_filter", () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
      select: vi.fn(),
      delete: vi.fn(),
    };

    it("creates Gmail filter and saves to DB", async () => {
      mockFiltersCreate.mockResolvedValue({ data: { id: "gmail-filter-1" } });

      const dbHandler = new GmailHandler("fake-token", mockDb as never, "tenant-1");
      const result = (await dbHandler.execute("create_email_filter", {
        subject: "[JIRA]",
        action: "archive",
        description: "Auto-archive JIRA emails",
      })) as Record<string, unknown>;

      expect(result.created).toBe(true);
      expect(result.filterId).toBe("gmail-filter-1");
      expect(result.description).toBe("Auto-archive JIRA emails");
      expect(result.action).toBe("archive");

      expect(mockFiltersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "me",
          requestBody: {
            criteria: { subject: "[JIRA]" },
            action: { removeLabelIds: ["INBOX"] },
          },
        })
      );

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("supports trash action", async () => {
      mockFiltersCreate.mockResolvedValue({ data: { id: "gmail-filter-2" } });

      const dbHandler = new GmailHandler("fake-token", mockDb as never, "tenant-1");
      await dbHandler.execute("create_email_filter", {
        from: "spam@example.com",
        action: "trash",
      });

      expect(mockFiltersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: {
            criteria: { from: "spam@example.com" },
            action: { addLabelIds: ["TRASH"] },
          },
        })
      );
    });

    it("supports star action", async () => {
      mockFiltersCreate.mockResolvedValue({ data: { id: "gmail-filter-3" } });

      const dbHandler = new GmailHandler("fake-token", mockDb as never, "tenant-1");
      await dbHandler.execute("create_email_filter", {
        from: "boss@company.com",
        action: "star",
      });

      expect(mockFiltersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: {
            criteria: { from: "boss@company.com" },
            action: { addLabelIds: ["STARRED"] },
          },
        })
      );
    });

    it("supports label action with label name", async () => {
      mockFiltersCreate.mockResolvedValue({ data: { id: "gmail-filter-4" } });

      const dbHandler = new GmailHandler("fake-token", mockDb as never, "tenant-1");
      await dbHandler.execute("create_email_filter", {
        from: "updates@github.com",
        action: "label",
        label: "GitHub",
      });

      expect(mockFiltersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: {
            criteria: { from: "updates@github.com" },
            action: { addLabelIds: ["GitHub"] },
          },
        })
      );
    });

    it("requires label param when action is label", async () => {
      const dbHandler = new GmailHandler("fake-token", mockDb as never, "tenant-1");
      await expect(
        dbHandler.execute("create_email_filter", {
          from: "x@y.com",
          action: "label",
        })
      ).rejects.toThrow("'label' parameter is required when action is 'label'");
    });

    it("requires at least one criteria", async () => {
      const dbHandler = new GmailHandler("fake-token", mockDb as never, "tenant-1");
      await expect(
        dbHandler.execute("create_email_filter", { action: "archive" })
      ).rejects.toThrow("At least one filter criteria is required");
    });

    it("requires action parameter", async () => {
      await expect(
        handler.execute("create_email_filter", { from: "x@y.com" })
      ).rejects.toThrow("Missing required parameter: action for create_email_filter");
    });

    it("throws when no db is provided", async () => {
      await expect(
        handler.execute("create_email_filter", { from: "x@y.com", action: "archive" })
      ).rejects.toThrow("Email filter operations require database access");
    });
  });

  describe("list_email_filters", () => {
    it("returns filters from DB", async () => {
      const mockWhere = vi.fn().mockResolvedValue([
        {
          id: "filter-1",
          description: "Auto-archive JIRA",
          criteria: { subject: "[JIRA]" },
          actions: { removeLabelIds: ["INBOX"] },
          createdAt: new Date("2026-03-11"),
        },
      ]);
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      const mockDb = {
        insert: vi.fn(),
        select: vi.fn().mockReturnValue({ from: mockFrom }),
        delete: vi.fn(),
      };

      const dbHandler = new GmailHandler("fake-token", mockDb as never, "tenant-1");
      const result = (await dbHandler.execute("list_email_filters", {})) as {
        filters: Array<Record<string, unknown>>;
        total: number;
      };

      expect(result.total).toBe(1);
      expect(result.filters[0].id).toBe("filter-1");
      expect(result.filters[0].description).toBe("Auto-archive JIRA");
    });

    it("throws when no db is provided", async () => {
      await expect(
        handler.execute("list_email_filters", {})
      ).rejects.toThrow("Email filter operations require database access");
    });
  });

  describe("delete_email_filter", () => {
    it("deletes from Gmail and DB", async () => {
      const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
      const mockSelectThen = vi.fn().mockResolvedValue({
        id: "filter-1",
        tenantId: "tenant-1",
        gmailFilterId: "gmail-f-1",
        description: "Auto-archive JIRA",
      });
      const mockSelectWhere = vi.fn().mockReturnValue({ then: mockSelectThen });
      const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
      const mockDb = {
        insert: vi.fn(),
        select: vi.fn().mockReturnValue({ from: mockSelectFrom }),
        delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
      };
      mockFiltersDelete.mockResolvedValue({});

      const dbHandler = new GmailHandler("fake-token", mockDb as never, "tenant-1");
      const result = (await dbHandler.execute("delete_email_filter", {
        filter_id: "filter-1",
      })) as Record<string, unknown>;

      expect(result.deleted).toBe(true);
      expect(result.description).toBe("Auto-archive JIRA");
      expect(mockFiltersDelete).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "me", id: "gmail-f-1" })
      );
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("requires filter_id parameter", async () => {
      await expect(
        handler.execute("delete_email_filter", {})
      ).rejects.toThrow("Missing required parameter: filter_id for delete_email_filter");
    });

    it("throws when filter not found", async () => {
      const mockSelectThen = vi.fn().mockResolvedValue(undefined);
      const mockSelectWhere = vi.fn().mockReturnValue({ then: mockSelectThen });
      const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
      const mockDb = {
        insert: vi.fn(),
        select: vi.fn().mockReturnValue({ from: mockSelectFrom }),
        delete: vi.fn(),
      };

      const dbHandler = new GmailHandler("fake-token", mockDb as never, "tenant-1");
      await expect(
        dbHandler.execute("delete_email_filter", { filter_id: "nonexistent" })
      ).rejects.toThrow("Email filter not found");
    });
  });

  // -------- unknown action --------

  it("throws on unknown action", async () => {
    await expect(
      handler.execute("nonexistent_action", {})
    ).rejects.toThrow("Unknown Gmail action: nonexistent_action");
  });
});
