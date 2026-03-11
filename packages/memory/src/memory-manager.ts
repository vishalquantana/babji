import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const MAX_INTERACTIONS = 20;

export interface PersonFile {
  name: string;
  email: string;
  company: string;
  role: string;
  aliases: string[];
  facts: string[];
  dates: string[];
  interactions: string[];
}

const DEFAULT_SOUL = `# Babji

You are Babji, a friendly and capable AI business assistant.
You speak casually but professionally. You're helpful, proactive, and a bit playful.

## Personality
- You remember everything about your client. You're their digital butler.
- When you can't do something, you're honest about it and offer to learn.
- When you need access to a service, you make it easy -- just send a link.
- Never be robotic. Never say "as an AI". You're Babji.
- Learning new skills = "checking with my teacher"
- Heartbeat checks = "just checking in"

## Rules
- Keep responses concise -- this is WhatsApp/Telegram, not an essay
- Use short paragraphs, line breaks for structure
- When taking actions, confirm what you did
- For unknown capabilities: use the babji__check_with_teacher tool to submit a request to your teacher. Tell the user "Let me check with my teacher" and then call the tool. After the tool succeeds, tell the user you've passed it along and your teacher will work on it.
- NEVER offer to do things outside your listed skills. You cannot browse the web, search Reddit, visit URLs, or access any service not listed under "Available skills"
- If the user asks you to do something you can't, say so clearly, then call babji__check_with_teacher to submit the request
- NEVER generate or make up URLs. If a service needs to be connected, use the connect_service tool to generate the proper link

## Email rules
- When sending emails, ALWAYS use the client's real name to sign off -- NEVER use placeholders like [Your Name]
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
    await mkdir(join(tenantDir, "people"), { recursive: true });

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

  // ---- People File CRUD ----

  /**
   * Normalize a person's name into a filename-safe slug.
   * Strips accents, lowercases, replaces non-alphanumeric with hyphens, trims hyphens.
   */
  static slugifyName(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip diacritics
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")    // non-alphanum -> hyphen
      .replace(/^-+|-+$/g, "");        // trim leading/trailing hyphens
  }

  /**
   * Write a person file as markdown. Caps interactions at MAX_INTERACTIONS (keeps most recent).
   */
  async writePerson(tenantId: string, person: PersonFile): Promise<void> {
    const slug = MemoryManager.slugifyName(person.name);
    const peopleDir = join(this.tenantDir(tenantId), "people");
    await mkdir(peopleDir, { recursive: true });

    const capped = person.interactions.length > MAX_INTERACTIONS
      ? person.interactions.slice(-MAX_INTERACTIONS)
      : person.interactions;

    const lines: string[] = [];
    lines.push(`# ${person.name}`);
    lines.push("");
    lines.push(`- **Email**: ${person.email}`);
    lines.push(`- **Company**: ${person.company}`);
    lines.push(`- **Role**: ${person.role}`);
    if (person.aliases.length > 0) {
      lines.push(`- **Aliases**: ${person.aliases.join(", ")}`);
    }
    lines.push("");

    if (person.facts.length > 0) {
      lines.push("## Facts");
      for (const fact of person.facts) {
        lines.push(`- ${fact}`);
      }
      lines.push("");
    }

    if (person.dates.length > 0) {
      lines.push("## Dates");
      for (const date of person.dates) {
        lines.push(`- ${date}`);
      }
      lines.push("");
    }

    if (capped.length > 0) {
      lines.push("## Interactions");
      for (const interaction of capped) {
        lines.push(`- ${interaction}`);
      }
      lines.push("");
    }

    await writeFile(join(peopleDir, `${slug}.md`), lines.join("\n"), "utf-8");
  }

  /**
   * Read a person file by slug. Returns null if not found.
   */
  async readPerson(tenantId: string, slug: string): Promise<PersonFile | null> {
    const filePath = join(this.tenantDir(tenantId), "people", `${slug}.md`);
    try {
      const content = await readFile(filePath, "utf-8");
      return MemoryManager.parsePersonFile(content);
    } catch {
      return null;
    }
  }

  /**
   * List all people files for a tenant.
   */
  async listPeople(tenantId: string): Promise<PersonFile[]> {
    const peopleDir = join(this.tenantDir(tenantId), "people");
    let files: string[];
    try {
      files = await readdir(peopleDir);
    } catch {
      return [];
    }

    const people: PersonFile[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const content = await readFile(join(peopleDir, file), "utf-8");
        const person = MemoryManager.parsePersonFile(content);
        if (person) people.push(person);
      } catch {
        // skip unreadable files
      }
    }
    return people;
  }

  /**
   * Find a person by email across all people files for a tenant.
   */
  async findPersonByEmail(tenantId: string, email: string): Promise<PersonFile | null> {
    const people = await this.listPeople(tenantId);
    const lowerEmail = email.toLowerCase();
    return people.find(p => p.email.toLowerCase() === lowerEmail) ?? null;
  }

  /**
   * Parse markdown content into a PersonFile.
   */
  static parsePersonFile(content: string): PersonFile | null {
    const lines = content.split("\n");

    // Parse name from first heading
    const nameLine = lines.find(l => l.startsWith("# "));
    if (!nameLine) return null;
    const name = nameLine.replace(/^#\s+/, "").trim();

    let email = "";
    let company = "";
    let role = "";
    const aliases: string[] = [];
    const facts: string[] = [];
    const dates: string[] = [];
    const interactions: string[] = [];

    let currentSection = "meta"; // meta, facts, dates, interactions

    for (const line of lines) {
      // Detect section headers
      if (line.startsWith("## Facts")) {
        currentSection = "facts";
        continue;
      }
      if (line.startsWith("## Dates")) {
        currentSection = "dates";
        continue;
      }
      if (line.startsWith("## Interactions")) {
        currentSection = "interactions";
        continue;
      }
      if (line.startsWith("## ")) {
        currentSection = "unknown";
        continue;
      }

      if (currentSection === "meta") {
        const emailMatch = line.match(/^\s*-\s+\*\*Email\*\*:\s*(.+)/);
        if (emailMatch) { email = emailMatch[1].trim(); continue; }

        const companyMatch = line.match(/^\s*-\s+\*\*Company\*\*:\s*(.+)/);
        if (companyMatch) { company = companyMatch[1].trim(); continue; }

        const roleMatch = line.match(/^\s*-\s+\*\*Role\*\*:\s*(.+)/);
        if (roleMatch) { role = roleMatch[1].trim(); continue; }

        const aliasesMatch = line.match(/^\s*-\s+\*\*Aliases\*\*:\s*(.+)/);
        if (aliasesMatch) {
          aliases.push(...aliasesMatch[1].split(",").map(a => a.trim()).filter(Boolean));
          continue;
        }
      }

      // List items in sections
      const itemMatch = line.match(/^\s*-\s+(.+)/);
      if (itemMatch) {
        const item = itemMatch[1].trim();
        if (currentSection === "facts") facts.push(item);
        else if (currentSection === "dates") dates.push(item);
        else if (currentSection === "interactions") interactions.push(item);
      }
    }

    return { name, email, company, role, aliases, facts, dates, interactions };
  }

  private tenantDir(tenantId: string): string {
    return join(this.baseDir, tenantId);
  }
}
