import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryManager } from "../memory-manager.js";

describe("MemoryManager", () => {
  let baseDir: string;
  let manager: MemoryManager;
  const tenantId = "tenant-test-123";

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "babji-memory-test-"));
    manager = new MemoryManager(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  describe("initialize", () => {
    it("creates default files for a tenant", async () => {
      await manager.initialize(tenantId);

      const tenantDir = join(baseDir, tenantId);

      const soul = await readFile(join(tenantDir, "SOUL.md"), "utf-8");
      expect(soul).toContain("# Babji");
      expect(soul).toContain("You are Babji");

      const memory = await readFile(join(tenantDir, "MEMORY.md"), "utf-8");
      expect(memory).toContain("# Memory");

      const connections = await readFile(join(tenantDir, "CONNECTIONS.md"), "utf-8");
      expect(connections).toContain("# Connections");

      const heartbeat = await readFile(join(tenantDir, "HEARTBEAT.md"), "utf-8");
      expect(heartbeat).toContain("# Heartbeat");
    });

    it("creates subdirectories for a tenant", async () => {
      await manager.initialize(tenantId);

      const tenantDir = join(baseDir, tenantId);
      const { stat } = await import("node:fs/promises");

      const sessionsStat = await stat(join(tenantDir, "sessions"));
      expect(sessionsStat.isDirectory()).toBe(true);

      const memoryStat = await stat(join(tenantDir, "memory"));
      expect(memoryStat.isDirectory()).toBe(true);

      const credentialsStat = await stat(join(tenantDir, "credentials"));
      expect(credentialsStat.isDirectory()).toBe(true);
    });
  });

  describe("readSoul / readMemory / readHeartbeat", () => {
    it("reads SOUL.md content", async () => {
      await manager.initialize(tenantId);
      const soul = await manager.readSoul(tenantId);
      expect(soul).toContain("# Babji");
      expect(soul).toContain("Never be robotic");
    });

    it("reads MEMORY.md content", async () => {
      await manager.initialize(tenantId);
      const memory = await manager.readMemory(tenantId);
      expect(memory).toContain("# Memory");
    });

    it("reads HEARTBEAT.md content", async () => {
      await manager.initialize(tenantId);
      const heartbeat = await manager.readHeartbeat(tenantId);
      expect(heartbeat).toContain("# Heartbeat");
    });
  });

  describe("appendMemory", () => {
    it("appends a fact with datestamp to MEMORY.md", async () => {
      await manager.initialize(tenantId);
      await manager.appendMemory(tenantId, "Client prefers morning meetings");

      const memory = await manager.readMemory(tenantId);
      expect(memory).toContain("Client prefers morning meetings");
      // Check datestamp format YYYY-MM-DD
      expect(memory).toMatch(/\[\d{4}-\d{2}-\d{2}\] Client prefers morning meetings/);
    });

    it("appends multiple facts preserving previous content", async () => {
      await manager.initialize(tenantId);
      await manager.appendMemory(tenantId, "Fact one");
      await manager.appendMemory(tenantId, "Fact two");

      const memory = await manager.readMemory(tenantId);
      expect(memory).toContain("Fact one");
      expect(memory).toContain("Fact two");
      expect(memory).toContain("# Memory");
    });
  });

  describe("writeDailyLog / readDailyLog", () => {
    it("writes and reads a daily log", async () => {
      await manager.initialize(tenantId);
      const content = "# Daily Summary\n\nClient had 3 meetings today.";
      await manager.writeDailyLog(tenantId, content, "2025-01-15");

      const log = await manager.readDailyLog(tenantId, "2025-01-15");
      expect(log).toBe(content);
    });

    it("uses today's date when no date is provided", async () => {
      await manager.initialize(tenantId);
      const content = "Today's log content";
      await manager.writeDailyLog(tenantId, content);

      const log = await manager.readDailyLog(tenantId);
      expect(log).toBe(content);
    });

    it("throws when reading a non-existent daily log", async () => {
      await manager.initialize(tenantId);
      await expect(manager.readDailyLog(tenantId, "1999-01-01")).rejects.toThrow();
    });
  });
});
