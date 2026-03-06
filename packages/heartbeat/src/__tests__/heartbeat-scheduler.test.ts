import { describe, it, expect, vi } from "vitest";
import { HeartbeatScheduler } from "../heartbeat-scheduler.js";

describe("HeartbeatScheduler", () => {
  const baseConfig = {
    tenantId: "t1",
    intervalMinutes: 30,
    activeHoursStart: 9,
    activeHoursEnd: 17,
    timezone: "UTC",
    instructions: "Check emails",
  };

  it("skips heartbeat outside active hours", async () => {
    const mockBrain = { process: vi.fn() };
    const mockMemory = {
      readSoul: vi.fn().mockResolvedValue("You are Babji"),
      readMemory: vi.fn().mockResolvedValue(""),
    };

    const scheduler = new HeartbeatScheduler(mockBrain as any, mockMemory as any);

    const result = await scheduler.runHeartbeat(baseConfig, 3); // 3 AM - outside active hours

    expect(result).toEqual({ status: "skipped" });
    expect(mockBrain.process).not.toHaveBeenCalled();
  });

  it("runs heartbeat during active hours and returns ok", async () => {
    const mockBrain = {
      process: vi.fn().mockResolvedValue({
        content: "HEARTBEAT_OK",
        toolCallsMade: [],
      }),
    };
    const mockMemory = {
      readSoul: vi.fn().mockResolvedValue("You are Babji"),
      readMemory: vi.fn().mockResolvedValue(""),
    };

    const scheduler = new HeartbeatScheduler(mockBrain as any, mockMemory as any);

    const result = await scheduler.runHeartbeat(baseConfig, 12); // Noon - inside active hours

    expect(result).toEqual({ status: "ok" });
    expect(mockBrain.process).toHaveBeenCalled();
  });

  it("returns notification_sent with message when brain has something for the user", async () => {
    const notificationMessage = "You have 3 unread emails that need your attention.";
    const mockBrain = {
      process: vi.fn().mockResolvedValue({
        content: notificationMessage,
        toolCallsMade: [],
      }),
    };
    const mockMemory = {
      readSoul: vi.fn().mockResolvedValue("You are Babji"),
      readMemory: vi.fn().mockResolvedValue(""),
    };

    const scheduler = new HeartbeatScheduler(mockBrain as any, mockMemory as any);

    const result = await scheduler.runHeartbeat(baseConfig, 12);

    expect(result).toEqual({
      status: "notification_sent",
      message: notificationMessage,
    });
  });

  it("returns error result when brain.process throws", async () => {
    const mockBrain = {
      process: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    };
    const mockMemory = {
      readSoul: vi.fn().mockResolvedValue("You are Babji"),
      readMemory: vi.fn().mockResolvedValue(""),
    };

    const scheduler = new HeartbeatScheduler(mockBrain as any, mockMemory as any);

    const result = await scheduler.runHeartbeat(baseConfig, 12);

    expect(result).toEqual({ status: "error", error: "LLM timeout" });
  });

  it("returns error result when memory read throws", async () => {
    const mockBrain = { process: vi.fn() };
    const mockMemory = {
      readSoul: vi.fn().mockRejectedValue(new Error("storage unavailable")),
      readMemory: vi.fn().mockResolvedValue(""),
    };

    const scheduler = new HeartbeatScheduler(mockBrain as any, mockMemory as any);

    const result = await scheduler.runHeartbeat(baseConfig, 12);

    expect(result).toEqual({ status: "error", error: "storage unavailable" });
    expect(mockBrain.process).not.toHaveBeenCalled();
  });

  it("treats activeHoursStart as inclusive (hour 9 is inside when start=9)", async () => {
    const mockBrain = {
      process: vi.fn().mockResolvedValue({
        content: "HEARTBEAT_OK",
        toolCallsMade: [],
      }),
    };
    const mockMemory = {
      readSoul: vi.fn().mockResolvedValue("You are Babji"),
      readMemory: vi.fn().mockResolvedValue(""),
    };

    const scheduler = new HeartbeatScheduler(mockBrain as any, mockMemory as any);

    const result = await scheduler.runHeartbeat(baseConfig, 9); // start boundary

    expect(result).toEqual({ status: "ok" });
    expect(mockBrain.process).toHaveBeenCalled();
  });

  it("treats activeHoursEnd as exclusive (hour 17 is outside when end=17)", async () => {
    const mockBrain = { process: vi.fn() };
    const mockMemory = {
      readSoul: vi.fn().mockResolvedValue("You are Babji"),
      readMemory: vi.fn().mockResolvedValue(""),
    };

    const scheduler = new HeartbeatScheduler(mockBrain as any, mockMemory as any);

    const result = await scheduler.runHeartbeat(baseConfig, 17); // end boundary

    expect(result).toEqual({ status: "skipped" });
    expect(mockBrain.process).not.toHaveBeenCalled();
  });
});
