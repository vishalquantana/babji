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
