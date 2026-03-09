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
      const rawMessage = err instanceof Error ? err.message : "Unknown error";
      let error = rawMessage;

      // Detect common error patterns and provide actionable messages
      const lower = rawMessage.toLowerCase();
      if (
        lower.includes("401") ||
        lower.includes("unauthorized") ||
        lower.includes("invalid_grant") ||
        (lower.includes("token") && lower.includes("expired"))
      ) {
        error = `Authentication failed for ${toolCall.skillName}. The service connection may have expired. The user should reconnect by saying "connect ${toolCall.skillName}". Original error: ${rawMessage}`;
      } else if (
        lower.includes("403") ||
        lower.includes("forbidden") ||
        lower.includes("permission")
      ) {
        error = `Permission denied for ${toolCall.skillName}. The connected account may not have the required permissions. Original error: ${rawMessage}`;
      } else if (
        lower.includes("429") ||
        lower.includes("rate limit") ||
        lower.includes("quota")
      ) {
        error = `Rate limit hit for ${toolCall.skillName}. Try again in a moment. Original error: ${rawMessage}`;
      }

      return {
        toolCallId: toolCall.id,
        success: false,
        result: undefined,
        error,
      };
    }
  }
}
