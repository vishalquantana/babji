import { describe, it, expect, vi } from "vitest";
import { HeartbeatScheduler } from "../heartbeat-scheduler.js";

describe("HeartbeatScheduler", () => {
  it("skips heartbeat outside active hours", async () => {
    const mockBrain = { process: vi.fn() };
    const mockMemory = {
      readHeartbeat: vi.fn().mockResolvedValue("Check emails"),
      readSoul: vi.fn().mockResolvedValue("You are Babji"),
      readMemory: vi.fn().mockResolvedValue(""),
    };

    const scheduler = new HeartbeatScheduler(mockBrain as any, mockMemory as any);

    const result = await scheduler.runHeartbeat({
      tenantId: "t1",
      intervalMinutes: 30,
      activeHoursStart: 9,
      activeHoursEnd: 17,
      timezone: "UTC",
      instructions: "Check emails",
    }, 3); // 3 AM - outside active hours

    expect(result).toBe("skipped");
    expect(mockBrain.process).not.toHaveBeenCalled();
  });

  it("runs heartbeat during active hours", async () => {
    const mockBrain = {
      process: vi.fn().mockResolvedValue({
        content: "HEARTBEAT_OK",
        toolCallsMade: [],
      }),
    };
    const mockMemory = {
      readHeartbeat: vi.fn().mockResolvedValue("Check emails"),
      readSoul: vi.fn().mockResolvedValue("You are Babji"),
      readMemory: vi.fn().mockResolvedValue(""),
    };

    const scheduler = new HeartbeatScheduler(mockBrain as any, mockMemory as any);

    const result = await scheduler.runHeartbeat({
      tenantId: "t1",
      intervalMinutes: 30,
      activeHoursStart: 9,
      activeHoursEnd: 17,
      timezone: "UTC",
      instructions: "Check emails",
    }, 12); // Noon - inside active hours

    expect(result).toBe("ok");
    expect(mockBrain.process).toHaveBeenCalled();
  });
});
