# General Research Skill (BAB-3) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `general_research` skill with two actions: `quick_research` (Gemini Flash + Google Search grounding) and `deep_research` (Gemini Deep Research Interactions API, async fire-and-forget with JobRunner delivery).

**Architecture:** The handler uses raw `fetch()` to Gemini REST APIs. Quick research is synchronous (single generateContent call). Deep research starts an async Interactions API task, stores the interaction ID in `scheduledJobs`, and returns immediately. The JobRunner polls and delivers results through the Brain → Telegram. The full report is saved to disk on the server (`/opt/babji/data/reports/`) so the original can be accessed later. After delivering the summary, Babji asks if the user wants the full report emailed.

**Tech Stack:** Gemini REST API, fetch(), Drizzle ORM (scheduledJobs table), existing Brain/ToolExecutor/JobRunner infrastructure, fs for report storage.

**Design doc:** `docs/plans/2026-03-09-general-research-design.md`

---

### Task 1: Add skill definition to registry

**Files:**
- Modify: `packages/skills/src/registry.ts:855` (add to allSkills array)

**Step 1: Add the generalResearchSkill definition**

Add before the `allSkills` array (before line 855):

```typescript
const generalResearchSkill: SkillDefinition = {
  name: "general_research",
  displayName: "General Research",
  description: "Search the web and research any topic. Use quick_research for fast answers and deep_research for comprehensive reports.",
  actions: [
    {
      name: "quick_research",
      description: "Quick web search with grounded answers. Returns an answer with source citations. Good for factual questions, current events, quick lookups.",
      parameters: {
        query: { type: "string", required: true, description: "The search query or research question" },
        context: { type: "string", required: false, description: "Additional context to guide the search" },
      },
    },
    {
      name: "deep_research",
      description: "Start a comprehensive deep research task. Takes 5-20 minutes. Results are delivered automatically when ready. Use for market research, industry analysis, detailed topic exploration.",
      parameters: {
        query: { type: "string", required: true, description: "The research topic or question" },
        instructions: { type: "string", required: false, description: "Specific instructions for the report structure or focus areas" },
      },
    },
  ],
  creditsPerAction: 1,
};
```

**Step 2: Add to allSkills array**

Change line 855 from:
```typescript
const allSkills: SkillDefinition[] = [gmailSkill, calendarSkill, googleAdsSkill, googleAnalyticsSkill, checkWithTeacherSkill, peopleSkill];
```
To:
```typescript
const allSkills: SkillDefinition[] = [gmailSkill, calendarSkill, googleAdsSkill, googleAnalyticsSkill, checkWithTeacherSkill, peopleSkill, generalResearchSkill];
```

**Step 3: Build to verify**

Run: `pnpm --filter @babji/skills build`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/skills/src/registry.ts
git commit -m "feat(skills): add general_research skill definition to registry (BAB-3)"
```

---

### Task 2: Create the GeneralResearchHandler (quick_research only)

**Files:**
- Create: `packages/skills/src/general-research/handler.ts`
- Create: `packages/skills/src/general-research/index.ts`

**Step 1: Create the handler file**

Create `packages/skills/src/general-research/handler.ts`:

```typescript
import type { SkillHandler } from "@babji/agent";

interface GeminiGroundingChunk {
  web?: { uri: string; title: string };
}

interface GeminiGroundingMetadata {
  groundingChunks?: GeminiGroundingChunk[];
  webSearchQueries?: string[];
}

interface GeminiCandidate {
  content?: {
    parts?: Array<{ text?: string }>;
  };
  groundingMetadata?: GeminiGroundingMetadata;
}

interface GeminiGenerateResponse {
  candidates?: GeminiCandidate[];
}

export interface DeepResearchDeps {
  insertJob: (tenantId: string, payload: Record<string, unknown>) => Promise<string>;
}

export class GeneralResearchHandler implements SkillHandler {
  constructor(
    private googleApiKey: string,
    private modelName: string,
    private deepResearchDeps?: DeepResearchDeps & { tenantId: string; channel: string },
  ) {}

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "quick_research":
        return this.quickResearch(params.query as string, params.context as string | undefined);
      case "deep_research":
        return this.startDeepResearch(params.query as string, params.instructions as string | undefined);
      default:
        throw new Error(`Unknown general_research action: ${actionName}`);
    }
  }

  private async quickResearch(query: string, context?: string): Promise<unknown> {
    if (!query?.trim()) {
      throw new Error("Query is required for quick_research");
    }

    const prompt = context
      ? `${query}\n\nAdditional context: ${context}`
      : query;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.googleApiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini search failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as GeminiGenerateResponse;

    const candidate = data.candidates?.[0];
    const answer = candidate?.content?.parts?.map((p) => p.text).join("") || "";
    const grounding = candidate?.groundingMetadata;

    const sources = (grounding?.groundingChunks || [])
      .filter((c) => c.web?.uri)
      .map((c) => ({ title: c.web!.title || "", url: c.web!.uri }));

    return {
      answer,
      sources,
      searchQueries: grounding?.webSearchQueries || [],
    };
  }

  private async startDeepResearch(query: string, instructions?: string): Promise<unknown> {
    if (!query?.trim()) {
      throw new Error("Query is required for deep_research");
    }

    if (!this.deepResearchDeps) {
      throw new Error("Deep research is not configured. Use quick_research instead.");
    }

    const input = instructions
      ? `${query}\n\nInstructions: ${instructions}`
      : query;

    // Start the Interactions API request
    const url = "https://generativelanguage.googleapis.com/v1beta/interactions";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.googleApiKey,
      },
      body: JSON.stringify({
        input,
        agent: "deep-research-pro-preview-12-2025",
        background: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini Deep Research failed to start (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { id?: string; name?: string };
    const interactionId = data.id || data.name;

    if (!interactionId) {
      throw new Error("Gemini Deep Research returned no interaction ID");
    }

    // Insert a scheduled job to poll for results
    const { tenantId, channel } = this.deepResearchDeps;
    await this.deepResearchDeps.insertJob(tenantId, {
      interactionId,
      query,
      instructions,
      tenantId,
      channel,
      startedAt: new Date().toISOString(),
    });

    return {
      status: "started",
      message: "Deep research has been kicked off. I'll send you the results when it's ready (usually 5-20 minutes).",
    };
  }
}
```

**Step 2: Create the index export**

Create `packages/skills/src/general-research/index.ts`:

```typescript
export { GeneralResearchHandler } from "./handler.js";
export type { DeepResearchDeps } from "./handler.js";
```

**Step 3: Build to verify**

Run: `pnpm --filter @babji/skills build`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/skills/src/general-research/
git commit -m "feat(skills): add GeneralResearchHandler with quick_research and deep_research (BAB-3)"
```

---

### Task 3: Export from skills package and wire up in message-handler

**Files:**
- Modify: `packages/skills/src/index.ts:12` (add export)
- Modify: `packages/gateway/src/message-handler.ts:9` (add import)
- Modify: `packages/gateway/src/message-handler.ts:88-108` (add deps)
- Modify: `packages/gateway/src/message-handler.ts:387-393` (register handler)

**Step 1: Add export to skills index**

In `packages/skills/src/index.ts`, add after line 12 (after TodosHandler export):

```typescript
export { GeneralResearchHandler } from "./general-research/index.js";
export type { DeepResearchDeps } from "./general-research/index.js";
```

**Step 2: Import in message-handler**

In `packages/gateway/src/message-handler.ts`, update the import on line 9:

Change:
```typescript
import { GmailHandler, GoogleCalendarHandler, GoogleAdsHandler, GoogleAnalyticsHandler, PeopleHandler, TodosHandler } from "@babji/skills";
```
To:
```typescript
import { GmailHandler, GoogleCalendarHandler, GoogleAdsHandler, GoogleAnalyticsHandler, PeopleHandler, TodosHandler, GeneralResearchHandler } from "@babji/skills";
```

**Step 3: Add googleApiKey and googleModel to MessageHandlerDeps**

In `packages/gateway/src/message-handler.ts`, add to the `MessageHandlerDeps` interface (around line 108, after `peopleConfig`):

```typescript
  googleApiKey: string;
  googleModel: string;
```

**Step 4: Register the handler in handle()**

In `packages/gateway/src/message-handler.ts`, after the people skill registration block (after line 393), add:

```typescript
      // ── Register general research handler (server-side keys, always available) ──
      if (this.deps.googleApiKey) {
        const insertJob = async (jobTenantId: string, payload: Record<string, unknown>) => {
          const [job] = await this.deps.db.insert(schema.scheduledJobs).values({
            tenantId: jobTenantId,
            jobType: "deep_research",
            scheduleType: "once",
            scheduledAt: new Date(),
            payload,
            status: "active",
          }).returning();
          return job.id;
        };

        toolExecutor.registerSkill("general_research", new GeneralResearchHandler(
          this.deps.googleApiKey,
          this.deps.googleModel || "gemini-3-flash-preview",
          { insertJob, tenantId, channel },
        ));
      }
```

**Step 5: Wire deps in index.ts**

In `packages/gateway/src/index.ts`, update the MessageHandler constructor call (around line 82-98). Add after `peopleConfig: config.people,`:

```typescript
    googleApiKey: config.googleApiKey,
    googleModel: process.env.GOOGLE_MODEL || "gemini-3-flash-preview",
```

**Step 6: Build to verify**

Run: `pnpm --filter @babji/gateway build`
Expected: No errors

**Step 7: Commit**

```bash
git add packages/skills/src/index.ts packages/gateway/src/message-handler.ts packages/gateway/src/index.ts
git commit -m "feat(gateway): register general_research handler with deep research job scheduling (BAB-3)"
```

---

### Task 4: Add deep_research job type to JobRunner

**Files:**
- Modify: `packages/gateway/src/job-runner.ts:93-97` (add deps for LLM + Brain)
- Modify: `packages/gateway/src/job-runner.ts:152-165` (add case in executeJob)
- Modify: `packages/gateway/src/job-runner.ts` (add runDeepResearch method)
- Modify: `packages/gateway/src/index.ts:128` (pass new deps to JobRunner)

**Step 1: Update JobRunnerDeps interface**

In `packages/gateway/src/job-runner.ts`, update the interface (line 93-97):

Change:
```typescript
export interface JobRunnerDeps {
  db: Database;
  vault: TokenVault;
  adapters: ChannelAdapter[];
}
```
To:
```typescript
export interface JobRunnerDeps {
  db: Database;
  vault: TokenVault;
  adapters: ChannelAdapter[];
  googleApiKey: string;
  googleModel: string;
  llm: LlmClient;
  memory: MemoryManager;
  sessions: SessionStore;
  availableSkills: SkillDefinition[];
}
```

**Step 2: Add imports to job-runner.ts**

At the top of `packages/gateway/src/job-runner.ts`, add:

```typescript
import type { LlmClient } from "@babji/agent";
import { Brain, PromptBuilder, ToolExecutor, skillsToAiTools } from "@babji/agent";
import { MemoryManager, SessionStore } from "@babji/memory";
import type { SkillDefinition } from "@babji/types";
```

**Step 3: Add deep_research case to executeJob**

In the `executeJob` switch statement (around line 152-165), add before the `default` case:

```typescript
      case "deep_research":
        await this.runDeepResearch(job);
        break;
```

**Step 4: Add runDeepResearch method**

Add this method to the `JobRunner` class (after `runTodoReminder`):

```typescript
  private async runDeepResearch(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const payload = job.payload as {
      interactionId?: string;
      query?: string;
      tenantId?: string;
      channel?: string;
      startedAt?: string;
    } | null;

    if (!payload?.interactionId || !payload?.tenantId) {
      logger.warn({ jobId: job.id }, "deep_research job missing interactionId or tenantId");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    // Check timeout: if started more than 60 minutes ago, fail
    const startedAt = payload.startedAt ? new Date(payload.startedAt) : job.createdAt;
    const elapsedMs = Date.now() - startedAt.getTime();
    if (elapsedMs > 60 * 60 * 1000) {
      logger.warn({ jobId: job.id, elapsedMs }, "deep_research timed out after 60 minutes");
      await this.sendDeepResearchError(payload.tenantId, payload.channel, payload.query || "your topic");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    // Poll the Interactions API
    const url = `https://generativelanguage.googleapis.com/v1beta/interactions/${payload.interactionId}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "x-goog-api-key": this.deps.googleApiKey },
      });
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Failed to poll deep research interaction");
      // Don't fail the job — retry on next tick
      return;
    }

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body, jobId: job.id }, "Deep research poll returned error");
      // If 404, the interaction doesn't exist — fail the job
      if (res.status === 404) {
        await this.sendDeepResearchError(payload.tenantId, payload.channel, payload.query || "your topic");
        await this.deps.db.update(schema.scheduledJobs)
          .set({ status: "failed", lastRunAt: new Date() })
          .where(eq(schema.scheduledJobs.id, job.id));
      }
      return;
    }

    const data = await res.json() as {
      status?: string;
      outputs?: Array<{ text?: string }>;
    };

    if (data.status === "in_progress") {
      // Still running — skip, next tick will retry (30s interval)
      logger.debug({ jobId: job.id, interactionId: payload.interactionId }, "Deep research still in progress");
      return;
    }

    if (data.status === "failed") {
      logger.warn({ jobId: job.id }, "Deep research interaction failed");
      await this.sendDeepResearchError(payload.tenantId, payload.channel, payload.query || "your topic");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    if (data.status === "completed") {
      // Extract the report from the last output
      const report = data.outputs?.at(-1)?.text || "(No report content returned)";

      // Feed through the Brain for conversational delivery
      await this.deliverDeepResearchReport(payload.tenantId, payload.channel, payload.query || "your topic", report);

      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));

      logger.info({ jobId: job.id, tenantId: payload.tenantId, query: payload.query }, "Deep research completed and delivered");
    }
  }

  private async deliverDeepResearchReport(
    tenantId: string,
    channel: string | undefined,
    query: string,
    report: string,
  ): Promise<void> {
    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) return;

    const recipient = tenant.telegramUserId || tenant.phone;
    const resolvedChannel = (channel || (tenant.telegramUserId ? "telegram" : "whatsapp")) as "telegram" | "whatsapp" | "app";
    if (!recipient) return;

    const adapter = this.deps.adapters.find((a) => a.name === resolvedChannel);
    if (!adapter) return;

    // ── Save full report to disk ──
    // Store under /opt/babji/data/reports/<tenantId>/<timestamp>-<slug>.md
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const reportsDir = path.join(process.env.MEMORY_BASE_DIR || "./data/tenants", "..", "reports", tenantId);
    await fs.mkdir(reportsDir, { recursive: true });
    const reportFilename = `${timestamp}-${slug}.md`;
    const reportPath = path.join(reportsDir, reportFilename);
    await fs.writeFile(reportPath, `# Deep Research: ${query}\n\n_Generated: ${new Date().toISOString()}_\n\n${report}`);
    logger.info({ tenantId, reportPath }, "Saved deep research report to disk");

    // ── Summarize via Brain ──
    const soul = await this.deps.memory.readSoul(tenantId);
    const memoryContent = await this.deps.memory.readMemory(tenantId);

    const systemPrompt = PromptBuilder.build({
      soul,
      memory: memoryContent,
      skills: this.deps.availableSkills,
      connections: [],
      userName: tenant.name,
      timezone: tenant.timezone ?? "UTC",
    });

    // Truncate report to avoid blowing context (keep first 8000 chars for the Brain)
    const truncatedReport = report.length > 8000 ? report.slice(0, 8000) + "\n\n...(report truncated)" : report;

    const brain = new Brain(this.deps.llm, new ToolExecutor());
    const result = await brain.process({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `Here are the results of the deep research I requested about "${query}":\n\n${truncatedReport}\n\nSummarize this research for me in a clear, conversational way. Include key findings and cite sources where available. Start with "Your deep research on '${query}' is ready!" and end with: "Would you like me to email you the full report? Just share your email address and I'll send it over."`,
        },
      ],
      maxTurns: 1,
      tools: {},
    });

    await adapter.sendMessage({
      tenantId,
      channel: resolvedChannel,
      recipient,
      text: result.content,
    });

    // Store the report path in tenant's memory for follow-up email requests
    await this.deps.memory.appendMemory(tenantId, `Deep research report on "${query}" saved at ${reportPath}`);
  }

  private async sendDeepResearchError(
    tenantId: string,
    channel: string | undefined,
    query: string,
  ): Promise<void> {
    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) return;

    const recipient = tenant.telegramUserId || tenant.phone;
    const resolvedChannel = (channel || (tenant.telegramUserId ? "telegram" : "whatsapp")) as "telegram" | "whatsapp" | "app";
    if (!recipient) return;

    const adapter = this.deps.adapters.find((a) => a.name === resolvedChannel);
    if (!adapter) return;

    await adapter.sendMessage({
      tenantId,
      channel: resolvedChannel,
      recipient,
      text: `I wasn't able to complete the deep research on "${query}". Would you like me to try again, or do a quick search instead?`,
    });
  }
```

**Step 5: Update JobRunner instantiation in index.ts**

In `packages/gateway/src/index.ts`, update line 128:

Change:
```typescript
  const jobRunner = new JobRunner({ db, vault, adapters });
```
To:
```typescript
  const jobRunner = new JobRunner({
    db,
    vault,
    adapters,
    googleApiKey: config.googleApiKey,
    googleModel: process.env.GOOGLE_MODEL || "gemini-3-flash-preview",
    llm,
    memory,
    sessions,
    availableSkills,
  });
```

**Step 6: Build to verify**

Run: `pnpm --filter @babji/gateway build`
Expected: No errors

**Step 7: Run existing tests**

Run: `pnpm --filter @babji/gateway test`
Expected: All 29 tests pass (existing tests should not break)

**Step 8: Commit**

```bash
git add packages/gateway/src/job-runner.ts packages/gateway/src/index.ts
git commit -m "feat(gateway): add deep_research job type to JobRunner with Brain delivery (BAB-3)"
```

---

### Task 5: Test quick_research manually on server

**Step 1: Build all packages**

```bash
pnpm --filter @babji/skills build && pnpm --filter @babji/agent build && pnpm --filter @babji/gateway build
```

**Step 2: Run tests**

```bash
pnpm --filter @babji/gateway test
```
Expected: All tests pass

**Step 3: Deploy to server**

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

ssh root@65.20.76.199 'cd /opt/babji && pnpm install --frozen-lockfile'

ssh root@65.20.76.199 'kill $(pgrep -f "packages/gateway"); nohup /opt/babji/start-gateway.sh > /var/log/babji-gateway.log 2>&1 &'

ssh root@65.20.76.199 'sleep 3 && tail -20 /var/log/babji-gateway.log'
```

Expected: Gateway starts with `general_research` in the loaded skills list.

**Step 4: Test via Telegram**

Send to Babji on Telegram: "What is the current price of gold?"

Expected: Babji calls `general_research__quick_research`, returns a grounded answer with citations.

**Step 5: Test deep_research via Telegram**

Send to Babji on Telegram: "Do deep research on rice manufacturing in India"

Expected:
- Babji responds immediately: "I've started a deep research task..."
- 5-20 minutes later: Babji sends a conversational summary of the research

**Step 6: Check server logs for any errors**

```bash
ssh root@65.20.76.199 'tail -50 /var/log/babji-gateway.log'
```

**Step 7: Commit any fixes**

If any adjustments are needed based on testing, fix and commit.

---

### Task 6: Update Jira ticket and changelog

**Step 1: Transition BAB-3 to Done in Jira**

```bash
ssh root@65.20.76.199 'source /opt/babji/.env && curl -s "https://${JIRA_HOST}/rest/api/3/transitions?expand=transitions.fields" -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" -H "Accept: application/json" "https://${JIRA_HOST}/rest/api/3/issue/BAB-3/transitions"'
```

Find the transition ID for "Done", then:

```bash
ssh root@65.20.76.199 'source /opt/babji/.env && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/BAB-3/transitions" -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" -H "Content-Type: application/json" -d "{\"transition\":{\"id\":\"<DONE_TRANSITION_ID>\"}}"'
```

**Step 2: Update CHANGELOG.md**

Add entry to `CHANGELOG.md`:

```markdown
### General Research skill (BAB-3) [DEPLOYED]
- **What:** Added `general_research` skill with two actions: `quick_research` (Gemini Flash + Google Search grounding, synchronous) and `deep_research` (Gemini Deep Research Interactions API, async fire-and-forget with JobRunner delivery through Brain).
- **Files:** `packages/skills/src/general-research/handler.ts` (new), `packages/skills/src/registry.ts`, `packages/skills/src/index.ts`, `packages/gateway/src/message-handler.ts`, `packages/gateway/src/job-runner.ts`, `packages/gateway/src/index.ts`
- **Jira:** BAB-3 (Done)
- **No new env vars** — reuses GOOGLE_API_KEY and GOOGLE_MODEL
```

**Step 3: Update CLAUDE.md open tickets table**

In `CLAUDE.md`, update the open Jira tickets table to remove BAB-3 or mark it Done.

**Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: update changelog and CLAUDE.md for BAB-3 general_research deployment"
```
