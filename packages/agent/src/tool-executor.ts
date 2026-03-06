import type { ToolCall, ToolResult } from "@babji/types";

export interface SkillHandler {
  execute(actionName: string, parameters: Record<string, unknown>): Promise<unknown>;
}

export class ToolExecutor {
  private handlers = new Map<string, SkillHandler>();

  registerSkill(skillName: string, handler: SkillHandler): void {
    this.handlers.set(skillName, handler);
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const handler = this.handlers.get(toolCall.skillName);
    if (!handler) {
      return {
        toolCallId: toolCall.id,
        success: false,
        result: undefined,
        error: `Skill "${toolCall.skillName}" not available. It may need to be connected first.`,
      };
    }

    try {
      const result = await handler.execute(toolCall.actionName, toolCall.parameters);
      return { toolCallId: toolCall.id, success: true, result };
    } catch (err) {
      return {
        toolCallId: toolCall.id,
        success: false,
        result: undefined,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }
}
