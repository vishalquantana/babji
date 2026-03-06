import { describe, it, expect, vi } from "vitest";
import { Brain } from "../brain.js";

describe("Brain", () => {
  it("returns LLM response for a simple message", async () => {
    const mockLlm = {
      chat: vi.fn().mockResolvedValue({
        content: "Hey! I'm Babji, nice to meet you!",
        toolCalls: [],
      }),
    };
    const mockToolExecutor = { execute: vi.fn() };

    const brain = new Brain(mockLlm, mockToolExecutor);
    const response = await brain.process({
      systemPrompt: "You are Babji.",
      messages: [{ role: "user" as const, content: "Hi" }],
      maxTurns: 5,
    });

    expect(response.content).toContain("Babji");
    expect(response.toolCallsMade).toHaveLength(0);
    expect(mockLlm.chat).toHaveBeenCalledOnce();
  });

  it("executes tool calls and loops", async () => {
    const mockLlm = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          toolCalls: [
            { id: "tc-1", skillName: "gmail", actionName: "list_emails", parameters: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: "You have 3 unread emails.",
          toolCalls: [],
        }),
    };
    const mockToolExecutor = {
      execute: vi.fn().mockResolvedValue({
        toolCallId: "tc-1",
        success: true,
        result: [{ subject: "Email 1" }, { subject: "Email 2" }, { subject: "Email 3" }],
      }),
    };

    const brain = new Brain(mockLlm, mockToolExecutor);
    const response = await brain.process({
      systemPrompt: "You are Babji.",
      messages: [{ role: "user" as const, content: "Check my email" }],
      maxTurns: 5,
    });

    expect(response.content).toContain("3 unread");
    expect(response.toolCallsMade).toHaveLength(1);
    expect(mockLlm.chat).toHaveBeenCalledTimes(2);
    expect(mockToolExecutor.execute).toHaveBeenCalledOnce();
  });

  it("stops after maxTurns if tools keep being called", async () => {
    const mockLlm = {
      chat: vi.fn().mockResolvedValue({
        content: "",
        toolCalls: [
          { id: "tc-loop", skillName: "test", actionName: "action", parameters: {} },
        ],
      }),
    };
    const mockToolExecutor = {
      execute: vi.fn().mockResolvedValue({
        toolCallId: "tc-loop",
        success: true,
        result: "done",
      }),
    };

    const brain = new Brain(mockLlm, mockToolExecutor);
    const response = await brain.process({
      systemPrompt: "You are Babji.",
      messages: [{ role: "user" as const, content: "Loop forever" }],
      maxTurns: 3,
    });

    expect(response.content).toContain("ran out of thinking steps");
    expect(response.toolCallsMade).toHaveLength(3);
    expect(mockLlm.chat).toHaveBeenCalledTimes(3);
    expect(mockToolExecutor.execute).toHaveBeenCalledTimes(3);
  });

  it("collects all tool calls across multiple turns", async () => {
    const mockLlm = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "Let me check that for you.",
          toolCalls: [
            { id: "tc-1", skillName: "gmail", actionName: "list_emails", parameters: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: "",
          toolCalls: [
            { id: "tc-2", skillName: "calendar", actionName: "get_events", parameters: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: "Here is your summary.",
          toolCalls: [],
        }),
    };
    const mockToolExecutor = {
      execute: vi.fn().mockResolvedValue({
        toolCallId: "tc-x",
        success: true,
        result: "data",
      }),
    };

    const brain = new Brain(mockLlm, mockToolExecutor);
    const response = await brain.process({
      systemPrompt: "You are Babji.",
      messages: [{ role: "user" as const, content: "Give me a daily summary" }],
      maxTurns: 5,
    });

    expect(response.content).toBe("Here is your summary.");
    expect(response.toolCallsMade).toHaveLength(2);
    expect(response.toolCallsMade[0].skillName).toBe("gmail");
    expect(response.toolCallsMade[1].skillName).toBe("calendar");
  });
});
