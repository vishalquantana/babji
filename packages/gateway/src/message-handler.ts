import type { BabjiMessage, OutboundMessage, SkillDefinition } from "@babji/types";
import { Brain, PromptBuilder, ToolExecutor } from "@babji/agent";
import type { LlmClient } from "@babji/agent";
import { MemoryManager, SessionStore } from "@babji/memory";
import { CreditLedger } from "@babji/credits";
import type { SkillRequestManager } from "@babji/skills";
import { TenantResolver } from "./tenant-resolver.js";
import { OnboardingHandler } from "./onboarding.js";
import { RateLimiter } from "./rate-limiter.js";
import { logger } from "./logger.js";

export interface MessageHandlerDeps {
  memory: MemoryManager;
  sessions: SessionStore;
  credits: CreditLedger;
  llm: LlmClient;
  availableSkills: SkillDefinition[];
  tenantResolver: TenantResolver;
  onboarding: OnboardingHandler;
  skillRequests: SkillRequestManager;
}

export class MessageHandler {
  private brain: Brain;
  private rateLimiter: RateLimiter;

  constructor(private deps: MessageHandlerDeps) {
    const toolExecutor = new ToolExecutor();
    this.brain = new Brain(deps.llm, toolExecutor);
    this.rateLimiter = new RateLimiter();
  }

  async handle(message: BabjiMessage): Promise<OutboundMessage> {
    const { channel, sender } = message;

    // Rate limit by sender
    const rateLimitKey = `${channel}:${sender}`;
    const rateCheck = this.rateLimiter.check(rateLimitKey);
    if (!rateCheck.allowed) {
      const retrySeconds = Math.ceil((rateCheck.retryAfterMs ?? 0) / 1000);
      logger.warn({ sender, channel, retrySeconds }, "Rate limited");
      return {
        tenantId: message.tenantId || "unknown",
        channel,
        recipient: sender,
        text: `You're sending messages too quickly. Please wait ${retrySeconds} seconds and try again.`,
      };
    }

    try {
      // Resolve tenant from channel-specific identifier
      let tenant = channel === "whatsapp"
        ? await this.deps.tenantResolver.resolveByPhone(sender)
        : null;

      if (!tenant && channel === "telegram") {
        tenant = await this.deps.tenantResolver.resolveByTelegramId(sender);
      }

      // New user — run onboarding
      if (!tenant) {
        logger.info({ sender, channel }, "New sender — routing to onboarding");
        return this.deps.onboarding.handle(message);
      }

      const tenantId = tenant.id;

      // Build a unique session identifier per channel + sender
      const sessionId = `${channel}-${sender}`;

      // Store incoming message in session history
      await this.deps.sessions.append(tenantId, sessionId, {
        role: "user",
        content: message.text,
        timestamp: new Date(),
      });

      // Load tenant context: soul personality, long-term memory, recent history
      const soul = await this.deps.memory.readSoul(tenantId);
      const memoryContent = await this.deps.memory.readMemory(tenantId);
      const history = await this.deps.sessions.getHistory(tenantId, sessionId, 20);

      // Build system prompt from soul + memory + skills
      const systemPrompt = PromptBuilder.build({
        soul,
        memory: memoryContent,
        skills: this.deps.availableSkills,
        connections: [], // TODO: load connected service names from DB
      });

      // Run the ReAct loop through the Brain
      const result = await this.brain.process({
        systemPrompt,
        messages: history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        maxTurns: 10,
      });

      // Deduct credits when the brain invoked tool actions
      if (result.toolCallsMade.length > 0) {
        const hasCredits = await this.deps.credits.hasCredits(tenantId, 1);
        if (hasCredits) {
          await this.deps.credits.deduct(
            tenantId,
            1,
            `Action: ${result.toolCallsMade.map((t) => t.actionName).join(", ")}`,
          );
        } else {
          logger.warn({ tenantId }, "Insufficient credits for tool call deduction");
        }
      }

      // Store outbound response in session history
      await this.deps.sessions.append(tenantId, sessionId, {
        role: "assistant",
        content: result.content,
        timestamp: new Date(),
      });

      logger.info(
        { tenantId, channel, toolCalls: result.toolCallsMade.length },
        "Message processed",
      );

      return {
        tenantId,
        channel,
        recipient: sender,
        text: result.content,
      };
    } catch (err) {
      logger.error({ err, sender, channel }, "Error handling message");
      return {
        tenantId: message.tenantId || "unknown",
        channel,
        recipient: sender,
        text: "Oops! Something went wrong on my end. Please try again in a moment.",
      };
    }
  }
}
