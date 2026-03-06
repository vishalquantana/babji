import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionMessage } from "@babji/types";
import { SessionStore } from "../session-store.js";

describe("SessionStore", () => {
  let baseDir: string;
  let store: SessionStore;
  const tenantId = "tenant-test-456";
  const sessionId = "session-abc";

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "babji-session-test-"));
    store = new SessionStore(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  function makeMessage(role: "user" | "assistant", content: string): SessionMessage {
    return {
      role,
      content,
      timestamp: new Date("2025-01-15T10:00:00Z"),
    };
  }

  describe("append", () => {
    it("creates session file and appends a message", async () => {
      const msg = makeMessage("user", "Hello Babji");
      await store.append(tenantId, sessionId, msg);

      const history = await store.getHistory(tenantId, sessionId);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe("user");
      expect(history[0].content).toBe("Hello Babji");
    });

    it("appends multiple messages in order", async () => {
      await store.append(tenantId, sessionId, makeMessage("user", "Hi"));
      await store.append(tenantId, sessionId, makeMessage("assistant", "Hey! How can I help?"));
      await store.append(tenantId, sessionId, makeMessage("user", "Check my email"));

      const history = await store.getHistory(tenantId, sessionId);
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe("Hi");
      expect(history[1].content).toBe("Hey! How can I help?");
      expect(history[2].content).toBe("Check my email");
    });
  });

  describe("getHistory", () => {
    it("returns empty array for non-existent session", async () => {
      const history = await store.getHistory(tenantId, "no-such-session");
      expect(history).toEqual([]);
    });

    it("returns last N messages when limit is provided", async () => {
      await store.append(tenantId, sessionId, makeMessage("user", "Message 1"));
      await store.append(tenantId, sessionId, makeMessage("assistant", "Message 2"));
      await store.append(tenantId, sessionId, makeMessage("user", "Message 3"));
      await store.append(tenantId, sessionId, makeMessage("assistant", "Message 4"));
      await store.append(tenantId, sessionId, makeMessage("user", "Message 5"));

      const history = await store.getHistory(tenantId, sessionId, 2);
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe("Message 4");
      expect(history[1].content).toBe("Message 5");
    });

    it("returns all messages when limit exceeds total", async () => {
      await store.append(tenantId, sessionId, makeMessage("user", "Only message"));

      const history = await store.getHistory(tenantId, sessionId, 100);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe("Only message");
    });

    it("restores Date objects from JSON", async () => {
      const msg = makeMessage("user", "Test timestamps");
      await store.append(tenantId, sessionId, msg);

      const history = await store.getHistory(tenantId, sessionId);
      expect(history[0].timestamp).toBeInstanceOf(Date);
      expect(history[0].timestamp.toISOString()).toBe("2025-01-15T10:00:00.000Z");
    });
  });
});
