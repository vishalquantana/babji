import type { SkillHandler } from "@babji/agent";
import type { ImageStore } from "./s3.js";
import { createHash } from "node:crypto";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface UserContext {
  name?: string;
  memory?: string;
}

interface DbDeps {
  insertGeneratedImage: (row: {
    tenantId: string;
    s3Key: string;
    s3Url: string;
    prompt: string;
    originalBrief?: string;
    aspectRatio: string;
    model: string;
  }) => Promise<void>;
  tenantId: string;
}

export class ImageGenHandler implements SkillHandler {
  constructor(
    private googleApiKey: string,
    private userContext: UserContext,
    private imageStore: ImageStore | null,
    private dbDeps: DbDeps,
  ) {}

  async execute(
    actionName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (actionName) {
      case "enhance_prompt":
        return this.enhancePrompt(params);
      case "generate_image":
        return this.generateImage(params);
      default:
        throw new Error(`Unknown image_gen action: ${actionName}`);
    }
  }

  private async enhancePrompt(params: Record<string, unknown>) {
    const brief = params.brief as string;
    if (!brief) throw new Error("Missing required parameter: brief");

    const memoryExcerpt = this.userContext.memory
      ? this.userContext.memory.slice(0, 1000)
      : "No information available about this user yet.";

    const userName = this.userContext.name || "the user";

    const metaprompt = `You are an expert image prompt engineer. Given a brief from a user named ${userName}, create a detailed image generation prompt that will produce a professional, high-quality result.

Context about the user:
${memoryExcerpt}

The user's brief: "${brief}"

Rules:
- Expand vague briefs into specific, detailed visual descriptions
- Include style, composition, lighting, color palette where appropriate
- If the user's business or brand is known from context, incorporate it naturally
- Suggest an aspect ratio based on the use case (poster = 3:4, social media post = 1:1, banner = 16:9, story = 9:16, landscape photo = 3:2)
- Keep the enhanced prompt under 200 words
- Do NOT include any text/words/letters in the image unless the user specifically requested text
- Output valid JSON: { "enhanced_prompt": "...", "suggested_aspect_ratio": "...", "reasoning": "..." }`;

    const response = await fetch(
      `${GEMINI_API_BASE}/models/gemini-2.0-flash-lite:generateContent?key=${this.googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: metaprompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Prompt enhancement failed: HTTP ${response.status} — ${errText.slice(0, 200)}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Prompt enhancement returned empty result");

    try {
      const parsed = JSON.parse(text);
      return {
        enhanced_prompt: parsed.enhanced_prompt,
        suggested_aspect_ratio: parsed.suggested_aspect_ratio || "1:1",
        reasoning: parsed.reasoning || "",
        hint: "Show the enhanced_prompt to the user and ask if it looks good or if they want changes. If they approve, call image_gen.generate_image with the enhanced_prompt as the prompt parameter and the suggested_aspect_ratio.",
      };
    } catch {
      // LLM didn't return valid JSON — use the raw text as the prompt
      return {
        enhanced_prompt: text.slice(0, 1000),
        suggested_aspect_ratio: "1:1",
        reasoning: "",
        hint: "Show the enhanced_prompt to the user and ask if it looks good or if they want changes.",
      };
    }
  }

  private async generateImage(params: Record<string, unknown>) {
    const prompt = params.prompt as string;
    if (!prompt) throw new Error("Missing required parameter: prompt");

    const aspectRatio = (params.aspect_ratio as string) || "1:1";
    const quality = (params.quality as string) || "standard";

    const validAspectRatios = [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
    ];
    const finalAspectRatio = validAspectRatios.includes(aspectRatio)
      ? aspectRatio
      : "1:1";

    const model =
      quality === "pro"
        ? "gemini-3-pro-image-preview"
        : "gemini-3.1-flash-image-preview";

    const response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:generateContent?key=${this.googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: {
              aspectRatio: finalAspectRatio,
              imageSize: "1K",
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Image generation failed: HTTP ${response.status} — ${errText.slice(0, 200)}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error(
        "Image generation returned no content. The prompt may have been blocked by safety filters.",
      );
    }

    // Find the image part
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imagePart = parts.find((p: any) =>
      p.inline_data?.mime_type?.startsWith("image/"),
    );
    if (!imagePart) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textPart = parts.find((p: any) => p.text);
      throw new Error(
        `Image generation did not produce an image. ${textPart?.text || "Try a different prompt."}`,
      );
    }

    const base64Data = imagePart.inline_data.data as string;
    const mimeType = (imagePart.inline_data.mime_type as string) || "image/png";
    const buffer = Buffer.from(base64Data, "base64");

    // Upload to S3 if configured
    let s3Key = "";
    let s3Url = "";
    const hash = createHash("md5").update(buffer).digest("hex").slice(0, 8);

    if (this.imageStore) {
      const upload = await this.imageStore.upload(
        this.dbDeps.tenantId,
        buffer,
        hash,
      );
      s3Key = upload.s3Key;
      s3Url = upload.s3Url;

      // Store metadata in DB
      await this.dbDeps.insertGeneratedImage({
        tenantId: this.dbDeps.tenantId,
        s3Key,
        s3Url,
        prompt,
        originalBrief: (params.original_brief as string) || undefined,
        aspectRatio: finalAspectRatio,
        model,
      });
    }

    return {
      success: true,
      image_base64: base64Data,
      image_url: s3Url || undefined,
      s3_key: s3Key || undefined,
      mime_type: mimeType,
      caption: `Generated with ${quality === "pro" ? "high quality" : "standard"} model (${finalAspectRatio})`,
    };
  }
}
