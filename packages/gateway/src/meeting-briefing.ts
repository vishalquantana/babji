import type { Database } from "@babji/db";
import { PeopleHandler } from "@babji/skills";
import type { LlmClient } from "@babji/agent";
import { Brain, ToolExecutor } from "@babji/agent";
import { MemoryManager } from "@babji/memory";
import type { SkillDefinition } from "@babji/types";
import { TokenVault } from "@babji/crypto";
import { logger } from "./logger.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ── Constants ──

const MAX_MEETINGS = 5;
const MAX_ATTENDEES = 10;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Interfaces ──

interface CacheEntry {
  profile: Record<string, unknown>;
  fetchedAt: string;
}

interface BriefingCache {
  [email: string]: CacheEntry;
}

interface AttendeeInfo {
  email: string;
  displayName: string;
}

interface MeetingWithExternals {
  eventId: string;
  summary: string;
  startTime: string;
  attendees: AttendeeInfo[];
}

export interface MeetingBriefingDeps {
  db: Database;
  vault: TokenVault;
  llm: LlmClient;
  memory: MemoryManager;
  availableSkills: SkillDefinition[];
  peopleConfig: {
    scrapinApiKey: string;
    dataforseoLogin: string;
    dataforseoPassword: string;
  };
}

// ── Service ──

export class MeetingBriefingService {
  constructor(private deps: MeetingBriefingDeps) {}

  /**
   * Extract external attendees from calendar events.
   * Filters out same-domain attendees and the tenant themselves.
   * Returns up to MAX_MEETINGS meetings with at least 1 external attendee,
   * capping total external attendees at MAX_ATTENDEES across all meetings.
   */
  extractExternalAttendees(
    events: Array<Record<string, unknown>>,
    tenantDomain: string,
    tenantEmail?: string,
  ): MeetingWithExternals[] {
    const results: MeetingWithExternals[] = [];
    const seenEmails = new Set<string>();
    let totalAttendees = 0;

    for (const event of events) {
      if (results.length >= MAX_MEETINGS) break;
      if (totalAttendees >= MAX_ATTENDEES) break;

      const attendees = event.attendees as
        | Array<{ email?: string; displayName?: string; responseStatus?: string }>
        | undefined;

      if (!attendees || attendees.length === 0) continue;

      const externals: AttendeeInfo[] = [];

      for (const attendee of attendees) {
        if (totalAttendees >= MAX_ATTENDEES) break;

        const email = attendee.email;
        if (!email) continue;

        // Skip self
        if (tenantEmail && email.toLowerCase() === tenantEmail.toLowerCase()) continue;

        // Skip already-seen
        if (seenEmails.has(email.toLowerCase())) continue;

        // Skip same domain
        const domain = email.split("@")[1]?.toLowerCase();
        if (!domain || domain === tenantDomain.toLowerCase()) continue;

        seenEmails.add(email.toLowerCase());
        externals.push({
          email,
          displayName: attendee.displayName || email.split("@")[0],
        });
        totalAttendees++;
      }

      if (externals.length > 0) {
        results.push({
          eventId: (event.id as string) || "",
          summary: (event.summary as string) || "(No title)",
          startTime: (event.start as string) || "",
          attendees: externals,
        });
      }
    }

    return results;
  }

  /**
   * Research a single attendee via PeopleHandler with disk caching.
   * Returns the cached profile if it's less than 7 days old, otherwise
   * calls the People API and caches the result.
   */
  async researchAttendee(
    email: string,
    displayName: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    // Check cache first
    const cache = await this.loadCache(tenantId);
    const cached = cache[email.toLowerCase()];
    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < CACHE_TTL_MS) {
        logger.debug({ email, tenantId }, "Using cached attendee profile");
        return cached.profile;
      }
    }

    // Research via PeopleHandler
    const domain = email.split("@")[1];
    const people = new PeopleHandler(
      { login: this.deps.peopleConfig.dataforseoLogin, password: this.deps.peopleConfig.dataforseoPassword },
      { apiKey: this.deps.peopleConfig.scrapinApiKey },
    );

    try {
      const result = await people.execute("research_person", {
        name: displayName,
        company_or_domain: domain,
      }) as Record<string, unknown>;

      // Cache the result
      cache[email.toLowerCase()] = {
        profile: result,
        fetchedAt: new Date().toISOString(),
      };
      await this.saveCache(tenantId, cache);

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, email, tenantId }, "Failed to research attendee");
      return { found: false, email, displayName, error: message };
    }
  }

  /**
   * Generate a formatted briefing for all meetings by researching attendees
   * and passing the raw data through the lite LLM for formatting.
   */
  async generateBriefing(
    meetings: MeetingWithExternals[],
    tenantId: string,
    tenantName: string,
    timezone: string,
  ): Promise<string> {
    // Dedup attendees across all meetings
    const attendeeMap = new Map<string, { displayName: string; meetings: string[] }>();
    for (const meeting of meetings) {
      for (const attendee of meeting.attendees) {
        const key = attendee.email.toLowerCase();
        const existing = attendeeMap.get(key);
        if (existing) {
          existing.meetings.push(meeting.summary);
        } else {
          attendeeMap.set(key, {
            displayName: attendee.displayName,
            meetings: [meeting.summary],
          });
        }
      }
    }

    // Research all unique attendees
    const profiles = new Map<string, Record<string, unknown>>();
    for (const [email, info] of attendeeMap) {
      const profile = await this.researchAttendee(email, info.displayName, tenantId);
      profiles.set(email, profile);
    }

    // Build raw text sections
    const rawSections: string[] = [];

    for (const meeting of meetings) {
      const lines: string[] = [];
      lines.push(`Meeting: ${meeting.summary}`);
      lines.push(`Time: ${meeting.startTime}`);
      lines.push("Attendees:");

      for (const attendee of meeting.attendees) {
        const key = attendee.email.toLowerCase();
        const profile = profiles.get(key);
        lines.push(`\n  ${attendee.displayName} (${attendee.email}):`);
        if (profile && profile.found !== false) {
          lines.push(`  ${JSON.stringify(profile, null, 2)}`);
        } else {
          const errorMsg = profile?.error ? ` (error: ${profile.error})` : "";
          lines.push(`  Profile not found${errorMsg}`);
        }
      }

      rawSections.push(lines.join("\n"));
    }

    // Format via Brain + lite LLM
    const brain = new Brain(this.deps.llm, new ToolExecutor());

    const systemPrompt =
      "You format meeting attendee briefings for a busy professional. " +
      "Output plain text only -- no emojis, no markdown, no bold/italic. " +
      "Be concise and scannable. For each meeting, show the meeting name and time, " +
      "then for each attendee show: name (email), current title at company, " +
      "top 2-3 previous roles with tenure, education, key skills, location, " +
      "company overview (industry, size), and LinkedIn URL. " +
      "If a profile was not found, just show the name and email with a note. " +
      "Group by meeting.";

    const result = await brain.process({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `Format this meeting attendee data into a clean briefing for ${tenantName}:\n\n${rawSections.join("\n")}`,
        },
      ],
      maxTurns: 1,
      tools: {},
    });

    return result.content;
  }

  /**
   * Infer the tenant's email domain from calendar events by checking
   * the organizer or creator email fields. Skips Google calendar system domains.
   */
  inferDomainFromEvents(events: Array<Record<string, unknown>>): string | null {
    for (const event of events) {
      // Check organizer first, then creator
      for (const field of ["organizer", "creator"] as const) {
        const entity = event[field] as { email?: string } | undefined;
        if (!entity?.email) continue;

        const domain = entity.email.split("@")[1]?.toLowerCase();
        if (
          domain &&
          domain !== "calendar.google.com" &&
          domain !== "group.calendar.google.com"
        ) {
          return domain;
        }
      }
    }

    return null;
  }

  // ── Private helpers ──

  private async loadCache(tenantId: string): Promise<BriefingCache> {
    const baseDir = process.env.MEMORY_BASE_DIR || "./data/tenants";
    const cachePath = path.join(baseDir, tenantId, "briefing-cache.json");
    try {
      const data = await fs.readFile(cachePath, "utf-8");
      return JSON.parse(data) as BriefingCache;
    } catch {
      return {};
    }
  }

  private async saveCache(tenantId: string, cache: BriefingCache): Promise<void> {
    const baseDir = process.env.MEMORY_BASE_DIR || "./data/tenants";
    const dir = path.join(baseDir, tenantId);
    await fs.mkdir(dir, { recursive: true });
    const cachePath = path.join(dir, "briefing-cache.json");
    await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), "utf-8");
  }
}
