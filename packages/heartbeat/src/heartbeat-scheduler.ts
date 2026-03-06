import type { HeartbeatConfig, HeartbeatResult } from "@babji/types";
import type { Brain } from "@babji/agent";
import type { MemoryManager } from "@babji/memory";

export class HeartbeatScheduler {
  constructor(
    private brain: Brain,
    private memory: MemoryManager
  ) {}

  async runHeartbeat(
    config: HeartbeatConfig,
    currentHour?: number
  ): Promise<HeartbeatResult | "skipped"> {
    const hour = currentHour ?? new Date().getHours();

    if (hour < config.activeHoursStart || hour >= config.activeHoursEnd) {
      return "skipped";
    }

    const soul = await this.memory.readSoul(config.tenantId);
    const memoryContent = await this.memory.readMemory(config.tenantId);

    const systemPrompt = [
      soul,
      "\n## Heartbeat Check",
      "You are running a scheduled check. Review the instructions below and your connected services.",
      "If nothing needs the user's attention, respond with exactly: HEARTBEAT_OK",
      "If something needs attention, write a brief, friendly message to the user.",
      "\n## Instructions",
      config.instructions,
      "\n## Memory",
      memoryContent,
    ].join("\n");

    const result = await this.brain.process({
      systemPrompt,
      messages: [
        { role: "user", content: "[HEARTBEAT CHECK - automated, not a user message]" },
      ],
      maxTurns: 3,
    });

    if (result.content.includes("HEARTBEAT_OK")) {
      return "ok";
    }

    return "notification_sent";
  }
}
