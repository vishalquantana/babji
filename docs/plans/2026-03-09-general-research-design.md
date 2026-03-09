# General Research Skill Design (BAB-3)

**Jira:** BAB-3
**Date:** 2026-03-09
**Status:** Approved

## Problem

Babji currently only has people/company research via DataForSEO + Scrapin (LinkedIn). Users want to research general topics like "rice manufacturing in India" — industry research, market analysis, topic exploration. There's no skill for that.

## Solution

Add a `general_research` skill with two actions powered by Google's Gemini APIs:

| Action | API | Behavior | Credits |
|--------|-----|----------|---------|
| `quick_research` | Gemini Flash + Google Search grounding | Synchronous single-call. Returns grounded answer with citations. | 1 |
| `deep_research` | Gemini Deep Research (Interactions API) | Async fire-and-forget. Starts research, returns immediately. Results delivered later via Brain → Telegram. | 3 |

## Approach: Gemini Grounded Search + Deep Research Agent

**Why this approach:**
- Reuses existing `GOOGLE_API_KEY` — no new vendors or API keys
- Gemini grounded search is production-ready and uses the same model we already pay for
- Deep Research via Interactions API gives best-in-class results with cited reports
- No OAuth needed — server-side credentials only (same pattern as `people` skill)

**Alternatives considered:**
- DataForSEO SERP + Gemini summarization — more code, fragile scraping, inferior quality
- Third-party research API (Perplexity/Tavily) — adds vendor, extra API key

## Skill Definition

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
  creditsPerAction: 1, // deep_research overridden to 3 in handler
};
```

## Handler Architecture

**File:** `packages/skills/src/general-research/handler.ts`

```
GeneralResearchHandler implements SkillHandler
  ├── constructor(googleApiKey: string, modelName: string, db: Database, deps: DeepResearchDeps)
  ├── execute(actionName, params) → switch on quick_research / deep_research
  │
  ├── quickResearch(query, context?)
  │   └── POST to Gemini generateContent API
  │       - Model: GOOGLE_MODEL (gemini-3-flash-preview)
  │       - Tools: [{ google_search: {} }]
  │       - Parses grounding metadata for citations
  │       - Returns: { answer: string, sources: [{title, url}] }
  │
  └── startDeepResearch(query, instructions?, tenantId, channel)
      └── POST to Gemini Interactions API
          - Agent: deep-research-pro-preview
          - background: true
          - Gets interactionId
          - Inserts scheduledJobs row (jobType: "deep_research")
          - Returns: { status: "started", message: "Deep research started..." }
```

**Implementation notes:**
- Uses raw `fetch()` to Gemini REST API (no new SDK dependency, consistent with other handlers)
- Quick research: single synchronous POST, result truncated by Brain's existing 4000-char limit
- Deep research: non-blocking, state tracked in `scheduledJobs` table

## Quick Research Flow

```
User → "What's the rice manufacturing process?"
Brain → calls general_research__quick_research(query: "rice manufacturing process")
Handler → POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
  Body: { contents: [{parts: [{text: query}]}], tools: [{google_search: {}}] }
Handler → parses response: text + groundingMetadata.groundingChunks (citations)
Handler → returns { answer: "Rice manufacturing involves...", sources: [{title: "...", url: "..."}] }
Brain → summarizes for user with citations
```

## Deep Research Flow

```
User → "Do deep research on rice manufacturing in India"
Brain → calls general_research__deep_research(query: "rice manufacturing in India")
Handler → POST https://generativelanguage.googleapis.com/v1beta/interactions
  Body: { model: "deep-research-pro-preview", userMessage: {text: query}, background: true }
Handler → gets interactionId from response
Handler → INSERT INTO scheduledJobs:
  jobType: "deep_research"
  scheduleType: "once"
  scheduledAt: NOW()
  payload: { interactionId, query, tenantId, channel, startedAt }
  status: "active"
Handler → returns { status: "started", message: "Deep research kicked off. I'll send you the results when ready (usually 5-20 minutes)." }
Brain → tells user research is underway

... 5-20 minutes later ...

JobRunner tick() → SELECT scheduledJobs WHERE jobType='deep_research' AND status='active'
JobRunner → GET https://generativelanguage.googleapis.com/v1beta/interactions/{interactionId}
  If status = "in_progress" → skip, next tick retries in 30s
  If status = "completed":
    → Extract report text + citations from response
    → Create synthetic Brain message:
      System: tenant's SOUL.md + MEMORY.md
      User: "Here are the results of the deep research about '{query}':\n\n{report}\n\nSummarize for the user conversationally. Include key findings and cite sources."
    → Brain generates natural response
    → Send via channel adapter (Telegram/WhatsApp)
    → UPDATE scheduledJobs SET status='completed'
  If status = "failed" OR startedAt > 60 min ago:
    → Send: "I wasn't able to complete the deep research on '{query}'. Want me to try again or do a quick search instead?"
    → UPDATE scheduledJobs SET status='failed'
```

## Registration

In `message-handler.ts` — always registered (server-side, no OAuth):

```typescript
toolExecutor.registerSkill("general_research",
  new GeneralResearchHandler(config.google.apiKey, config.google.model, db, deepResearchDeps)
);
```

In `job-runner.ts` — new case in `tick()`:

```typescript
case "deep_research":
  await this.runDeepResearch(job);
  break;
```

## Files to Create/Modify

| File | Change |
|------|--------|
| `packages/skills/src/general-research/handler.ts` | **New.** Handler with quickResearch() and startDeepResearch() |
| `packages/skills/src/general-research/index.ts` | **New.** Export handler |
| `packages/skills/src/registry.ts` | Add general_research skill definition to allSkills |
| `packages/skills/src/index.ts` | Export GeneralResearchHandler |
| `packages/gateway/src/message-handler.ts` | Register handler unconditionally |
| `packages/gateway/src/job-runner.ts` | Add deep_research job type — poll Interactions API, feed through Brain, deliver via adapter |

## Environment Variables

**No new env vars needed.** Reuses:
- `GOOGLE_API_KEY` — for both Gemini generateContent and Interactions API
- `GOOGLE_MODEL` — for quick_research model selection

## Error Handling

- Gemini API errors (429, 500) → throw descriptive error, ToolExecutor catches and returns to LLM
- Invalid/empty query → throw before API call
- Deep research polling failure → return partial if available, otherwise send error message to user
- Deep research timeout (>60 min) → mark failed, notify user
- No retry logic (YAGNI)

## Credit Costs

- `quick_research`: 1 credit (cheap, single API call)
- `deep_research`: 3 credits (expensive, multi-minute agentic workflow with ~80-160 search queries)

Note: `creditsPerAction` in SkillDefinition is per-skill, not per-action. The handler or message-handler will need to handle the differential cost (deduct 3 for deep_research instead of 1).
