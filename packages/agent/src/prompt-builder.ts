import type { SkillDefinition } from "@babji/types";

interface PromptContext {
  soul: string;
  memory: string;
  skills: SkillDefinition[];
  connections: string[];
  userName?: string;
  timezone?: string;
  completedSkillRequests?: Array<{ skillName: string; context: string }>;
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
      parts.push("These services are NOT connected yet. You CANNOT call their tools.");
      parts.push("When the user asks about something that needs one of these services:");
      parts.push("1. Acknowledge what they want to do and show you understand their goal");
      parts.push("2. Briefly explain what you'll be able to help with once connected (be specific to their request)");
      parts.push("3. Offer to connect -- and if the user agrees (says yes, sure, ok, etc.), immediately call babji.connect_service with the service name. Do NOT ask them to type a command.");
      parts.push("IMPORTANT: When you offer to connect and the user says yes, call babji.connect_service right away. The tool returns a short URL -- include it in your reply so the user can tap it.");
      parts.push("NEVER tell the user to type 'connect X'. NEVER make up a URL. Always use the connect_service tool to generate the real link.");
      for (const skill of disconnectedSkills) {
        parts.push(`- ${skill.displayName}: ${skill.description} (service_name: "${skill.name}")`);
      }
    }

    if (ctx.completedSkillRequests && ctx.completedSkillRequests.length > 0) {
      parts.push("");
      parts.push("## Recently fulfilled skill requests");
      parts.push("The following capabilities were recently added based on this client's requests. Mention this naturally at the start of the conversation -- let them know the feature is ready and offer to help them try it:");
      for (const req of ctx.completedSkillRequests) {
        parts.push(`- "${req.skillName}": They originally asked for: ${req.context}`);
      }
    }

    parts.push("");
    parts.push("## Task management rules");
    parts.push("You have built-in task management. When users mention todos, reminders, or things to remember:");
    parts.push("- Use babji.add_task to create todos. Pick a smart remind_before default:");
    parts.push("  - Gift/purchase: '5d' to '7d' (shipping time)");
    parts.push("  - Preparation (presentation, report): '2d' to '3d'");
    parts.push("  - Meeting/call: '1d'");
    parts.push("  - General deadline: '1d'");
    parts.push("- After creating a task with a reminder, ALWAYS confirm the timing: 'I will remind you on [date] -- [X] days before. Want me to change the timing?'");
    parts.push("- When the user asks 'what should I work on today', 'my todos', 'what is on my plate', call babji.list_tasks");
    parts.push("- Present task lists grouped by urgency: overdue first, then today, this week, then backlog");
    parts.push("- When referencing tasks for complete/update/delete, use the task ID from list_tasks results");
    parts.push("- For RECURRING reminders (e.g. 'remind me every day at 9:20 AM to check orders'):");
    parts.push("  - Use recurrence param: 'daily', 'weekdays' (Mon-Fri), 'weekly', 'monthly', 'yearly'");
    parts.push("  - Use reminder_time param: 'HH:MM' in 24-hour format (default '09:00')");
    parts.push("  - Do NOT set due_date or remind_before for recurring reminders");
    parts.push("  - After creating, confirm: 'I will remind you [frequency] at [time]. Want to change the time or frequency?'");
    parts.push("  - Use recurrence for open-ended repeating tasks. Use due_date + remind_before for one-time deadlines.");

    parts.push("");
    parts.push("## Credits");
    parts.push("Each action (research, email, calendar, etc.) costs 1 credit. The client gets 5 free daily credits.");
    parts.push("Do NOT mention credits proactively. Only mention credits when:");
    parts.push("- The client's balance drops to 2 or fewer -- then say 'Heads up, you have [X] uses left today. They reset tomorrow.'");
    parts.push("- The client asks about credits, pricing, or how many uses they have");
    parts.push("- The client runs out of credits -- then say 'You have used all your free uses for today. They reset tomorrow.'");
    parts.push("NEVER call them 'juice' with new users. Say 'free uses' or 'daily uses' instead.");

    parts.push("");
    parts.push("## Formatting rules (STRICT)");
    parts.push("You are replying in a chat app (Telegram/WhatsApp). These rules are MANDATORY:");
    parts.push("- NEVER use emojis. Not a single one. No emoji whatsoever.");
    parts.push("- NEVER use markdown: no **bold**, no *italic*, no [links](url), no # headers.");
    parts.push("- Use plain text only. Use line breaks and dashes for structure.");
    parts.push("- Keep responses concise and professional.");

    parts.push("");
    parts.push("## Tool error transparency (STRICT)");
    parts.push("When a tool call returns an error or fails:");
    parts.push("- NEVER pretend the tool succeeded with empty results. Do NOT say 'I found nothing' or 'there are no results' or 'you have 0 items' when the real issue is an error.");
    parts.push("- ALWAYS tell the user what went wrong in plain language. Example: 'I tried to check your emails but your Gmail connection seems to have expired. Want me to set up a fresh connection?'");
    parts.push("- If the error mentions authentication, expired tokens, or permissions, offer to reconnect the service.");
    parts.push("- Be honest and helpful, not evasive. Users trust you more when you are transparent about failures.");

    return parts.join("\n");
  }
}
