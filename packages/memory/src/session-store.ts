import { readFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SessionMessage } from "@babji/types";

export class SessionStore {
  constructor(private readonly baseDir: string) {}

  /**
   * Append a SessionMessage as a JSON line to the session file.
   */
  async append(tenantId: string, sessionId: string, message: SessionMessage): Promise<void> {
    const sessionDir = join(this.baseDir, tenantId, "sessions");
    await mkdir(sessionDir, { recursive: true });
    const filePath = join(sessionDir, `${sessionId}.jsonl`);
    const line = JSON.stringify(message) + "\n";
    await appendFile(filePath, line, "utf-8");
  }

  /**
   * Read the last N messages from a session.
   * If limit is not provided, all messages are returned.
   */
  async getHistory(tenantId: string, sessionId: string, limit?: number): Promise<SessionMessage[]> {
    const filePath = join(this.baseDir, tenantId, "sessions", `${sessionId}.jsonl`);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return [];
    }

    const lines = content.trim().split("\n").filter(Boolean);
    const messages: SessionMessage[] = lines.map((line) => {
      const parsed = JSON.parse(line) as SessionMessage;
      // Restore Date objects from JSON strings
      parsed.timestamp = new Date(parsed.timestamp);
      return parsed;
    });

    if (limit !== undefined && limit > 0) {
      return messages.slice(-limit);
    }

    return messages;
  }
}
