import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageHandler } from "../message-handler.js";
import type { BabjiMessage } from "@babji/types";

// ── Helpers ──────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<BabjiMessage> = {}): BabjiMessage {
  return {
    id: "msg-1",
    tenantId: "",
    channel: "whatsapp",
    sender: "+1234567890",
    text: "Hello",
    timestamp: new Date(),
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    memory: {
      readSoul: vi.fn().mockResolvedValue("You are Babji."),
      readMemory: vi.fn().mockResolvedValue(""),
    },
    sessions: {
      append: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockResolvedValue([
        { role: "user", content: "Hello", timestamp: new Date() },
      ]),
    },
    credits: {
      hasCredits: vi.fn().mockResolvedValue(true),
      deduct: vi.fn().mockResolvedValue(undefined),
      getDailyFreeAmount: vi.fn().mockResolvedValue(100),
      getBalance: vi.fn().mockResolvedValue({ tenantId: "", dailyFree: 100, prepaid: 0, proMonthly: 0, total: 100 }),
    },
    llm: {
      chat: vi.fn().mockResolvedValue({
        content: "Hi there! How can I help?",
        toolCalls: [],
      }),
    },
    availableSkills: [],
    tenantResolver: {
      resolveByPhone: vi.fn().mockResolvedValue(null),
      resolveByTelegramId: vi.fn().mockResolvedValue(null),
    },
    onboarding: {
      handle: vi.fn().mockResolvedValue({
        tenantId: "onboarding",
        channel: "whatsapp",
        recipient: "+1234567890",
        text: "Hey there! I'm Babji. What should I call you?",
      }),
    },
    skillRequests: {
      create: vi.fn(),
      list: vi.fn(),
    },
    db: {
      query: {
        serviceConnections: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    },
    vault: {
      retrieve: vi.fn().mockResolvedValue(null),
      store: vi.fn().mockResolvedValue(undefined),
    },
    oauthPortalUrl: "https://auth.babji.ai",
    googleClientId: "test-client-id",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("E2E message pipeline", () => {
  // 1. Unknown sender -> onboarding flow
  describe("unknown sender", () => {
    it("routes to onboarding when tenant is not found", async () => {
      const deps = makeDeps();
      const handler = new MessageHandler(deps as any);

      const result = await handler.handle(makeMessage());

      expect(deps.tenantResolver.resolveByPhone).toHaveBeenCalledWith("+1234567890");
      expect(deps.onboarding.handle).toHaveBeenCalled();
      expect(result.tenantId).toBe("onboarding");
      expect(result.text).toContain("Babji");
    });

    it("routes telegram unknown sender to onboarding", async () => {
      const deps = makeDeps();
      const handler = new MessageHandler(deps as any);

      const result = await handler.handle(
        makeMessage({ channel: "telegram", sender: "tg-999" }),
      );

      expect(deps.tenantResolver.resolveByTelegramId).toHaveBeenCalledWith("tg-999");
      expect(deps.onboarding.handle).toHaveBeenCalled();
      expect(result.tenantId).toBe("onboarding");
    });
  });

  // 2. Known sender -> Brain processes -> response returned
  describe("known sender", () => {
    it("processes message through the Brain and returns response", async () => {
      const deps = makeDeps({
        tenantResolver: {
          resolveByPhone: vi.fn().mockResolvedValue({ id: "tenant-123" }),
          resolveByTelegramId: vi.fn(),
        },
      });
      const handler = new MessageHandler(deps as any);

      const result = await handler.handle(makeMessage({ text: "Hello Babji" }));

      expect(result.tenantId).toBe("tenant-123");
      expect(result.text).toBe("Hi there! How can I help?");
      expect(result.channel).toBe("whatsapp");
      expect(result.recipient).toBe("+1234567890");

      // Session history should be updated
      expect(deps.sessions.append).toHaveBeenCalledTimes(2); // user + assistant
      expect(deps.memory.readSoul).toHaveBeenCalledWith("tenant-123");
      expect(deps.memory.readMemory).toHaveBeenCalledWith("tenant-123");
    });
  });

  // 3. Tool call made -> credit deduction
  describe("tool calls and credits", () => {
    it("deducts credits when brain makes tool calls", async () => {
      const deps = makeDeps({
        tenantResolver: {
          resolveByPhone: vi.fn().mockResolvedValue({ id: "tenant-123" }),
          resolveByTelegramId: vi.fn(),
        },
        llm: {
          chat: vi
            .fn()
            .mockResolvedValueOnce({
              content: "",
              toolCalls: [
                { id: "tc-1", skillName: "gmail", actionName: "list_emails", parameters: {} },
              ],
            })
            .mockResolvedValueOnce({
              content: "You have 3 emails.",
              toolCalls: [],
            }),
        },
      });
      const handler = new MessageHandler(deps as any);

      const result = await handler.handle(makeMessage({ text: "Check my email" }));

      expect(result.text).toBe("You have 3 emails.");
      expect(deps.credits.hasCredits).toHaveBeenCalledWith("tenant-123", 1);
      expect(deps.credits.deduct).toHaveBeenCalledWith(
        "tenant-123",
        1,
        expect.stringContaining("list_emails"),
      );
    });

    it("skips deduction when tenant has no credits", async () => {
      const deps = makeDeps({
        tenantResolver: {
          resolveByPhone: vi.fn().mockResolvedValue({ id: "tenant-456" }),
          resolveByTelegramId: vi.fn(),
        },
        credits: {
          hasCredits: vi.fn().mockResolvedValue(false),
          deduct: vi.fn(),
          getDailyFreeAmount: vi.fn().mockResolvedValue(100),
          getBalance: vi.fn().mockResolvedValue({ tenantId: "", dailyFree: 0, prepaid: 0, proMonthly: 0, total: 0 }),
        },
        llm: {
          chat: vi
            .fn()
            .mockResolvedValueOnce({
              content: "",
              toolCalls: [
                { id: "tc-1", skillName: "gmail", actionName: "send_email", parameters: {} },
              ],
            })
            .mockResolvedValueOnce({
              content: "Email sent!",
              toolCalls: [],
            }),
        },
      });
      const handler = new MessageHandler(deps as any);

      await handler.handle(makeMessage());

      expect(deps.credits.hasCredits).toHaveBeenCalled();
      expect(deps.credits.deduct).not.toHaveBeenCalled();
    });
  });

  // 4. Error in brain -> graceful fallback message
  describe("error handling", () => {
    it("returns graceful fallback when brain processing throws", async () => {
      const deps = makeDeps({
        tenantResolver: {
          resolveByPhone: vi.fn().mockResolvedValue({ id: "tenant-123" }),
          resolveByTelegramId: vi.fn(),
        },
        llm: {
          chat: vi.fn().mockRejectedValue(new Error("LLM API timeout")),
        },
      });
      const handler = new MessageHandler(deps as any);

      const result = await handler.handle(makeMessage());

      // Brain catches the LLM error and returns fallback text,
      // which the handler then returns as the response
      expect(result.text).toBeDefined();
      expect(result.recipient).toBe("+1234567890");
      expect(result.channel).toBe("whatsapp");
    });

    it("returns fallback when session store throws", async () => {
      const deps = makeDeps({
        tenantResolver: {
          resolveByPhone: vi.fn().mockResolvedValue({ id: "tenant-123" }),
          resolveByTelegramId: vi.fn(),
        },
        sessions: {
          append: vi.fn().mockRejectedValue(new Error("Disk full")),
          getHistory: vi.fn(),
        },
      });
      const handler = new MessageHandler(deps as any);

      const result = await handler.handle(makeMessage());

      expect(result.text).toContain("Something went wrong");
      expect(result.recipient).toBe("+1234567890");
    });
  });

  // 5. Rate limiting -> friendly rejection message
  describe("rate limiting", () => {
    it("returns rate limit message after too many requests", async () => {
      const deps = makeDeps({
        tenantResolver: {
          resolveByPhone: vi.fn().mockResolvedValue({ id: "tenant-123" }),
          resolveByTelegramId: vi.fn(),
        },
      });
      const handler = new MessageHandler(deps as any);

      // Send 30 messages (default limit) to exhaust the rate limiter
      for (let i = 0; i < 30; i++) {
        await handler.handle(makeMessage());
      }

      // 31st message should be rate limited
      const result = await handler.handle(makeMessage());

      expect(result.text).toContain("too quickly");
      expect(result.text).toContain("wait");
      expect(result.recipient).toBe("+1234567890");
    });

    it("rate limits independently per sender", async () => {
      const deps = makeDeps({
        tenantResolver: {
          resolveByPhone: vi.fn().mockResolvedValue({ id: "tenant-123" }),
          resolveByTelegramId: vi.fn(),
        },
      });
      const handler = new MessageHandler(deps as any);

      // Exhaust limit for sender A
      for (let i = 0; i < 30; i++) {
        await handler.handle(makeMessage({ sender: "+1111111111" }));
      }

      // Sender B should still be allowed
      const result = await handler.handle(makeMessage({ sender: "+2222222222" }));
      expect(result.text).not.toContain("too quickly");
    });
  });
});
