import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import { logger } from "./logger.js";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  llmCalls: number;
}

interface UsageEvent {
  tenantId: string;
  action: string;
  skillName?: string;
  channel?: string;
  creditCost?: number;
  metadata?: Record<string, unknown>;
}

export class UsageTracker {
  constructor(private db: Database) {}

  async log(event: UsageEvent): Promise<void> {
    try {
      await this.db.insert(schema.auditLog).values({
        tenantId: event.tenantId,
        action: event.action,
        skillName: event.skillName ?? null,
        channel: event.channel ?? null,
        creditCost: event.creditCost ?? 0,
        metadata: event.metadata ?? null,
      });
    } catch (err) {
      // Fire-and-forget: never let usage logging break the main flow
      logger.error({ err, event: { action: event.action, tenantId: event.tenantId } }, "Failed to log usage event");
    }
  }

  /** Log a completed message interaction with full token details */
  async logMessageProcessed(params: {
    tenantId: string;
    channel: string;
    toolCallsMade: Array<{ skillName: string; actionName: string }>;
    usage: TokenUsage;
    creditCost: number;
  }): Promise<void> {
    await this.log({
      tenantId: params.tenantId,
      action: "message_processed",
      channel: params.channel,
      creditCost: params.creditCost,
      metadata: {
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
        totalTokens: params.usage.totalTokens,
        llmCalls: params.usage.llmCalls,
        toolCalls: params.toolCallsMade.map(t => `${t.skillName}.${t.actionName}`),
        toolCallCount: params.toolCallsMade.length,
      },
    });
  }

  /** Log an external API call (DataForSEO, Scrapin, etc.) */
  async logExternalApi(params: {
    tenantId: string;
    apiName: string;
    action: string;
    success: boolean;
  }): Promise<void> {
    await this.log({
      tenantId: params.tenantId,
      action: "external_api_call",
      skillName: params.apiName,
      metadata: {
        apiAction: params.action,
        success: params.success,
      },
    });
  }

  /** Log a background job's usage */
  async logBackgroundJob(params: {
    tenantId: string;
    jobType: string;
    usage?: TokenUsage;
  }): Promise<void> {
    await this.log({
      tenantId: params.tenantId,
      action: "background_job",
      skillName: params.jobType,
      metadata: params.usage ? {
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
        totalTokens: params.usage.totalTokens,
        llmCalls: params.usage.llmCalls,
      } : undefined,
    });
  }
}
