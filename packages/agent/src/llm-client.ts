import { generateText, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ToolCall } from "@babji/types";

type Provider = "anthropic" | "openai" | "google";

interface LlmConfig {
  primaryProvider: Provider;
  fallbackProviders: Provider[];
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
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
        return google("gemini-3-flash-preview");
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

  async chat(messages: ChatMessage[]): Promise<LlmResponse> {
    const providers = [this.config.primaryProvider, ...this.config.fallbackProviders]
      .filter((p) => this.hasKey(p));

    if (providers.length === 0) {
      throw new Error("No LLM providers configured with API keys");
    }

    for (const provider of providers) {
      try {
        const model = this.getModel(provider);
        const modelMessages: ModelMessage[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        })) as ModelMessage[];

        const result = await generateText({
          model,
          messages: modelMessages,
        });

        return {
          content: result.text,
          toolCalls: [],
        };
      } catch (err) {
        console.error(`LLM provider ${provider} failed:`, err);
        continue;
      }
    }

    throw new Error("All LLM providers failed");
  }
}
