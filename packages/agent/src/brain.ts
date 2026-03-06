import type { ToolCall, ToolResult } from "@babji/types";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

interface LlmResponse {
  content: string;
  toolCalls: ToolCall[];
}

export interface LlmClient {
  chat(messages: ChatMessage[]): Promise<LlmResponse>;
}

export interface ToolExecutor {
  execute(toolCall: ToolCall): Promise<ToolResult>;
}

interface ProcessInput {
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTurns: number;
}

interface ProcessOutput {
  content: string;
  toolCallsMade: ToolCall[];
}

export class Brain {
  constructor(
    private llm: LlmClient,
    private toolExecutor: ToolExecutor
  ) {}

  async process(input: ProcessInput): Promise<ProcessOutput> {
    const messages: ChatMessage[] = [
      { role: "system", content: input.systemPrompt },
      ...input.messages,
    ];

    const allToolCalls: ToolCall[] = [];

    for (let turn = 0; turn < input.maxTurns; turn++) {
      let response;
      try {
        response = await this.llm.chat(messages);
      } catch (err) {
        // LLM call failed — return a user-friendly fallback
        return {
          content:
            "I'm having trouble thinking right now. Please try again in a moment.",
          toolCallsMade: allToolCalls,
        };
      }

      if (response.toolCalls.length === 0) {
        return { content: response.content, toolCallsMade: allToolCalls };
      }

      messages.push({
        role: "assistant",
        content: response.content || "",
        toolCalls: response.toolCalls,
      });

      for (const toolCall of response.toolCalls) {
        allToolCalls.push(toolCall);
        const result = await this.toolExecutor.execute(toolCall);
        messages.push({
          role: "tool",
          content: JSON.stringify(result.result),
          toolCallId: toolCall.id,
        });
      }
    }

    return {
      content: "I ran out of thinking steps. Let me try a different approach.",
      toolCallsMade: allToolCalls,
    };
  }
}
