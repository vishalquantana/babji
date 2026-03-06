import type { BabjiMessage, OutboundMessage, SkillDefinition } from "@babji/types";
import { Brain, PromptBuilder, ToolExecutor } from "@babji/agent";
import type { LlmClient } from "@babji/agent";
import { MemoryManager, SessionStore } from "@babji/memory";
import { CreditLedger } from "@babji/credits";
import type { SkillRequestManager } from "@babji/skills";
import { TenantResolver } from "./tenant-resolver.js";
import { OnboardingHandler } from "./onboarding.js";

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

  constructor(private deps: MessageHandlerDeps) {
    const toolExecutor = new ToolExecutor();
    this.brain = new Brain(deps.llm, toolExecutor);
  }

  async handle(message: BabjiMessage): Promise<OutboundMessage> {
    const { channel, sender } = message;

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
          console.warn(`Tenant ${tenantId} has insufficient credits for tool call deduction`);
        }
      }

      // Store outbound response in session history
      await this.deps.sessions.append(tenantId, sessionId, {
        role: "assistant",
        content: result.content,
        timestamp: new Date(),
      });

      return {
        tenantId,
        channel,
        recipient: sender,
        text: result.content,
      };
    } catch (err) {
      console.error(`Error handling message for sender ${sender}:`, err);
      return {
        tenantId: message.tenantId || "unknown",
        channel,
        recipient: sender,
        text: "Oops! Something went wrong on my end. Please try again in a moment.",
      };
    }
  }
}
