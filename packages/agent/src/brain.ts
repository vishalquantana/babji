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
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface LlmClient {
  chat(messages: ChatMessage[], tools?: Record<string, unknown>): Promise<LlmResponse>;
}

export interface ToolExecutor {
  execute(toolCall: ToolCall): Promise<ToolResult>;
}

interface ProcessInput {
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTurns: number;
  tools?: Record<string, unknown>;
}

export interface MediaResult {
  type: "image";
  url: string;
  base64?: string;
  mimeType: string;
}

interface ProcessOutput {
  content: string;
  toolCallsMade: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    llmCalls: number;
  };
  media?: MediaResult[];
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
    const mediaResults: MediaResult[] = [];
    const usageAccum = { inputTokens: 0, outputTokens: 0, totalTokens: 0, llmCalls: 0 };

    for (let turn = 0; turn < input.maxTurns; turn++) {
      // On the last turn, don't offer tools so the LLM must produce a text response
      const isLastTurn = turn === input.maxTurns - 1;
      const toolsForTurn = isLastTurn ? undefined : input.tools;

      let response;
      try {
        response = await this.llm.chat(messages, toolsForTurn);
      } catch (err) {
        console.error(`[Brain] LLM call failed on turn ${turn}:`, err);
        return {
          content:
            "I'm having trouble thinking right now. Please try again in a moment.",
          toolCallsMade: allToolCalls,
          usage: usageAccum,
        };
      }

      if (response.usage) {
        usageAccum.inputTokens += response.usage.inputTokens;
        usageAccum.outputTokens += response.usage.outputTokens;
        usageAccum.totalTokens += response.usage.totalTokens;
      }
      usageAccum.llmCalls++;

      console.log(`[Brain] Turn ${turn}: text=${(response.content ?? "").length}chars, toolCalls=${response.toolCalls.length}`);

      if (response.toolCalls.length === 0) {
        return { content: response.content, toolCallsMade: allToolCalls, usage: usageAccum, media: mediaResults.length > 0 ? mediaResults : undefined };
      }

      // Execute tool calls and collect results
      const resultSummaries: string[] = [];
      for (const toolCall of response.toolCalls) {
        console.log(`[Brain] Tool call: ${toolCall.skillName}.${toolCall.actionName}`, JSON.stringify(toolCall.parameters));
        allToolCalls.push(toolCall);
        const result = await this.toolExecutor.execute(toolCall);
        console.log(`[Brain] Tool result: success=${result.success}${result.error ? ` error=${result.error}` : ""} resultSize=${JSON.stringify(result.result ?? null).length}`);

        if (result.success) {
          // Extract image media from tool results
          if (typeof result.result === "object" && result.result !== null) {
            const r = result.result as Record<string, unknown>;
            if (r.image_url || r.image_base64) {
              mediaResults.push({
                type: "image",
                url: (r.image_url as string) || "",
                base64: r.image_base64 as string | undefined,
                mimeType: (r.mime_type as string) || "image/png",
              });
            }
          }

          // Truncate large results to avoid blowing up context
          // Strip image_base64 from the result before serializing (too large for context)
          let resultForContext = result.result;
          if (typeof result.result === "object" && result.result !== null && "image_base64" in (result.result as Record<string, unknown>)) {
            const { image_base64, ...rest } = result.result as Record<string, unknown>;
            resultForContext = { ...rest, image_delivered: true };
          }
          const resultJson = JSON.stringify(resultForContext ?? null, null, 2);
          const truncated = resultJson.length > 4000
            ? resultJson.slice(0, 4000) + "\n...(truncated)"
            : resultJson;
          resultSummaries.push(
            `[${toolCall.skillName}.${toolCall.actionName}] Result:\n${truncated}`
          );
        } else {
          resultSummaries.push(
            `[${toolCall.skillName}.${toolCall.actionName}] ERROR: ${result.error}\nIMPORTANT: This tool call FAILED. Do NOT tell the user you found "nothing" or "no results". Tell them about this error and offer to help fix it.`
          );
        }
      }

      // Feed tool results back as a user message so we avoid complex
      // multi-part assistant/tool message formatting for the AI SDK
      if (response.content) {
        messages.push({ role: "assistant", content: response.content });
      }
      messages.push({
        role: "user",
        content: `Here are the results of the actions you requested:\n\n${resultSummaries.join("\n\n")}\n\nBased on these results, write your final response to the user. Do NOT call any more tools — just summarize what you found.`,
      });
    }

    return {
      content: "I ran out of thinking steps. Let me try a different approach.",
      toolCallsMade: allToolCalls,
      usage: usageAccum,
      media: mediaResults.length > 0 ? mediaResults : undefined,
    };
  }
}
