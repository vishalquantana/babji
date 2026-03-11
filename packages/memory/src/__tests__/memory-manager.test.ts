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

  describe("people files", () => {
    it("creates people/ dir on initialize", async () => {
      await manager.initialize(tenantId);
      const { stat } = await import("node:fs/promises");
      const peopleStat = await stat(join(baseDir, tenantId, "people"));
      expect(peopleStat.isDirectory()).toBe(true);
    });

    it("writes and reads a person file", async () => {
      await manager.initialize(tenantId);
      const person = {
        name: "Srinivas Kumar",
        email: "srinivas@acme.com",
        company: "Acme Corp",
        role: "VP Engineering",
        aliases: [],
        facts: ["[2026-03-10] Met at TechCrunch conference"],
        dates: ["[BIRTHDAY: 04-15] Birthday is April 15"],
        interactions: ["[2026-03-10] [meeting] 1:1 catch-up, 30 min"],
      };
      await manager.writePerson(tenantId, person);
      const result = await manager.readPerson(tenantId, "srinivas-kumar");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Srinivas Kumar");
      expect(result!.email).toBe("srinivas@acme.com");
      expect(result!.facts).toHaveLength(1);
      expect(result!.dates).toHaveLength(1);
      expect(result!.interactions).toHaveLength(1);
    });

    it("returns null for non-existent person", async () => {
      await manager.initialize(tenantId);
      const result = await manager.readPerson(tenantId, "nobody");
      expect(result).toBeNull();
    });

    it("lists all people for a tenant", async () => {
      await manager.initialize(tenantId);
      await manager.writePerson(tenantId, {
        name: "Alice Johnson", email: "alice@co.com",
        company: "", role: "", aliases: [], facts: [], dates: [], interactions: [],
      });
      await manager.writePerson(tenantId, {
        name: "Bob Smith", email: "bob@co.com",
        company: "", role: "", aliases: [], facts: [], dates: [], interactions: [],
      });
      const people = await manager.listPeople(tenantId);
      expect(people).toHaveLength(2);
      expect(people.map(p => p.name).sort()).toEqual(["Alice Johnson", "Bob Smith"]);
    });

    it("finds person by email", async () => {
      await manager.initialize(tenantId);
      await manager.writePerson(tenantId, {
        name: "Alice Johnson", email: "alice@co.com",
        company: "TestCo", role: "CEO", aliases: [], facts: [], dates: [], interactions: [],
      });
      const result = await manager.findPersonByEmail(tenantId, "alice@co.com");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Alice Johnson");
    });

    it("returns null when findPersonByEmail finds no match", async () => {
      await manager.initialize(tenantId);
      const result = await manager.findPersonByEmail(tenantId, "nobody@co.com");
      expect(result).toBeNull();
    });

    it("normalizes name to filename slug", async () => {
      await manager.initialize(tenantId);
      await manager.writePerson(tenantId, {
        name: "José María García", email: "jose@co.com",
        company: "", role: "", aliases: [], facts: [], dates: [], interactions: [],
      });
      const result = await manager.readPerson(tenantId, "jose-maria-garcia");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("José María García");
    });

    it("caps interactions at 20 entries", async () => {
      await manager.initialize(tenantId);
      const interactions = Array.from({ length: 25 }, (_, i) =>
        `[2026-03-${String(i + 1).padStart(2, "0")}] [email] Message ${i + 1}`
      );
      await manager.writePerson(tenantId, {
        name: "Busy Contact", email: "busy@co.com",
        company: "", role: "", aliases: [], facts: [], dates: [], interactions,
      });
      const result = await manager.readPerson(tenantId, "busy-contact");
      expect(result!.interactions).toHaveLength(20);
      expect(result!.interactions[0]).toContain("Message 6");
      expect(result!.interactions[19]).toContain("Message 25");
    });
  });
});
