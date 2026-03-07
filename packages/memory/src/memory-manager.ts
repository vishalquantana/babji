import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_SOUL = `# Babji

You are Babji, a friendly and capable AI business assistant.
You speak casually but professionally. You're helpful, proactive, and a bit playful.

## Personality
- Credits = "juice"
- Learning new skills = "checking with my teacher"
- Heartbeat checks = "just checking in"
- You remember everything about your client. You're their digital butler.
- When you can't do something, you're honest about it and offer to learn.
- When you need access to a service, you make it easy -- just send a link.
- Never be robotic. Never say "as an AI". You're Babji.

## Rules
- Keep responses concise -- this is WhatsApp/Telegram, not an essay
- Use short paragraphs, line breaks, and occasional emojis
- When taking actions, confirm what you did
- Track credits: warn when running low on juice
- For unknown capabilities: offer to "check with my teacher"
- NEVER offer to do things outside your listed skills. You cannot browse the web, search Reddit, visit URLs, or access any service not listed under "Available skills"
- If the user asks you to do something you can't, say so clearly and suggest "checking with my teacher" to learn that skill
- NEVER generate or make up URLs. You don't know any URLs. If a service needs to be connected, tell the user to type "connect <service>" (e.g. "connect gmail") and the system will generate the proper link

## Email rules
- When sending emails, ALWAYS use the client's real name to sign off — NEVER use placeholders like [Your Name]
- Before composing an email, if you don't know the client's writing style yet, first read a few of their sent emails (query: "in:sent") to learn their tone, greeting style, and sign-off
- Match the client's writing style: if they write casually, write casually. If formal, be formal.
- Always confirm the draft with the user before sending, unless they explicitly said "just send it"
- NEVER use placeholder text like [Client Name], [Company], etc. If you don't know something, ask the user
`;

const DEFAULT_MEMORY = `# Memory

Facts and preferences learned about this client.
`;

const DEFAULT_CONNECTIONS = `# Connections

Connected services and integrations.
`;

const DEFAULT_HEARTBEAT = `# Heartbeat

Proactive check-in instructions.
`;

export class MemoryManager {
  constructor(private readonly baseDir: string) {}

  /**
   * Creates directory structure and default files for a tenant.
   */
  async initialize(tenantId: string): Promise<void> {
    const tenantDir = this.tenantDir(tenantId);

    await mkdir(join(tenantDir, "sessions"), { recursive: true });
    await mkdir(join(tenantDir, "memory"), { recursive: true });
    await mkdir(join(tenantDir, "credentials"), { recursive: true });

    await writeFile(join(tenantDir, "SOUL.md"), DEFAULT_SOUL, "utf-8");
    await writeFile(join(tenantDir, "MEMORY.md"), DEFAULT_MEMORY, "utf-8");
    await writeFile(join(tenantDir, "CONNECTIONS.md"), DEFAULT_CONNECTIONS, "utf-8");
    await writeFile(join(tenantDir, "HEARTBEAT.md"), DEFAULT_HEARTBEAT, "utf-8");
  }

  /**
   * Read the SOUL.md file for a tenant.
   */
  async readSoul(tenantId: string): Promise<string> {
    try {
      return await readFile(join(this.tenantDir(tenantId), "SOUL.md"), "utf-8");
    } catch {
      return DEFAULT_SOUL;
    }
  }

  /**
   * Read the MEMORY.md file for a tenant.
   */
  async readMemory(tenantId: string): Promise<string> {
    try {
      return await readFile(join(this.tenantDir(tenantId), "MEMORY.md"), "utf-8");
    } catch {
      return DEFAULT_MEMORY;
    }
  }

  /**
   * Read the HEARTBEAT.md file for a tenant.
   */
  async readHeartbeat(tenantId: string): Promise<string> {
    try {
      return await readFile(join(this.tenantDir(tenantId), "HEARTBEAT.md"), "utf-8");
    } catch {
      return DEFAULT_HEARTBEAT;
    }
  }

  /**
   * Append a fact to MEMORY.md with a datestamp.
   */
  async appendMemory(tenantId: string, fact: string): Promise<void> {
    const tenantDir = this.tenantDir(tenantId);
    const memoryPath = join(tenantDir, "MEMORY.md");
    await mkdir(tenantDir, { recursive: true });
    let existing: string;
    try {
      existing = await readFile(memoryPath, "utf-8");
    } catch {
      existing = DEFAULT_MEMORY;
    }
    const datestamp = new Date().toISOString().split("T")[0];
    const line = `\n- [${datestamp}] ${fact}`;
    await writeFile(memoryPath, existing + line, "utf-8");
  }

  /**
   * Write a daily log file for a tenant.
   */
  async writeDailyLog(tenantId: string, content: string, date?: string): Promise<void> {
    const logDate = date ?? new Date().toISOString().split("T")[0];
    const logPath = join(this.tenantDir(tenantId), "memory", `${logDate}.md`);
    await writeFile(logPath, content, "utf-8");
  }

  /**
   * Read a daily log file for a tenant. Defaults to today.
   */
  async readDailyLog(tenantId: string, date?: string): Promise<string> {
    const logDate = date ?? new Date().toISOString().split("T")[0];
    const logPath = join(this.tenantDir(tenantId), "memory", `${logDate}.md`);
    try {
      return await readFile(logPath, "utf-8");
    } catch {
      return "";
    }
  }

  private tenantDir(tenantId: string): string {
    return join(this.baseDir, tenantId);
  }
}
