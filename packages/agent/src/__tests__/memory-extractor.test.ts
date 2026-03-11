import { describe, it, expect, vi } from "vitest";
import { MemoryExtractor } from "../memory-extractor.js";
import type { LlmClient } from "../brain.js";

function mockLlm(response: string): LlmClient {
  return {
    chat: vi.fn().mockResolvedValue({ content: response }),
  } as unknown as LlmClient;
}

describe("MemoryExtractor", () => {
  describe("extract (backward compat)", () => {
    it("still returns string[] from flat JSON array", async () => {
      const llm = mockLlm('["Prefers morning meetings", "Lives in Mumbai"]');
      const extractor = new MemoryExtractor(llm);
      const facts = await extractor.extract({
        existingMemory: "",
        conversationMessages: [{ role: "user", content: "I live in Mumbai" }],
      });
      expect(facts).toEqual(["Prefers morning meetings", "Lives in Mumbai"]);
    });
  });

  describe("extractWithPeople", () => {
    it("parses structured response with general and people facts", async () => {
      const response = JSON.stringify({
        general_facts: ["Prefers morning meetings"],
        people_facts: [
          {
            person: "Srinivas Kumar",
            email: "srinivas@acme.com",
            facts: ["Interested in Series B"],
            dates: ["BIRTHDAY: 04-15 | Birthday is April 15"],
            company: "Acme Corp",
            role: "VP Engineering",
          },
        ],
      });
      const llm = mockLlm(response);
      const extractor = new MemoryExtractor(llm);
      const result = await extractor.extractWithPeople({
        existingMemory: "",
        existingPeople: [],
        conversationMessages: [{ role: "user", content: "test" }],
        source: "chat",
      });
      expect(result.generalFacts).toEqual(["Prefers morning meetings"]);
      expect(result.peopleFacts).toHaveLength(1);
      expect(result.peopleFacts[0].person).toBe("Srinivas Kumar");
      expect(result.peopleFacts[0].email).toBe("srinivas@acme.com");
      expect(result.peopleFacts[0].facts).toEqual(["Interested in Series B"]);
    });

    it("handles markdown code block wrapping", async () => {
      const inner = JSON.stringify({
        general_facts: ["Fact 1"],
        people_facts: [],
      });
      const llm = mockLlm("```json\n" + inner + "\n```");
      const extractor = new MemoryExtractor(llm);
      const result = await extractor.extractWithPeople({
        existingMemory: "",
        existingPeople: [],
        conversationMessages: [{ role: "user", content: "test" }],
        source: "chat",
      });
      expect(result.generalFacts).toEqual(["Fact 1"]);
    });

    it("returns empty on LLM error", async () => {
      const llm = {
        chat: vi.fn().mockRejectedValue(new Error("fail")),
      } as unknown as LlmClient;
      const extractor = new MemoryExtractor(llm);
      const result = await extractor.extractWithPeople({
        existingMemory: "",
        existingPeople: [],
        conversationMessages: [{ role: "user", content: "test" }],
        source: "chat",
      });
      expect(result.generalFacts).toEqual([]);
      expect(result.peopleFacts).toEqual([]);
    });

    it("falls back gracefully when LLM returns flat array", async () => {
      const llm = mockLlm('["Some fact about Alice"]');
      const extractor = new MemoryExtractor(llm);
      const result = await extractor.extractWithPeople({
        existingMemory: "",
        existingPeople: [],
        conversationMessages: [{ role: "user", content: "test" }],
        source: "chat",
      });
      expect(result.generalFacts).toEqual(["Some fact about Alice"]);
      expect(result.peopleFacts).toEqual([]);
    });
  });
});
