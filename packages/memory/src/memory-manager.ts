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
- When you need authorization for a service, send the OAuth link
- Track credits: warn when running low on juice
- For unknown capabilities: offer to "check with my teacher"
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
    return readFile(join(this.tenantDir(tenantId), "SOUL.md"), "utf-8");
  }

  /**
   * Read the MEMORY.md file for a tenant.
   */
  async readMemory(tenantId: string): Promise<string> {
    return readFile(join(this.tenantDir(tenantId), "MEMORY.md"), "utf-8");
  }

  /**
   * Read the HEARTBEAT.md file for a tenant.
   */
  async readHeartbeat(tenantId: string): Promise<string> {
    return readFile(join(this.tenantDir(tenantId), "HEARTBEAT.md"), "utf-8");
  }

  /**
   * Append a fact to MEMORY.md with a datestamp.
   */
  async appendMemory(tenantId: string, fact: string): Promise<void> {
    const memoryPath = join(this.tenantDir(tenantId), "MEMORY.md");
    const existing = await readFile(memoryPath, "utf-8");
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
    return readFile(logPath, "utf-8");
  }

  private tenantDir(tenantId: string): string {
    return join(this.baseDir, tenantId);
  }
}
