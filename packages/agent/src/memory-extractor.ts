import type { LlmClient } from "./brain.js";

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the conversation below and extract NEW facts worth remembering about the user. Focus on:

- People they mention (names, relationships, roles — e.g. "Alice is their boss", "Bob is a client")
- Companies, projects, or services they use
- Preferences and habits (e.g. "prefers email over calls", "checks email first thing")
- Personal details they share (timezone, location, role, industry)
- Recurring topics or concerns

Rules:
- Only extract FACTS, not opinions or transient info
- Skip anything already in the existing memory
- Return a JSON array of strings, each being one fact
- If there are no new facts worth remembering, return an empty array []
- Keep each fact concise — one sentence max
- Do NOT include facts about what Babji did (tool calls, responses). Only facts about the USER.

Respond with ONLY the JSON array, no other text.`;

interface ExtractionInput {
  existingMemory: string;
  conversationMessages: { role: string; content: string }[];
}

export class MemoryExtractor {
  constructor(private llm: LlmClient) {}

  async extract(input: ExtractionInput): Promise<string[]> {
    const conversationText = input.conversationMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const prompt = `${EXTRACTION_PROMPT}

## Existing Memory
${input.existingMemory || "(empty)"}

## Conversation
${conversationText}`;

    try {
      const response = await this.llm.chat([
        { role: "user", content: prompt },
      ]);

      // Parse the JSON array from the response
      const text = response.content.trim();
      // Handle markdown code blocks
      const jsonStr = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      const facts = JSON.parse(jsonStr);

      if (!Array.isArray(facts)) return [];
      return facts.filter((f): f is string => typeof f === "string" && f.length > 0);
    } catch (err) {
      console.error("[MemoryExtractor] Failed to extract memories:", err);
      return [];
    }
  }
}
