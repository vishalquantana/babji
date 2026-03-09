import type { SkillDefinition } from "@babji/types";

interface PromptContext {
  soul: string;
  memory: string;
  skills: SkillDefinition[];
  connections: string[];
  userName?: string;
  timezone?: string;
}

export class PromptBuilder {
  static build(ctx: PromptContext): string {
    const parts: string[] = [];

    parts.push(ctx.soul);
    parts.push("");
    const tz = ctx.timezone && ctx.timezone !== "UTC" ? ctx.timezone : "UTC";
    parts.push(`## Current date and time`);
    parts.push(new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz, timeZoneName: "short" }));
    if (tz === "UTC") {
      parts.push("NOTE: The client's timezone is not yet known. In your FIRST reply to a new conversation, casually ask what city or country they are in so you can show times correctly. Keep it brief and natural, e.g. 'By the way, which city are you in? Just so I get the times right for you.' Do NOT ask if you already know from memory.");
    }
    parts.push("");
    if (ctx.userName) {
      parts.push(`## Client identity`);
      parts.push(`You are working for: **${ctx.userName}**`);
      parts.push(`When sending emails, always sign as "${ctx.userName}" — never use placeholders like [Your Name] or [Client Name].`);
      parts.push("");
    }
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
    const connectedSkills = ctx.skills.filter(
      (s) => !s.requiresAuth || ctx.connections.includes(s.name)
    );
    const disconnectedSkills = ctx.skills.filter(
      (s) => s.requiresAuth && !ctx.connections.includes(s.name)
    );

    if (connectedSkills.length === 0) {
      parts.push("No skills available yet. The client needs to connect a service first.");
    }
    for (const skill of connectedSkills) {
      parts.push(`### ${skill.displayName} (${skill.name})`);
      parts.push(skill.description);
      for (const action of skill.actions) {
        const params = Object.entries(action.parameters)
          .map(([k, v]) => `${k}: ${v.type}${v.required ? " (required)" : ""}`)
          .join(", ");
        parts.push(`- ${action.name}(${params}): ${action.description}`);
      }
    }

    if (disconnectedSkills.length > 0) {
      parts.push("");
      parts.push("## Services available to connect (NOT yet connected)");
      parts.push("These services are NOT connected. You CANNOT use them. If the user asks about any of these, tell them they need to connect first by typing the connect command shown below. NEVER make up a URL — just tell them what to type.");
      for (const skill of disconnectedSkills) {
        parts.push(`- ${skill.displayName}: ${skill.description} → tell user to type: "connect ${skill.name}"`);
      }
    }

    return parts.join("\n");
  }
}
