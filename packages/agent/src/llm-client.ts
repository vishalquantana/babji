import { generateText, jsonSchema, type ModelMessage, type JSONSchema7 } from "ai";
import type { Tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ToolCall, SkillDefinition } from "@babji/types";

type Provider = "anthropic" | "openai" | "google";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AiTool = Tool<any, any>;
type AiToolRecord = Record<string, AiTool>;

interface LlmConfig {
  primaryProvider: Provider;
  fallbackProviders: Provider[];
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  /** Override the default model for this provider (e.g. "gemini-3-1-flash-lite") */
  googleModelOverride?: string;
}

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

/** Separator used in tool names: skillName__actionName */
const TOOL_NAME_SEP = "__";

/**
 * Convert SkillDefinition[] into the Vercel AI SDK `tools` record.
 * Each action becomes a tool named `${skill.name}__${action.name}`.
 */
export function skillsToAiTools(skills: SkillDefinition[]): AiToolRecord {
  const tools: AiToolRecord = {};

  for (const skill of skills) {
    for (const action of skill.actions) {
      const toolName = `${skill.name}${TOOL_NAME_SEP}${action.name}`;

      // Build JSON Schema properties from SkillParameter definitions
      const properties: Record<string, JSONSchema7> = {};
      const required: string[] = [];

      for (const [paramName, param] of Object.entries(action.parameters)) {
        const prop: JSONSchema7 = param.type === "array"
          ? { type: "array", items: { type: param.items?.type ?? "string" } }
          : { type: param.type };
        if (param.description) prop.description = param.description;
        properties[paramName] = prop;
        if (param.required) {
          required.push(paramName);
        }
      }

      const schema: JSONSchema7 = {
        type: "object" as const,
        properties,
        ...(required.length > 0 ? { required } : {}),
      };

      tools[toolName] = {
        description: `[${skill.displayName}] ${action.description}`,
        inputSchema: jsonSchema(schema),
      };
    }
  }

  return tools;
}

/**
 * Parse an AI SDK tool call (toolName = "gmail__list_emails") into our ToolCall type.
 */
function parseAiToolCall(tc: { toolCallId: string; toolName: string; input: unknown }): ToolCall {
  const sepIdx = tc.toolName.indexOf(TOOL_NAME_SEP);
  const skillName = sepIdx >= 0 ? tc.toolName.slice(0, sepIdx) : tc.toolName;
  const actionName = sepIdx >= 0 ? tc.toolName.slice(sepIdx + TOOL_NAME_SEP.length) : tc.toolName;

  return {
    id: tc.toolCallId,
    skillName,
    actionName,
    parameters: (tc.input as Record<string, unknown>) ?? {},
  };
}

export class MultiModelLlmClient {
  private config: LlmConfig;

  constructor(config: LlmConfig) {
    this.config = config;
  }

  private getModel(provider: Provider) {
    switch (provider) {
      case "anthropic": {
        const anthropic = createAnthropic({ apiKey: this.config.anthropicApiKey });
        return anthropic("claude-sonnet-4-20250514");
      }
      case "openai": {
        const openai = createOpenAI({ apiKey: this.config.openaiApiKey });
        return openai("gpt-4o");
      }
      case "google": {
        const google = createGoogleGenerativeAI({ apiKey: this.config.googleApiKey });
        return google(this.config.googleModelOverride || process.env.GOOGLE_MODEL || "gemini-3-flash-preview");
      }
    }
  }

  private hasKey(provider: Provider): boolean {
    switch (provider) {
      case "anthropic": return !!this.config.anthropicApiKey;
      case "openai": return !!this.config.openaiApiKey;
      case "google": return !!this.config.googleApiKey;
    }
  }

  async chat(
    messages: ChatMessage[],
    tools?: AiToolRecord,
  ): Promise<LlmResponse> {
    const providers = [this.config.primaryProvider, ...this.config.fallbackProviders]
      .filter((p) => this.hasKey(p));

    if (providers.length === 0) {
      throw new Error("No LLM providers configured with API keys");
    }

    for (const provider of providers) {
      try {
        const model = this.getModel(provider);

        // Since Brain now feeds tool results back as plain user messages,
        // we only ever have system/user/assistant roles — simple cast works.
        const modelMessages = messages.map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content,
        })) as ModelMessage[];

        const result = await generateText({
          model,
          messages: modelMessages,
          ...(tools && Object.keys(tools).length > 0 ? { tools } : {}),
        });

        // Map AI SDK tool calls to our ToolCall type
        const toolCalls: ToolCall[] = (result.toolCalls ?? []).map((tc) =>
          parseAiToolCall(tc as unknown as { toolCallId: string; toolName: string; input: unknown }),
        );

        return {
          content: result.text,
          toolCalls,
          usage: result.usage ? {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            totalTokens: result.usage.totalTokens ?? 0,
          } : undefined,
        };
      } catch (err) {
        console.error(`LLM provider ${provider} failed:`, err);
        continue;
      }
    }

    throw new Error("All LLM providers failed");
  }
}
