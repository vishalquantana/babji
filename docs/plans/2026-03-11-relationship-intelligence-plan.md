# Relationship Intelligence Implementation Plan (BAB-23)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a people-aware memory layer that extracts, stores, and proactively surfaces relationship intelligence from chat, email, and calendar.

**Architecture:** Enhance the existing file-based MemoryManager with per-person files under `people/`. Upgrade the MemoryExtractor to output structured `{ general_facts, people_facts }`. Add `recall_person` Brain tool, inject person context into meeting briefings, and add relationship alerts to daily briefings.

**Tech Stack:** TypeScript, Node.js file system, Vitest, gemini-3.1-flash-lite-preview (lite LLM)

---

### Task 1: MemoryManager — People File CRUD

Add methods to MemoryManager for reading, writing, listing, and searching person files.

**Files:**
- Modify: `packages/memory/src/memory-manager.ts`
- Test: `packages/memory/src/__tests__/memory-manager.test.ts`
- Modify: `packages/memory/src/index.ts` (export new types)

**Step 1: Write the failing tests**

Add these tests to `packages/memory/src/__tests__/memory-manager.test.ts`:

```typescript
describe("people files", () => {
  it("creates people/ dir on initialize", async () => {
    await manager.initialize(tenantId);
    const { stat } = await import("node:fs/promises");
    const peopleStat = await stat(join(baseDir, tenantId, "people"));
    expect(peopleStat.isDirectory()).toBe(true);
  });

  it("writes and reads a person file", async () => {
    await manager.initialize(tenantId);
    const person = {
      name: "Srinivas Kumar",
      email: "srinivas@acme.com",
      company: "Acme Corp",
      role: "VP Engineering",
      aliases: [],
      facts: ["[2026-03-10] Met at TechCrunch conference"],
      dates: ["[BIRTHDAY: 04-15] Birthday is April 15"],
      interactions: ["[2026-03-10] [meeting] 1:1 catch-up, 30 min"],
    };
    await manager.writePerson(tenantId, person);
    const result = await manager.readPerson(tenantId, "srinivas-kumar");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Srinivas Kumar");
    expect(result!.email).toBe("srinivas@acme.com");
    expect(result!.facts).toHaveLength(1);
    expect(result!.dates).toHaveLength(1);
    expect(result!.interactions).toHaveLength(1);
  });

  it("returns null for non-existent person", async () => {
    await manager.initialize(tenantId);
    const result = await manager.readPerson(tenantId, "nobody");
    expect(result).toBeNull();
  });

  it("lists all people for a tenant", async () => {
    await manager.initialize(tenantId);
    await manager.writePerson(tenantId, {
      name: "Alice Johnson", email: "alice@co.com",
      company: "", role: "", aliases: [], facts: [], dates: [], interactions: [],
    });
    await manager.writePerson(tenantId, {
      name: "Bob Smith", email: "bob@co.com",
      company: "", role: "", aliases: [], facts: [], dates: [], interactions: [],
    });
    const people = await manager.listPeople(tenantId);
    expect(people).toHaveLength(2);
    expect(people.map(p => p.name).sort()).toEqual(["Alice Johnson", "Bob Smith"]);
  });

  it("finds person by email", async () => {
    await manager.initialize(tenantId);
    await manager.writePerson(tenantId, {
      name: "Alice Johnson", email: "alice@co.com",
      company: "TestCo", role: "CEO", aliases: [], facts: [], dates: [], interactions: [],
    });
    const result = await manager.findPersonByEmail(tenantId, "alice@co.com");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Alice Johnson");
  });

  it("returns null when findPersonByEmail finds no match", async () => {
    await manager.initialize(tenantId);
    const result = await manager.findPersonByEmail(tenantId, "nobody@co.com");
    expect(result).toBeNull();
  });

  it("normalizes name to filename slug", async () => {
    await manager.initialize(tenantId);
    await manager.writePerson(tenantId, {
      name: "José María García", email: "jose@co.com",
      company: "", role: "", aliases: [], facts: [], dates: [], interactions: [],
    });
    // Should be readable by slug
    const result = await manager.readPerson(tenantId, "jose-maria-garcia");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("José María García");
  });

  it("caps interactions at 20 entries", async () => {
    await manager.initialize(tenantId);
    const interactions = Array.from({ length: 25 }, (_, i) =>
      `[2026-03-${String(i + 1).padStart(2, "0")}] [email] Message ${i + 1}`
    );
    await manager.writePerson(tenantId, {
      name: "Busy Contact", email: "busy@co.com",
      company: "", role: "", aliases: [], facts: [], dates: [], interactions,
    });
    const result = await manager.readPerson(tenantId, "busy-contact");
    expect(result!.interactions).toHaveLength(20);
    // Should keep the 20 most recent (last 20)
    expect(result!.interactions[0]).toContain("Message 6");
    expect(result!.interactions[19]).toContain("Message 25");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/memory test`
Expected: FAIL — `writePerson`, `readPerson`, `listPeople`, `findPersonByEmail` not defined

**Step 3: Implement people file CRUD**

Add to `packages/memory/src/memory-manager.ts`:

```typescript
import { readdir } from "node:fs/promises";

// Add above the class:
const MAX_INTERACTIONS = 20;

export interface PersonFile {
  name: string;
  email: string;
  company: string;
  role: string;
  aliases: string[];
  facts: string[];
  dates: string[];
  interactions: string[];
}

// Add inside MemoryManager class:

  static slugifyName(name: string): string {
    return name
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async writePerson(tenantId: string, person: PersonFile): Promise<void> {
    const dir = join(this.tenantDir(tenantId), "people");
    await mkdir(dir, { recursive: true });
    const slug = MemoryManager.slugifyName(person.name);
    const filePath = join(dir, `${slug}.md`);

    // Cap interactions at MAX_INTERACTIONS (keep most recent)
    const interactions = person.interactions.length > MAX_INTERACTIONS
      ? person.interactions.slice(-MAX_INTERACTIONS)
      : person.interactions;

    const lines: string[] = [];
    lines.push(`# ${person.name}`);
    lines.push(`email: ${person.email}`);
    if (person.company) lines.push(`company: ${person.company}`);
    if (person.role) lines.push(`role: ${person.role}`);
    if (person.aliases.length > 0) lines.push(`aliases: ${person.aliases.join(", ")}`);
    lines.push("");
    lines.push("## Facts");
    for (const f of person.facts) lines.push(`- ${f}`);
    lines.push("");
    lines.push("## Dates");
    for (const d of person.dates) lines.push(`- ${d}`);
    lines.push("");
    lines.push("## Interactions");
    for (const i of interactions) lines.push(`- ${i}`);

    await writeFile(filePath, lines.join("\n") + "\n", "utf-8");
  }

  async readPerson(tenantId: string, slug: string): Promise<PersonFile | null> {
    const filePath = join(this.tenantDir(tenantId), "people", `${slug}.md`);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return null;
    }
    return MemoryManager.parsePersonFile(content);
  }

  async listPeople(tenantId: string): Promise<PersonFile[]> {
    const dir = join(this.tenantDir(tenantId), "people");
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }
    const people: PersonFile[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await readFile(join(dir, file), "utf-8");
      const person = MemoryManager.parsePersonFile(content);
      if (person) people.push(person);
    }
    return people;
  }

  async findPersonByEmail(tenantId: string, email: string): Promise<PersonFile | null> {
    const people = await this.listPeople(tenantId);
    const lower = email.toLowerCase();
    return people.find(p => p.email.toLowerCase() === lower) ?? null;
  }

  static parsePersonFile(content: string): PersonFile | null {
    const lines = content.split("\n");
    if (lines.length === 0) return null;

    const name = (lines[0] || "").replace(/^#\s*/, "").trim();
    if (!name) return null;

    let email = "";
    let company = "";
    let role = "";
    let aliases: string[] = [];
    let currentSection = "header";
    const facts: string[] = [];
    const dates: string[] = [];
    const interactions: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("## Facts")) { currentSection = "facts"; continue; }
      if (line.startsWith("## Dates")) { currentSection = "dates"; continue; }
      if (line.startsWith("## Interactions")) { currentSection = "interactions"; continue; }

      if (currentSection === "header") {
        const kv = line.match(/^(\w+):\s*(.+)$/);
        if (kv) {
          const [, key, val] = kv;
          if (key === "email") email = val.trim();
          else if (key === "company") company = val.trim();
          else if (key === "role") role = val.trim();
          else if (key === "aliases") aliases = val.split(",").map(a => a.trim()).filter(Boolean);
        }
      } else {
        const item = line.replace(/^-\s*/, "").trim();
        if (!item) continue;
        if (currentSection === "facts") facts.push(item);
        else if (currentSection === "dates") dates.push(item);
        else if (currentSection === "interactions") interactions.push(item);
      }
    }

    return { name, email, company, role, aliases, facts, dates, interactions };
  }
```

Also update `initialize()` to create the `people/` directory:

```typescript
// In initialize(), add after the existing mkdir calls:
await mkdir(join(tenantDir, "people"), { recursive: true });
```

Update `packages/memory/src/index.ts` to export the new type:

```typescript
export { MemoryManager } from "./memory-manager.js";
export type { PersonFile } from "./memory-manager.js";
export { SessionStore } from "./session-store.js";
export { scanMemoryDates } from "./date-scanner.js";
export type { MemoryDateEntry } from "./date-scanner.js";
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/memory test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/memory/src/memory-manager.ts packages/memory/src/__tests__/memory-manager.test.ts packages/memory/src/index.ts
git commit -m "feat(memory): add people file CRUD to MemoryManager (BAB-23)"
```

---

### Task 2: Enhanced MemoryExtractor — People-Aware Extraction

Upgrade the extraction prompt to return structured `{ general_facts, people_facts }` and add a new `extractWithPeople()` method while keeping backward compatibility.

**Files:**
- Modify: `packages/agent/src/memory-extractor.ts`
- Create: `packages/agent/src/__tests__/memory-extractor.test.ts`

**Step 1: Write the failing tests**

Create `packages/agent/src/__tests__/memory-extractor.test.ts`:

```typescript
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
      const llm = { chat: vi.fn().mockRejectedValue(new Error("fail")) } as unknown as LlmClient;
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
      // Flat array = treat as general facts, no people facts
      expect(result.generalFacts).toEqual(["Some fact about Alice"]);
      expect(result.peopleFacts).toEqual([]);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/agent test`
Expected: FAIL — `extractWithPeople` not defined

**Step 3: Implement extractWithPeople**

Modify `packages/agent/src/memory-extractor.ts`:

```typescript
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
  existingPeople: { name: string; email: string; factsSummary: string }[];
  conversationMessages: { role: string; content: string }[];
  source: "chat" | "email" | "meeting";
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

export class MemoryExtractor {
  constructor(private llm: LlmClient) {}

  /** Original extraction — returns flat string[]. Kept for backward compat. */
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

      const text = response.content.trim();
      const jsonStr = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      const facts = JSON.parse(jsonStr);

      if (!Array.isArray(facts)) return [];
      return facts.filter((f): f is string => typeof f === "string" && f.length > 0);
    } catch (err) {
      console.error("[MemoryExtractor] Failed to extract memories:", err);
      return [];
    }
  }

  /** Enhanced extraction — returns structured general + people facts. */
  async extractWithPeople(input: PeopleExtractionInput): Promise<PeopleExtractionResult> {
    const empty: PeopleExtractionResult = { generalFacts: [], peopleFacts: [] };

    const conversationText = input.conversationMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const peopleContext = input.existingPeople.length > 0
      ? input.existingPeople.map(p => `- ${p.name} (${p.email}): ${p.factsSummary}`).join("\n")
      : "(none yet)";

    const prompt = `${PEOPLE_EXTRACTION_PROMPT}

## Source
This conversation comes from: ${input.source}

## Existing Memory
${input.existingMemory || "(empty)"}

## Known People
${peopleContext}

## Conversation
${conversationText}`;

    try {
      const response = await this.llm.chat([
        { role: "user", content: prompt },
      ]);

      const text = response.content.trim();
      const jsonStr = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(jsonStr);

      // Handle backward-compat: if LLM returns flat array, treat as general facts
      if (Array.isArray(parsed)) {
        return {
          generalFacts: parsed.filter((f): f is string => typeof f === "string" && f.length > 0),
          peopleFacts: [],
        };
      }

      const generalFacts = Array.isArray(parsed.general_facts)
        ? parsed.general_facts.filter((f: unknown): f is string => typeof f === "string" && f.length > 0)
        : [];

      const peopleFacts: PersonFact[] = Array.isArray(parsed.people_facts)
        ? parsed.people_facts
            .filter((p: Record<string, unknown>) => p && typeof p.person === "string" && p.person.length > 0)
            .map((p: Record<string, unknown>) => ({
              person: p.person as string,
              email: (p.email as string) || "",
              facts: Array.isArray(p.facts) ? p.facts.filter((f: unknown) => typeof f === "string") : [],
              dates: Array.isArray(p.dates) ? p.dates.filter((d: unknown) => typeof d === "string") : [],
              company: (p.company as string) || "",
              role: (p.role as string) || "",
            }))
        : [];

      return { generalFacts, peopleFacts };
    } catch (err) {
      console.error("[MemoryExtractor] Failed to extract people memories:", err);
      return empty;
    }
  }
}
```

Export the new types from `packages/agent/src/index.ts` (check what's exported and add):

```typescript
export { MemoryExtractor } from "./memory-extractor.js";
export type { PeopleExtractionInput, PeopleExtractionResult, PersonFact } from "./memory-extractor.js";
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/agent test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/agent/src/memory-extractor.ts packages/agent/src/__tests__/memory-extractor.test.ts packages/agent/src/index.ts
git commit -m "feat(agent): add people-aware extractWithPeople to MemoryExtractor (BAB-23)"
```

---

### Task 3: Wire People Extraction into MessageHandler

Replace the flat memory extraction in `message-handler.ts` with the enhanced people-aware extraction. Route people facts to person files.

**Files:**
- Modify: `packages/gateway/src/message-handler.ts`

**Step 1: Update the fire-and-forget extraction block**

In `packages/gateway/src/message-handler.ts`, find the `setImmediate` block at ~line 820 and replace it:

```typescript
// Fire-and-forget memory extraction — don't block the response
const currentTz = tenant.timezone ?? "UTC";
setImmediate(async () => {
  try {
    const extractor = new MemoryExtractor(this.deps.llmLite);

    // Build people context for dedup
    const existingPeople = await this.deps.memory.listPeople(tenantId);
    const peopleSummary = existingPeople.map(p => ({
      name: p.name,
      email: p.email,
      factsSummary: p.facts.slice(-3).join("; ") || "no facts yet",
    }));

    const result = await extractor.extractWithPeople({
      existingMemory: memoryContent,
      existingPeople: peopleSummary,
      conversationMessages: [
        { role: "user", content: message.text },
        { role: "assistant", content: result.content },
      ],
      source: "chat",
    });

    // Store general facts in MEMORY.md (same as before)
    if (result.generalFacts.length > 0) {
      for (const fact of result.generalFacts) {
        await this.deps.memory.appendMemory(tenantId, fact);
      }
      logger.info({ tenantId, facts: result.generalFacts.length }, "Extracted general memories");
    }

    // Store people facts in person files
    if (result.peopleFacts.length > 0) {
      const datestamp = new Date().toISOString().split("T")[0];
      for (const pf of result.peopleFacts) {
        const slug = MemoryManager.slugifyName(pf.person);
        const existing = await this.deps.memory.readPerson(tenantId, slug)
          ?? await this.deps.memory.findPersonByEmail(tenantId, pf.email);

        const person = existing ?? {
          name: pf.person,
          email: pf.email,
          company: pf.company,
          role: pf.role,
          aliases: [],
          facts: [],
          dates: [],
          interactions: [],
        };

        // Merge new facts (with datestamp)
        for (const fact of pf.facts) {
          const stamped = `[${datestamp}] ${fact}`;
          person.facts.push(stamped);
        }
        for (const date of pf.dates) {
          person.dates.push(`[${date}]`);
        }
        // Update company/role if provided and person didn't have them
        if (pf.company && !person.company) person.company = pf.company;
        if (pf.role && !person.role) person.role = pf.role;
        if (pf.email && !person.email) person.email = pf.email;

        await this.deps.memory.writePerson(tenantId, person);
      }
      logger.info({ tenantId, people: result.peopleFacts.length }, "Extracted people memories");
    }

    // Timezone auto-detect from general facts (same as before)
    const allFacts = result.generalFacts;
    if (currentTz === "UTC") {
      for (const fact of allFacts) {
        const detectedTz = timezoneFromText(fact);
        if (detectedTz) {
          await this.deps.db.update(schema.tenants)
            .set({ timezone: detectedTz })
            .where(eq(schema.tenants.id, tenantId));
          logger.info({ tenantId, timezone: detectedTz, fact }, "Auto-detected timezone from conversation");
          break;
        }
      }
    }
  } catch (err) {
    logger.error({ err, tenantId }, "Memory extraction failed");
  }
});
```

Note: Add the `MemoryManager` import at the top of message-handler.ts if not already present (for `MemoryManager.slugifyName`).

**Step 2: Avoid variable shadowing**

The inner `result` variable from `extractWithPeople` will shadow the outer Brain `result`. Rename the inner one to `extraction`:

```typescript
const extraction = await extractor.extractWithPeople({ ... });
// Then use extraction.generalFacts, extraction.peopleFacts
```

**Step 3: Run the full gateway test suite**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway test`
Expected: All existing tests still PASS (the memory extraction is fire-and-forget, so existing tests won't exercise the new code path, but nothing should break)

**Step 4: Commit**

```bash
git add packages/gateway/src/message-handler.ts
git commit -m "feat(gateway): wire people-aware extraction into message handler (BAB-23)"
```

---

### Task 4: Register recall_person Brain Tool

Add `recall_person` as a tool in the `babji` skill so the Brain can look up person context during conversations.

**Files:**
- Modify: `packages/skills/src/registry.ts` (add tool definition)
- Modify: `packages/gateway/src/message-handler.ts` (add handler)

**Step 1: Add tool definition to registry**

In `packages/skills/src/registry.ts`, add to the `checkWithTeacherSkill` (babji skill) actions array, after the `configure_jira_report` action:

```typescript
{
  name: "recall_person",
  description: "Look up everything Babji knows about a person — facts, dates, interaction history. Use this when the user mentions someone by name and you need context, or when they ask 'who is X?', 'when did I last talk to X?', 'what do I know about X?'. Also use before drafting emails to someone, to personalize the message.",
  parameters: {
    name: {
      type: "string",
      required: true,
      description: "The person's name to look up (first name, last name, or full name)",
    },
    email: {
      type: "string",
      required: false,
      description: "Optional email address for more precise matching",
    },
  },
},
```

**Step 2: Add handler in message-handler.ts**

In `packages/gateway/src/message-handler.ts`, in the babji skill handler block (~line 410), add before the final unhandled action error:

```typescript
if (actionName === "recall_person") {
  const name = params.name as string;
  const email = params.email as string | undefined;

  // Try by email first (exact match)
  if (email) {
    const person = await this.deps.memory.findPersonByEmail(tenantId, email);
    if (person) {
      return { found: true, ...person };
    }
  }

  // Try by name slug
  const slug = MemoryManager.slugifyName(name);
  const person = await this.deps.memory.readPerson(tenantId, slug);
  if (person) {
    return { found: true, ...person };
  }

  // Fuzzy: search all people for partial name match
  const allPeople = await this.deps.memory.listPeople(tenantId);
  const lower = name.toLowerCase();
  const match = allPeople.find(p =>
    p.name.toLowerCase().includes(lower) ||
    p.aliases.some(a => a.toLowerCase().includes(lower))
  );
  if (match) {
    return { found: true, ...match };
  }

  return { found: false, message: `No information found about "${name}". I'll start remembering details about them from our future conversations.` };
}
```

**Step 3: Run tests**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add packages/skills/src/registry.ts packages/gateway/src/message-handler.ts
git commit -m "feat: add recall_person Brain tool for in-conversation people lookup (BAB-23)"
```

---

### Task 5: Inject People Context into Meeting Briefings

Enhance `MeetingBriefingService.generateBriefing()` to include relationship context from person files alongside LinkedIn data.

**Files:**
- Modify: `packages/gateway/src/meeting-briefing.ts`

**Step 1: Update generateBriefing to load person files**

In `packages/gateway/src/meeting-briefing.ts`, in the `generateBriefing` method, after researching attendees and before building raw text sections (~line 241):

```typescript
// Load relationship context from person files
const personFiles = new Map<string, PersonFile | null>();
for (const [email] of attendeeMap) {
  const person = await this.deps.memory.findPersonByEmail(tenantId, email);
  personFiles.set(email, person);
}
```

Then in the attendee loop where the profile is printed (~line 254), add relationship context:

```typescript
for (const attendee of meeting.attendees) {
  const key = attendee.email.toLowerCase();
  const profile = profiles.get(key);
  const personFile = personFiles.get(key);

  lines.push(`\n  ${attendee.displayName} (${attendee.email}):`);
  if (profile && profile.found !== false) {
    lines.push(`  ${JSON.stringify(profile, null, 2)}`);
  } else {
    const errorMsg = profile?.error ? ` (error: ${profile.error})` : "";
    lines.push(`  Profile not found${errorMsg}`);
  }

  // Append relationship context if available
  if (personFile) {
    lines.push(`  YOUR RELATIONSHIP HISTORY:`);
    if (personFile.facts.length > 0) {
      lines.push(`  Recent facts: ${personFile.facts.slice(-5).join("; ")}`);
    }
    if (personFile.dates.length > 0) {
      lines.push(`  Key dates: ${personFile.dates.join("; ")}`);
    }
    if (personFile.interactions.length > 0) {
      lines.push(`  Last interactions: ${personFile.interactions.slice(-3).join("; ")}`);
    }
  }
}
```

Also update the formatting system prompt to mention relationship context:

```typescript
const systemPrompt =
  "You format meeting attendee briefings for a busy professional. " +
  "Output plain text only -- no emojis, no markdown, no bold/italic. " +
  "Be concise and scannable. For each meeting, show the meeting name and time, " +
  "then for each attendee show: name (email), current title at company, " +
  "top 2-3 previous roles with tenure, education, key skills, location, " +
  "company overview (industry, size), and LinkedIn URL. " +
  "If relationship history is available, add a 'Your history' section with " +
  "the most relevant facts, last interaction, and any upcoming dates. " +
  "If a profile was not found, just show the name and email with a note. " +
  "Group by meeting.";
```

Add `PersonFile` import at the top of the file:

```typescript
import type { PersonFile } from "@babji/memory";
```

**Step 2: Run tests**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add packages/gateway/src/meeting-briefing.ts
git commit -m "feat(briefing): inject people relationship context into meeting briefings (BAB-23)"
```

---

### Task 6: Email Piggyback People Extraction

When GmailHandler processes emails (list or read), fire async people extraction on the email content.

**Files:**
- Modify: `packages/gateway/src/message-handler.ts` (add extraction callback to Gmail skill registration)

**Step 1: Understand the integration point**

The Gmail handler is registered in `message-handler.ts` via `toolExecutor.registerSkill("gmail", gmailHandler)`. After the Brain gets a tool result from Gmail, we can fire people extraction on the content. The cleanest approach: wrap the Gmail handler to intercept results.

In `message-handler.ts`, where Gmail is registered (search for `registerSkill("gmail"`), wrap it:

```typescript
// After creating gmailHandler:
const originalGmailExecute = gmailHandler.execute.bind(gmailHandler);
gmailHandler.execute = async (actionName: string, params: Record<string, unknown>) => {
  const result = await originalGmailExecute(actionName, params);

  // Piggyback people extraction on email reads
  if ((actionName === "list_emails" || actionName === "read_email") && result) {
    setImmediate(async () => {
      try {
        const extractor = new MemoryExtractor(this.deps.llmLite);
        const existingPeople = await this.deps.memory.listPeople(tenantId);
        const peopleSummary = existingPeople.map(p => ({
          name: p.name,
          email: p.email,
          factsSummary: p.facts.slice(-3).join("; ") || "no facts yet",
        }));
        const memoryContent = await this.deps.memory.readMemory(tenantId);

        const emailText = typeof result === "string" ? result : JSON.stringify(result);
        const extraction = await extractor.extractWithPeople({
          existingMemory: memoryContent,
          existingPeople: peopleSummary,
          conversationMessages: [{ role: "user", content: `Email content:\n${emailText.slice(0, 3000)}` }],
          source: "email",
        });

        const datestamp = new Date().toISOString().split("T")[0];
        for (const pf of extraction.peopleFacts) {
          const slug = MemoryManager.slugifyName(pf.person);
          const existing = await this.deps.memory.readPerson(tenantId, slug)
            ?? await this.deps.memory.findPersonByEmail(tenantId, pf.email);

          const person = existing ?? {
            name: pf.person, email: pf.email, company: pf.company,
            role: pf.role, aliases: [], facts: [], dates: [], interactions: [],
          };

          for (const fact of pf.facts) person.facts.push(`[${datestamp}] ${fact}`);
          for (const date of pf.dates) person.dates.push(`[${date}]`);
          if (pf.company && !person.company) person.company = pf.company;
          if (pf.role && !person.role) person.role = pf.role;
          if (pf.email && !person.email) person.email = pf.email;

          await this.deps.memory.writePerson(tenantId, person);
        }

        if (extraction.peopleFacts.length > 0) {
          logger.info({ tenantId, people: extraction.peopleFacts.length }, "Extracted people from email");
        }
      } catch (err) {
        logger.error({ err, tenantId }, "Email people extraction failed");
      }
    });
  }

  return result;
};
```

**Step 2: Extract helper to avoid duplication**

The people-fact-to-person-file logic is duplicated between Task 3 and this task. Extract a helper method on MessageHandler:

```typescript
private async storePeopleFacts(tenantId: string, peopleFacts: PersonFact[]): Promise<void> {
  const datestamp = new Date().toISOString().split("T")[0];
  for (const pf of peopleFacts) {
    const slug = MemoryManager.slugifyName(pf.person);
    const existing = await this.deps.memory.readPerson(tenantId, slug)
      ?? await this.deps.memory.findPersonByEmail(tenantId, pf.email);

    const person = existing ?? {
      name: pf.person, email: pf.email, company: pf.company,
      role: pf.role, aliases: [], facts: [], dates: [], interactions: [],
    };

    for (const fact of pf.facts) person.facts.push(`[${datestamp}] ${fact}`);
    for (const date of pf.dates) person.dates.push(`[${date}]`);
    if (pf.company && !person.company) person.company = pf.company;
    if (pf.role && !person.role) person.role = pf.role;
    if (pf.email && !person.email) person.email = pf.email;

    await this.deps.memory.writePerson(tenantId, person);
  }
}
```

Then use `this.storePeopleFacts(tenantId, extraction.peopleFacts)` in both Task 3 and here.

**Step 3: Run tests**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add packages/gateway/src/message-handler.ts
git commit -m "feat(gateway): piggyback people extraction on email reads (BAB-23)"
```

---

### Task 7: Calendar Piggyback — Log Meeting Interactions

When calendar events are processed in the daily briefing job, log interaction entries to person files for each attendee.

**Files:**
- Modify: `packages/gateway/src/job-runner.ts`

**Step 1: Add interaction logging after briefing generation**

In `packages/gateway/src/job-runner.ts`, in `runCalendarSummary()`, after the meeting briefing section generates and sends the briefing (~line 374), add:

```typescript
// Log meeting interactions to person files
setImmediate(async () => {
  try {
    const datestamp = new Date().toISOString().split("T")[0];
    for (const meeting of meetings) {
      for (const attendee of meeting.attendees) {
        const slug = MemoryManager.slugifyName(attendee.displayName || attendee.email.split("@")[0]);
        const existing = await this.deps.memory.readPerson(tenantId, slug)
          ?? await this.deps.memory.findPersonByEmail(tenantId, attendee.email);

        const person: PersonFile = existing ?? {
          name: attendee.displayName || attendee.email.split("@")[0],
          email: attendee.email,
          company: "", role: "", aliases: [], facts: [], dates: [], interactions: [],
        };

        const interaction = `[${datestamp}] [meeting] ${meeting.summary}`;
        // Avoid duplicate if same meeting already logged
        if (!person.interactions.some(i => i.includes(meeting.summary) && i.includes(datestamp))) {
          person.interactions.push(interaction);
          await this.deps.memory.writePerson(tenantId, person);
        }
      }
    }
    logger.info({ tenantId, meetings: meetings.length }, "Logged meeting interactions to people files");
  } catch (err) {
    logger.error({ err, tenantId }, "Failed to log meeting interactions");
  }
});
```

Add imports at top of job-runner.ts:

```typescript
import { MemoryManager } from "@babji/memory";
import type { PersonFile } from "@babji/memory";
```

**Step 2: Run tests**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add packages/gateway/src/job-runner.ts
git commit -m "feat(jobs): log meeting interactions to people files from calendar events (BAB-23)"
```

---

### Task 8: Relationship Alerts in Morning Briefing

Scan people files for upcoming dates, stale contacts, and overdue follow-ups. Add a "Relationship Alerts" section to the daily briefing.

**Files:**
- Modify: `packages/memory/src/memory-manager.ts` (add `scanPeopleDates` method)
- Modify: `packages/memory/src/__tests__/memory-manager.test.ts` (test it)
- Modify: `packages/gateway/src/job-runner.ts` (add alerts to briefing)

**Step 1: Write the failing test for scanPeopleDates**

Add to `packages/memory/src/__tests__/memory-manager.test.ts`:

```typescript
describe("scanPeopleDates", () => {
  it("finds upcoming birthdays within window", async () => {
    await manager.initialize(tenantId);
    await manager.writePerson(tenantId, {
      name: "Alice", email: "alice@co.com",
      company: "", role: "", aliases: [],
      facts: [],
      dates: ["[BIRTHDAY: 03-15] Birthday is March 15"],
      interactions: [],
    });
    // Scan with a date range that includes March 15
    const alerts = await manager.scanPeopleDates(tenantId, new Date("2026-03-11"), 7);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].person).toBe("Alice");
    expect(alerts[0].type).toBe("BIRTHDAY");
    expect(alerts[0].description).toContain("Birthday is March 15");
  });

  it("finds overdue follow-ups", async () => {
    await manager.initialize(tenantId);
    await manager.writePerson(tenantId, {
      name: "Bob", email: "bob@co.com",
      company: "", role: "", aliases: [],
      facts: [],
      dates: ["[FOLLOWUP: 2026-03-10] Send proposal"],
      interactions: [],
    });
    const alerts = await manager.scanPeopleDates(tenantId, new Date("2026-03-11"), 7);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("FOLLOWUP");
    expect(alerts[0].overdue).toBe(true);
  });

  it("returns empty when no dates match", async () => {
    await manager.initialize(tenantId);
    await manager.writePerson(tenantId, {
      name: "Charlie", email: "c@co.com",
      company: "", role: "", aliases: [],
      facts: [],
      dates: ["[BIRTHDAY: 12-25] Birthday is December 25"],
      interactions: [],
    });
    const alerts = await manager.scanPeopleDates(tenantId, new Date("2026-03-11"), 7);
    expect(alerts).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/memory test`
Expected: FAIL — `scanPeopleDates` not defined

**Step 3: Implement scanPeopleDates**

Add to `MemoryManager` class in `packages/memory/src/memory-manager.ts`:

```typescript
export interface PeopleDateAlert {
  person: string;
  email: string;
  type: "BIRTHDAY" | "FOLLOWUP" | string;
  description: string;
  date: string; // MM-DD or YYYY-MM-DD
  overdue: boolean;
}

async scanPeopleDates(tenantId: string, now: Date, windowDays: number): Promise<PeopleDateAlert[]> {
  const people = await this.listPeople(tenantId);
  const alerts: PeopleDateAlert[] = [];

  const nowTime = now.getTime();
  const windowEnd = nowTime + windowDays * 86_400_000;

  for (const person of people) {
    for (const dateEntry of person.dates) {
      // Parse [TYPE: date] description
      const match = dateEntry.match(/^\[(\w+):\s*(\S+)\]\s*(.+)$/);
      if (!match) continue;

      const [, type, dateStr, description] = match;

      if (type === "BIRTHDAY" || dateStr.length === 5) {
        // Recurring date MM-DD
        const [monthStr, dayStr] = dateStr.split("-");
        const month = parseInt(monthStr, 10) - 1;
        const day = parseInt(dayStr, 10);
        const thisYear = now.getFullYear();
        const candidate = new Date(thisYear, month, day);
        const candidateTime = candidate.getTime();

        if (candidateTime >= nowTime && candidateTime <= windowEnd) {
          alerts.push({ person: person.name, email: person.email, type, description, date: dateStr, overdue: false });
        }
      } else if (dateStr.length === 10) {
        // Absolute date YYYY-MM-DD
        const candidateTime = new Date(dateStr).getTime();
        const overdue = candidateTime < nowTime;

        if (overdue || (candidateTime >= nowTime && candidateTime <= windowEnd)) {
          alerts.push({ person: person.name, email: person.email, type, description, date: dateStr, overdue });
        }
      }
    }
  }

  return alerts;
}
```

Export the type from `packages/memory/src/index.ts`:

```typescript
export type { PersonFile, PeopleDateAlert } from "./memory-manager.js";
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/memory test`
Expected: All tests PASS

**Step 5: Add relationship alerts to daily briefing**

In `packages/gateway/src/job-runner.ts`, in `runCalendarSummary()`, after sending the calendar summary message (~line 300) and before the meeting briefing section:

```typescript
// ── Relationship alerts ──
try {
  const alerts = await this.deps.memory.scanPeopleDates(tenantId, new Date(), 7);
  if (alerts.length > 0) {
    const alertLines: string[] = ["Relationship alerts:"];
    for (const alert of alerts) {
      const prefix = alert.overdue ? "OVERDUE" : "Upcoming";
      alertLines.push(`- ${prefix}: ${alert.description} (${alert.person})`);
    }
    const alertText = alertLines.join("\n");
    await adapter.sendMessage({
      tenantId,
      channel: channel as "telegram" | "whatsapp" | "app",
      recipient: recipient!,
      text: alertText,
    });
    logger.info({ tenantId, alerts: alerts.length }, "Sent relationship alerts");
  }
} catch (err) {
  logger.error({ err, tenantId }, "Failed to send relationship alerts");
}
```

**Step 6: Run tests**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add packages/memory/src/memory-manager.ts packages/memory/src/__tests__/memory-manager.test.ts packages/memory/src/index.ts packages/gateway/src/job-runner.ts
git commit -m "feat: add relationship alerts (birthdays, follow-ups) to morning briefing (BAB-23)"
```

---

### Task 9: Build, Test Full Suite, Deploy

Build all packages, run full test suite, deploy to production.

**Files:**
- No new files — validation and deployment only

**Step 1: Build all modified packages**

```bash
cd /Users/vishalkumar/Downloads/babji
pnpm --filter @babji/memory build
pnpm --filter @babji/agent build
pnpm --filter @babji/gateway build
```

**Step 2: Run all tests**

```bash
pnpm --filter @babji/memory test
pnpm --filter @babji/agent test
pnpm --filter @babji/gateway test
```

Expected: All tests PASS across all packages

**Step 3: Deploy to production**

```bash
# Sync to server
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

# Install deps on server
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'

# Restart gateway
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'

# Verify
ssh root@65.20.76.199 'sleep 2 && curl -s http://localhost:3000/health'
```

**Step 4: Verify in production**

Send a test message via Telegram mentioning a person by name. Then ask "who is [name]?" to verify `recall_person` returns the stored context.

**Step 5: Final commit (update CLAUDE.md changelog reference)**

```bash
git add -A
git commit -m "feat: relationship intelligence — people-aware memory layer (BAB-23)

- People file CRUD in MemoryManager (read/write/list/find per-tenant)
- Enhanced MemoryExtractor with extractWithPeople() for structured output
- recall_person Brain tool for in-conversation people lookup
- People context injected into meeting briefings
- Email piggyback extraction for people signals
- Calendar interaction logging to person files
- Relationship alerts (birthdays, follow-ups) in morning briefing
- Uses gemini-3.1-flash-lite-preview for all extraction"
```
