import type { LlmClient } from "./brain.js";

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the conversation below and extract NEW facts worth remembering about the user. Focus on:

- People they mention (names, relationships, roles — e.g. "Alice is their boss", "Bob is a client")
- Companies, projects, or services they use
- Preferences and habits (e.g. "prefers email over calls", "checks email first thing")
- Personal details they share (timezone, location, role, industry)
- Recurring topics or concerns
- Dates, deadlines, and commitments (birthdays, anniversaries, follow-up dates, project deadlines)

Rules:
- Only extract FACTS, not opinions or transient info
- Skip anything already in the existing memory
- Return a JSON array of strings, each being one fact
- If there are no new facts worth remembering, return an empty array []
- Keep each fact concise — one sentence max
- Do NOT include facts about what Babji did (tool calls, responses). Only facts about the USER.
- When a fact has a specific date or deadline, prefix it with [DATE: YYYY-MM-DD] tag
- For recurring annual dates (birthdays, anniversaries), use the next upcoming occurrence
- Examples of date-tagged facts:
  - "[DATE: 2026-04-15] Mom's birthday is April 15"
  - "[DATE: 2026-06-01] Project deadline for Acme Corp is June 1"
  - "[DATE: 2026-03-20] Promised to follow up with Alice by March 20"

Respond with ONLY the JSON array, no other text.`;

const PEOPLE_EXTRACTION_PROMPT = `You are a relationship intelligence system for an executive assistant. Analyze the conversation below and extract:

1. GENERAL FACTS about the user (preferences, habits, personal details) — NOT about other people
2. PEOPLE FACTS about specific individuals the user mentions or interacts with

For people facts, capture:
- Relationship signals: birthdays, family events, travel plans, life milestones
- Business context: deals discussed, follow-up commitments, project status
- Role/company changes
- Key dates associated with the person

Rules:
- Only extract FACTS, not opinions or transient info
- Skip anything already in existing memory or existing people files
- Keep each fact concise — one sentence max
- Do NOT include facts about what Babji did (tool calls, responses)
- Use full names when possible (e.g. "Srinivas Kumar" not just "Srinivas")
- For dates, use format: "BIRTHDAY: MM-DD | description" or "FOLLOWUP: YYYY-MM-DD | description"
- If unsure which person a fact belongs to, put it in general_facts

Return a JSON object (no other text):
{
  "general_facts": ["fact1", "fact2"],
  "people_facts": [
    {
      "person": "Full Name",
      "email": "email@domain.com or empty string if unknown",
      "facts": ["fact about this person"],
      "dates": ["BIRTHDAY: 04-15 | Birthday is April 15"],
      "company": "Company Name or empty string",
      "role": "Their Role or empty string"
    }
  ]
}

If nothing new to extract, return: {"general_facts": [], "people_facts": []}`;

interface ExtractionInput {
  existingMemory: string;
  conversationMessages: { role: string; content: string }[];
}

export interface PeopleExtractionInput {
  existingMemory: string;
  existingPeople: string[];
  conversationMessages: { role: string; content: string }[];
  source: string;
}

export interface PersonFact {
  person: string;
  email: string;
  facts: string[];
  dates: string[];
  company: string;
  role: string;
}

export interface PeopleExtractionResult {
  generalFacts: string[];
  peopleFacts: PersonFact[];
}

/**
 * Strip markdown code-block wrappers from LLM output.
 */
function stripCodeBlock(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
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
      const jsonStr = stripCodeBlock(text);
      const facts = JSON.parse(jsonStr);

      if (!Array.isArray(facts)) return [];
      return facts.filter((f): f is string => typeof f === "string" && f.length > 0);
    } catch (err) {
      console.error("[MemoryExtractor] Failed to extract memories:", err);
      return [];
    }
  }

  async extractWithPeople(
    input: PeopleExtractionInput,
  ): Promise<PeopleExtractionResult> {
    const emptyResult: PeopleExtractionResult = {
      generalFacts: [],
      peopleFacts: [],
    };

    const conversationText = input.conversationMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const knownPeopleSection =
      input.existingPeople.length > 0
        ? input.existingPeople.join(", ")
        : "(none)";

    const prompt = `${PEOPLE_EXTRACTION_PROMPT}

## Existing Memory
${input.existingMemory || "(empty)"}

## Known People
${knownPeopleSection}

## Source
${input.source}

## Conversation
${conversationText}`;

    try {
      const response = await this.llm.chat([
        { role: "user", content: prompt },
      ]);

      const text = response.content.trim();
      const jsonStr = stripCodeBlock(text);
      const parsed = JSON.parse(jsonStr);

      // Backward compat: if LLM returns a flat array, treat as general facts
      if (Array.isArray(parsed)) {
        return {
          generalFacts: parsed.filter(
            (f): f is string => typeof f === "string" && f.length > 0,
          ),
          peopleFacts: [],
        };
      }

      const generalFacts: string[] = Array.isArray(parsed.general_facts)
        ? parsed.general_facts.filter(
            (f: unknown): f is string => typeof f === "string" && f.length > 0,
          )
        : [];

      const peopleFacts: PersonFact[] = Array.isArray(parsed.people_facts)
        ? parsed.people_facts
            .filter(
              (p: unknown): p is Record<string, unknown> =>
                typeof p === "object" && p !== null && "person" in p,
            )
            .map(
              (p: Record<string, unknown>): PersonFact => ({
                person: typeof p.person === "string" ? p.person : "",
                email: typeof p.email === "string" ? p.email : "",
                facts: Array.isArray(p.facts)
                  ? p.facts.filter(
                      (f: unknown): f is string =>
                        typeof f === "string" && f.length > 0,
                    )
                  : [],
                dates: Array.isArray(p.dates)
                  ? p.dates.filter(
                      (d: unknown): d is string =>
                        typeof d === "string" && d.length > 0,
                    )
                  : [],
                company: typeof p.company === "string" ? p.company : "",
                role: typeof p.role === "string" ? p.role : "",
              }),
            )
        : [];

      return { generalFacts, peopleFacts };
    } catch (err) {
      console.error(
        "[MemoryExtractor] Failed to extract people memories:",
        err,
      );
      return emptyResult;
    }
  }
}
