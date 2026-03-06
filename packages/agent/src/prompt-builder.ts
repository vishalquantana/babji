import type { SkillDefinition } from "@babji/types";

interface PromptContext {
  soul: string;
  memory: string;
  skills: SkillDefinition[];
  connections: string[];
}

export class PromptBuilder {
  static build(ctx: PromptContext): string {
    const parts: string[] = [];

    parts.push(ctx.soul);
    parts.push("");
    parts.push("## What you remember about this client");
    parts.push(ctx.memory || "Nothing yet -- this is a new client.");
    parts.push("");
    parts.push("## Connected services");
    if (ctx.connections.length === 0) {
      parts.push("No services connected yet.");
    } else {
      parts.push(ctx.connections.join(", "));
    }
    parts.push("");
    parts.push("## Available skills");
    for (const skill of ctx.skills) {
      if (!ctx.connections.includes(skill.name) && skill.requiresAuth) continue;
      parts.push(`### ${skill.displayName} (${skill.name})`);
      parts.push(skill.description);
      for (const action of skill.actions) {
        const params = Object.entries(action.parameters)
          .map(([k, v]) => `${k}: ${v.type}${v.required ? " (required)" : ""}`)
          .join(", ");
        parts.push(`- ${action.name}(${params}): ${action.description}`);
      }
    }

    return parts.join("\n");
  }
}
