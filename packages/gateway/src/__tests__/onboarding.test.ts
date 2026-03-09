import { describe, it, expect, vi } from "vitest";
import { OnboardingHandler } from "../onboarding.js";
import type { BabjiMessage } from "@babji/types";

function makeDeps() {
  return {
    db: {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    },
    memory: {
      initialize: vi.fn().mockResolvedValue(undefined),
    },
    credits: {
      initializeForTenant: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeMessage(overrides: Partial<BabjiMessage> = {}): BabjiMessage {
  return {
    id: "msg-1",
    tenantId: "",
    channel: "whatsapp",
    sender: "+1234567890",
    text: "",
    timestamp: new Date(),
    ...overrides,
  };
}

describe("OnboardingHandler", () => {
  // ── Welcome prompt ────────────────────────────────────────────────

  it("sends welcome message for empty text", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(makeMessage({ text: "" }));

    expect(result.text).toContain("I'm Babji");
    expect(result.text).toContain("What should I call you");
    expect(result.channel).toBe("whatsapp");
    expect(result.recipient).toBe("+1234567890");
    expect(result.tenantId).toBe("onboarding");
  });

  it("sends welcome message when text is only whitespace", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(makeMessage({ text: "   " }));

    expect(result.text).toContain("What should I call you");
  });

  // ── Successful onboarding ─────────────────────────────────────────

  it("creates tenant when a valid name is provided via WhatsApp", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(
      makeMessage({ text: "John", channel: "whatsapp", sender: "+1234567890" }),
    );

    expect(result.text).toContain("John");
    expect(result.text).toContain("what kind of work");
    expect(deps.db.insert).toHaveBeenCalled();

    // Verify insert().values() was called with correct shape
    const valuesCall = deps.db.insert.mock.results[0].value.values;
    const insertedData = valuesCall.mock.calls[0][0];
    expect(insertedData.name).toBe("John");
    expect(insertedData.phone).toBe("+1234567890");
    expect(insertedData.telegramUserId).toBeNull();
    expect(insertedData.plan).toBe("free");
    expect(insertedData.timezone).toBe("UTC");

    expect(deps.memory.initialize).toHaveBeenCalledOnce();
    expect(deps.credits.initializeForTenant).toHaveBeenCalledOnce();
  });

  it("creates tenant for Telegram users with telegramUserId", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(
      makeMessage({ text: "Sarah", channel: "telegram", sender: "tg-123456" }),
    );

    expect(result.text).toContain("Sarah");
    expect(result.text).toContain("what kind of work");
    expect(result.text).not.toContain("phone");

    const valuesCall = deps.db.insert.mock.results[0].value.values;
    const insertedData = valuesCall.mock.calls[0][0];
    expect(insertedData.phone).toBeNull();
    expect(insertedData.telegramUserId).toBe("tg-123456");

    expect(deps.memory.initialize).toHaveBeenCalledOnce();
    expect(deps.credits.initializeForTenant).toHaveBeenCalledOnce();
  });

  it("handles multi-word names", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(makeMessage({ text: "Maria Garcia" }));

    expect(result.text).toContain("Maria Garcia");

    const valuesCall = deps.db.insert.mock.results[0].value.values;
    const insertedData = valuesCall.mock.calls[0][0];
    expect(insertedData.name).toBe("Maria Garcia");
  });

  // ── Name validation edge cases ────────────────────────────────────

  it("rejects single-character input as a name", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(makeMessage({ text: "A" }));

    expect(result.text).toContain("What should I call you");
    expect(deps.db.insert).not.toHaveBeenCalled();
  });

  it("rejects purely numeric input as a name", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(makeMessage({ text: "12345" }));

    expect(result.text).toContain("What should I call you");
    expect(deps.db.insert).not.toHaveBeenCalled();
  });

  it("accepts a two-character name", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(makeMessage({ text: "Al" }));

    expect(result.text).toContain("Al");
    expect(deps.db.insert).toHaveBeenCalled();
  });

  // ── Reply envelope ────────────────────────────────────────────────

  it("uses 'onboarding' as the tenantId in replies", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(makeMessage({ text: "" }));

    expect(result.tenantId).toBe("onboarding");
  });

  it("directs the reply back to the original sender", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(
      makeMessage({ sender: "+9876543210", text: "Bob" }),
    );

    expect(result.recipient).toBe("+9876543210");
  });

  it("onboarded message asks about work, not credits or phone", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(
      makeMessage({ text: "Priya", channel: "telegram", sender: "tg-999" }),
    );

    expect(result.text).toContain("Priya");
    expect(result.text).toContain("what kind of work");
    expect(result.text).not.toContain("credit");
    expect(result.text).not.toContain("juice");
    expect(result.text).not.toContain("phone");
  });

  it("deflects when user asks a question instead of giving a name", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(
      makeMessage({ text: "How can you make my daily work easier" }),
    );

    expect(result.text).toContain("help with that");
    expect(result.text).toContain("name");
    expect(deps.db.insert).not.toHaveBeenCalled();
  });

  it("deflects when user asks a question with question mark", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(
      makeMessage({ text: "What can you do?" }),
    );

    expect(result.text).toContain("help with that");
    expect(result.text).toContain("name");
    expect(deps.db.insert).not.toHaveBeenCalled();
  });

  it("rejects long phrases as names", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    const result = await handler.handle(
      makeMessage({ text: "I want to know what you can do for me" }),
    );

    expect(deps.db.insert).not.toHaveBeenCalled();
  });

  it("sets onboardingPhase to 'role' when creating tenant", async () => {
    const deps = makeDeps();
    const handler = new OnboardingHandler(deps as any);

    await handler.handle(
      makeMessage({ text: "Raj", channel: "telegram", sender: "tg-100" }),
    );

    const valuesCall = deps.db.insert.mock.results[0].value.values;
    const insertedData = valuesCall.mock.calls[0][0];
    expect(insertedData.onboardingPhase).toBe("role");
  });
});
