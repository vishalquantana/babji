# Meeting Attendee Briefing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Before calendar meetings, automatically research external attendees via LinkedIn/Google and deliver rich dossiers so the user feels prepared.

**Architecture:** Piggyback on the existing daily calendar summary job in `JobRunner`. When it fetches the day's events, extract external attendees (different email domain than tenant), research them via the existing People Research infrastructure (Scrapin.io + DataForSEO), format a briefing via the lite LLM, and deliver it. Users control timing (morning or pre-meeting) via new babji skill actions.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL), Scrapin.io API, DataForSEO API, Gemini lite model, existing JobRunner infrastructure.

---

### Task 1: Add schema columns to tenants table

**Files:**
- Modify: `packages/db/src/schema.ts:21-43` (tenants table)
- DB migration: `ALTER TABLE tenants ADD COLUMN ...` (run on production)

**Step 1: Add columns to Drizzle schema**

In `packages/db/src/schema.ts`, add two columns to the `tenants` table definition, after the `onboardingPhase` column (line 35):

```typescript
    emailDomain: varchar("email_domain", { length: 100 }),
    meetingBriefingPref: varchar("meeting_briefing_pref", { length: 20 }),
```

Both nullable, no defaults.

**Step 2: Build the db package**

Run: `pnpm --filter @babji/db build`
Expected: Clean build, no errors.

**Step 3: Run the ALTER TABLE on production**

```bash
ssh root@65.20.76.199 'docker exec -i babji-postgres psql -U babji -d babji -c "
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_domain VARCHAR(100);
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meeting_briefing_pref VARCHAR(20);
"'
```

**Step 4: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add email_domain and meeting_briefing_pref columns to tenants"
```

---

### Task 2: Add new babji skill actions to registry

**Files:**
- Modify: `packages/skills/src/registry.ts:651-805` (checkWithTeacherSkill / babji skill)

**Step 1: Add three new actions to the babji skill**

In `packages/skills/src/registry.ts`, add these actions to the `checkWithTeacherSkill` (babji) skill's `actions` array, after the `delete_task` action (before the closing `]` around line 802):

```typescript
    {
      name: "enable_meeting_briefings",
      description: "Enable automatic pre-meeting attendee research briefings. Babji will research external attendees before calendar meetings and send you a dossier. Each person researched uses 1 daily use.",
      parameters: {
        timing: {
          type: "string",
          required: true,
          description: "When to deliver briefings: 'morning' (with daily calendar summary) or 'pre_meeting' (1 hour before each meeting)",
        },
      },
    },
    {
      name: "disable_meeting_briefings",
      description: "Turn off automatic meeting attendee briefings.",
      parameters: {},
    },
    {
      name: "research_meeting_attendees",
      description: "Research attendees of a specific upcoming meeting right now. Returns a dossier on each external attendee (non-teammate).",
      parameters: {
        meeting_query: {
          type: "string",
          required: true,
          description: "Which meeting to research, e.g. '2 PM meeting', 'meeting with Acme', 'next meeting'",
        },
      },
    },
```

**Step 2: Build the skills package**

Run: `pnpm --filter @babji/skills build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add packages/skills/src/registry.ts
git commit -m "feat(skills): add meeting briefing actions to babji skill registry"
```

---

### Task 3: Create MeetingBriefingService

This is the core module. It handles: extracting external attendees from events, researching them via PeopleHandler, caching results, and formatting the briefing.

**Files:**
- Create: `packages/gateway/src/meeting-briefing.ts`

**Step 1: Create the meeting briefing service**

Create `packages/gateway/src/meeting-briefing.ts`:

```typescript
import { eq } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import { PeopleHandler } from "@babji/skills";
import type { LlmClient } from "@babji/agent";
import { Brain, PromptBuilder, ToolExecutor } from "@babji/agent";
import { MemoryManager } from "@babji/memory";
import type { SkillDefinition } from "@babji/types";
import { GoogleCalendarHandler } from "@babji/skills";
import { ensureValidToken } from "./token-refresh.js";
import { TokenVault } from "@babji/crypto";
import { logger } from "./logger.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const MAX_MEETINGS = 5;
const MAX_ATTENDEES = 10;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

export class MeetingBriefingService {
  constructor(private deps: MeetingBriefingDeps) {}

  /**
   * Extract external attendees from a list of calendar events.
   * External = email domain differs from tenant's domain.
   * Deduplicates across meetings.
   */
  extractExternalAttendees(
    events: Array<Record<string, unknown>>,
    tenantDomain: string,
    tenantEmail?: string,
  ): MeetingWithExternals[] {
    const seen = new Set<string>();
    const results: MeetingWithExternals[] = [];
    let totalAttendees = 0;

    for (const event of events.slice(0, MAX_MEETINGS)) {
      const attendees = (event.attendees as Array<{ email?: string; displayName?: string; responseStatus?: string }>) || [];
      const externals: AttendeeInfo[] = [];

      for (const att of attendees) {
        if (!att.email) continue;
        const email = att.email.toLowerCase();

        // Skip self
        if (tenantEmail && email === tenantEmail.toLowerCase()) continue;

        // Skip internal (same domain)
        const domain = email.split("@")[1];
        if (domain === tenantDomain.toLowerCase()) continue;

        // Skip duplicates across meetings
        if (seen.has(email)) continue;
        seen.add(email);

        if (totalAttendees >= MAX_ATTENDEES) break;

        externals.push({
          email,
          displayName: att.displayName || email.split("@")[0],
        });
        totalAttendees++;
      }

      if (externals.length > 0) {
        results.push({
          eventId: event.id as string,
          summary: (event.summary as string) || "(No title)",
          startTime: (event.start as string) || "",
          attendees: externals,
        });
      }

      if (totalAttendees >= MAX_ATTENDEES) break;
    }

    return results;
  }

  /**
   * Research a single attendee. Checks cache first, falls back to PeopleHandler.
   */
  async researchAttendee(
    email: string,
    displayName: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    // Check cache
    const cache = await this.loadCache(tenantId);
    const cached = cache[email.toLowerCase()];
    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < CACHE_TTL_MS) {
        logger.debug({ email, tenantId }, "Using cached briefing profile");
        return cached.profile;
      }
    }

    // Research via PeopleHandler
    const people = new PeopleHandler(
      { login: this.deps.peopleConfig.dataforseoLogin, password: this.deps.peopleConfig.dataforseoPassword },
      { apiKey: this.deps.peopleConfig.scrapinApiKey },
    );

    const domain = email.split("@")[1];
    let result: Record<string, unknown>;

    try {
      // Try research by name + domain first
      result = await people.execute("research_person", {
        name: displayName,
        company_or_domain: domain,
      }) as Record<string, unknown>;
    } catch (err) {
      logger.warn({ err, email, displayName }, "People research failed for attendee");
      result = { found: false, email, displayName, error: (err as Error).message };
    }

    // Cache the result
    cache[email.toLowerCase()] = {
      profile: result,
      fetchedAt: new Date().toISOString(),
    };
    await this.saveCache(tenantId, cache);

    return result;
  }

  /**
   * Research all attendees across meetings and format a briefing.
   */
  async generateBriefing(
    meetings: MeetingWithExternals[],
    tenantId: string,
    tenantName: string,
    timezone: string,
  ): Promise<string> {
    // Research all attendees
    const profilesByEmail = new Map<string, Record<string, unknown>>();

    for (const meeting of meetings) {
      for (const att of meeting.attendees) {
        if (!profilesByEmail.has(att.email)) {
          const profile = await this.researchAttendee(att.email, att.displayName, tenantId);
          profilesByEmail.set(att.email, profile);
        }
      }
    }

    // Build raw data for the LLM to format
    const rawSections: string[] = [];

    for (const meeting of meetings) {
      let timeStr = "";
      if (meeting.startTime && meeting.startTime.includes("T")) {
        const d = new Date(meeting.startTime);
        timeStr = d.toLocaleString("en-US", {
          timeZone: timezone,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
      } else if (meeting.startTime) {
        timeStr = "All day";
      }

      rawSections.push(`\n=== Meeting: ${meeting.summary} (${timeStr}) ===`);

      for (const att of meeting.attendees) {
        const profile = profilesByEmail.get(att.email);
        rawSections.push(`\nAttendee: ${att.displayName} (${att.email})`);
        if (profile && profile.found) {
          rawSections.push(`Profile data: ${JSON.stringify(profile, null, 2)}`);
        } else {
          const msg = (profile as Record<string, unknown>)?.message || "No profile found";
          rawSections.push(`Could not find LinkedIn profile: ${msg}`);
        }
      }
    }

    // Format via lite LLM
    const brain = new Brain(this.deps.llm, new ToolExecutor());
    const result = await brain.process({
      systemPrompt: "You format meeting attendee briefings for a busy professional. Output plain text only -- no emojis, no markdown, no bold/italic. Be concise and scannable. For each meeting, show the meeting name and time, then for each attendee show: name (email), current title at company, top 2-3 previous roles with tenure, education, key skills, location, company overview (industry, size), and LinkedIn URL. If a profile was not found, just show the name and email with a note. Group by meeting.",
      messages: [{
        role: "user",
        content: `Format this meeting attendee data into a clean briefing for ${tenantName}:\n\n${rawSections.join("\n")}`,
      }],
      maxTurns: 1,
      tools: {},
    });

    return result.content;
  }

  /**
   * Infer email domain from calendar events (look at organizer/creator email).
   */
  inferDomainFromEvents(events: Array<Record<string, unknown>>): string | null {
    for (const event of events) {
      // Try organizer first, then creator
      const organizer = event.organizer as { email?: string } | undefined;
      const creator = event.creator as { email?: string } | undefined;
      const email = organizer?.email || creator?.email;
      if (email && email.includes("@")) {
        const domain = email.split("@")[1];
        // Skip generic calendar domains
        if (domain !== "calendar.google.com" && domain !== "group.calendar.google.com") {
          return domain;
        }
      }
    }
    return null;
  }

  private async loadCache(tenantId: string): Promise<BriefingCache> {
    const baseDir = process.env.MEMORY_BASE_DIR || "./data/tenants";
    const cachePath = path.join(baseDir, tenantId, "briefing-cache.json");
    try {
      const data = await fs.readFile(cachePath, "utf-8");
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  private async saveCache(tenantId: string, cache: BriefingCache): Promise<void> {
    const baseDir = process.env.MEMORY_BASE_DIR || "./data/tenants";
    const dir = path.join(baseDir, tenantId);
    await fs.mkdir(dir, { recursive: true });
    const cachePath = path.join(dir, "briefing-cache.json");
    await fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
  }
}
```

**Step 2: Build the gateway package**

Run: `pnpm --filter @babji/gateway build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add packages/gateway/src/meeting-briefing.ts
git commit -m "feat(gateway): create MeetingBriefingService with research pipeline and caching"
```

---

### Task 4: Wire babji skill actions in MessageHandler

**Files:**
- Modify: `packages/gateway/src/message-handler.ts:383-412` (babji skill handler registration)

**Step 1: Add meeting briefing action handlers**

In the `execute` function of the babji skill registration in `message-handler.ts` (around line 386-411), add handlers for the three new actions. Insert before the `throw new Error('Unknown babji action')` line (around line 410):

```typescript
          if (actionName === "enable_meeting_briefings") {
            const timing = params.timing as string;
            if (timing !== "morning" && timing !== "pre_meeting") {
              return { success: false, error: "timing must be 'morning' or 'pre_meeting'" };
            }
            await this.deps.db.update(schema.tenants)
              .set({ meetingBriefingPref: timing })
              .where(eq(schema.tenants.id, tenantId));
            const timingDesc = timing === "morning" ? "with your morning calendar summary" : "1 hour before each meeting";
            return { success: true, message: `Meeting briefings enabled. I will research external attendees and send you a briefing ${timingDesc}. Each person researched uses 1 of your daily uses.` };
          }
          if (actionName === "disable_meeting_briefings") {
            await this.deps.db.update(schema.tenants)
              .set({ meetingBriefingPref: null })
              .where(eq(schema.tenants.id, tenantId));
            return { success: true, message: "Meeting briefings disabled." };
          }
          if (actionName === "research_meeting_attendees") {
            return this.handleOnDemandBriefing(tenantId, tenant, params.meeting_query as string);
          }
```

**Step 2: Add the `handleOnDemandBriefing` method to `MessageHandler`**

Add this method to the `MessageHandler` class. It fetches today's calendar, fuzzy-matches the meeting, researches external attendees, and returns the formatted briefing.

```typescript
  private async handleOnDemandBriefing(
    tenantId: string,
    tenant: { name: string; timezone: string | null; emailDomain: string | null },
    meetingQuery: string,
  ): Promise<Record<string, unknown>> {
    if (!this.deps.peopleConfig?.enabled) {
      return { success: false, error: "People research is not configured on this server." };
    }

    // Get calendar token
    const tokenResult = await ensureValidToken(tenantId, "google_calendar", this.deps.vault, this.deps.db);
    if (!tokenResult || tokenResult.status === "expired") {
      return { success: false, error: "Google Calendar connection expired. Please reconnect." };
    }

    const timezone = tenant.timezone || "UTC";
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const dateStr = formatter.format(new Date());
    const timeMinISO = new Date(`${dateStr}T00:00:00+00:00`).toISOString();
    const timeMaxISO = new Date(`${dateStr}T23:59:59+00:00`).toISOString();

    const calHandler = new GoogleCalendarHandler(tokenResult.accessToken);
    const result = await calHandler.execute("list_events", {
      time_min: timeMinISO,
      time_max: timeMaxISO,
      max_results: 20,
    }) as { events: Array<Record<string, unknown>> };

    // Fuzzy match meeting by query (check summary contains query words)
    const queryLower = meetingQuery.toLowerCase();
    const matched = result.events.filter((e) => {
      const summary = ((e.summary as string) || "").toLowerCase();
      const start = (e.start as string) || "";
      // Match by title keywords or time
      return queryLower.split(/\s+/).some((word) => summary.includes(word) || start.includes(word));
    });

    if (matched.length === 0) {
      return { success: false, error: `Could not find a meeting matching "${meetingQuery}" on today's calendar.` };
    }

    const tenantDomain = tenant.emailDomain || this.inferDomainFromEvents(result.events);
    if (!tenantDomain) {
      return { success: false, error: "Could not determine your email domain. Please check your calendar has events you organized." };
    }

    const { MeetingBriefingService } = await import("./meeting-briefing.js");
    const briefingService = new MeetingBriefingService({
      db: this.deps.db,
      vault: this.deps.vault,
      llm: this.deps.llmLite,
      memory: this.deps.memory,
      availableSkills: this.deps.availableSkills,
      peopleConfig: this.deps.peopleConfig,
    });

    const meetings = briefingService.extractExternalAttendees(matched, tenantDomain);
    if (meetings.length === 0) {
      return { success: true, message: `The meeting "${(matched[0].summary as string) || meetingQuery}" has no external attendees to research.` };
    }

    const briefing = await briefingService.generateBriefing(meetings, tenantId, tenant.name, timezone);
    return { success: true, briefing };
  }

  private inferDomainFromEvents(events: Array<Record<string, unknown>>): string | null {
    for (const event of events) {
      const organizer = event.organizer as { email?: string } | undefined;
      const creator = event.creator as { email?: string } | undefined;
      const email = organizer?.email || creator?.email;
      if (email?.includes("@")) {
        const domain = email.split("@")[1];
        if (domain !== "calendar.google.com" && domain !== "group.calendar.google.com") {
          return domain;
        }
      }
    }
    return null;
  }
```

Note: The `tenant` variable at the call site (line ~158) already has `name`, `timezone`. After Task 1, it will also have `emailDomain`. Pass these fields when calling `handleOnDemandBriefing`.

**Step 3: Add `peopleConfig` property getter**

The `handleOnDemandBriefing` method references `this.deps.peopleConfig` which already exists on `MessageHandlerDeps` (line 103-108). No changes needed.

**Step 4: Build the gateway**

Run: `pnpm --filter @babji/gateway build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add packages/gateway/src/message-handler.ts
git commit -m "feat(gateway): wire meeting briefing actions into MessageHandler"
```

---

### Task 5: Integrate briefings into the daily calendar summary job

**Files:**
- Modify: `packages/gateway/src/job-runner.ts:179-273` (runCalendarSummary method)

**Step 1: Add MeetingBriefingService import**

At the top of `job-runner.ts` (around line 6), add:

```typescript
import { MeetingBriefingService } from "./meeting-briefing.js";
import { PeopleHandler } from "@babji/skills";
```

**Step 2: Add `peopleConfig` to `JobRunnerDeps`**

In the `JobRunnerDeps` interface (around line 97-105), add:

```typescript
  peopleConfig?: {
    scrapinApiKey: string;
    dataforseoLogin: string;
    dataforseoPassword: string;
  };
```

**Step 3: Extend `runCalendarSummary` to handle meeting briefings**

After sending the calendar summary message (after line 264 `logger.info(...)`) and before the `} catch (err)` block (line 267), add the meeting briefing logic:

```typescript
      // ── Meeting briefing integration ──
      if (this.deps.peopleConfig) {
        const briefingService = new MeetingBriefingService({
          db: this.deps.db,
          vault: this.deps.vault,
          llm: this.deps.llm,
          memory: this.deps.memory,
          availableSkills: this.deps.availableSkills,
          peopleConfig: this.deps.peopleConfig,
        });

        // Infer and store email domain if not yet known
        let tenantDomain = (tenant as Record<string, unknown>).emailDomain as string | null;
        if (!tenantDomain) {
          tenantDomain = briefingService.inferDomainFromEvents(result.events);
          if (tenantDomain) {
            await this.deps.db.update(schema.tenants)
              .set({ emailDomain: tenantDomain })
              .where(eq(schema.tenants.id, tenantId));
            logger.info({ tenantId, emailDomain: tenantDomain }, "Inferred and stored tenant email domain");
          }
        }

        if (tenantDomain) {
          const meetings = briefingService.extractExternalAttendees(result.events, tenantDomain);

          if (meetings.length > 0) {
            const pref = (tenant as Record<string, unknown>).meetingBriefingPref as string | null;
            const totalExternals = meetings.reduce((sum, m) => sum + m.attendees.length, 0);

            if (pref === "morning") {
              // Research and send briefing now
              try {
                const briefing = await briefingService.generateBriefing(
                  meetings, tenantId, tenant.name, timezone,
                );
                await adapter.sendMessage({
                  tenantId,
                  channel: channel as "telegram" | "whatsapp" | "app",
                  recipient: recipient!,
                  text: briefing,
                });
                logger.info({ tenantId, meetings: meetings.length, attendees: totalExternals }, "Sent morning meeting briefing");
              } catch (err) {
                logger.error({ err, tenantId }, "Failed to generate/send morning briefing");
              }
            } else if (pref === "pre_meeting") {
              // Schedule one-shot jobs 1 hour before each meeting
              for (const meeting of meetings) {
                if (!meeting.startTime || !meeting.startTime.includes("T")) continue;
                const meetingTime = new Date(meeting.startTime);
                const briefingTime = new Date(meetingTime.getTime() - 60 * 60 * 1000); // 1 hour before
                if (briefingTime <= new Date()) continue; // Already past

                await this.deps.db.insert(schema.scheduledJobs).values({
                  tenantId,
                  jobType: "meeting_briefing",
                  scheduleType: "once",
                  scheduledAt: briefingTime,
                  payload: {
                    eventId: meeting.eventId,
                    eventSummary: meeting.summary,
                    startTime: meeting.startTime,
                    attendees: meeting.attendees,
                    tenantDomain,
                  },
                });
                logger.info({ tenantId, meeting: meeting.summary, briefingAt: briefingTime.toISOString() }, "Scheduled pre-meeting briefing");
              }
            } else {
              // Briefing not enabled — suggest it organically
              const suggestionText = `\nYou have ${totalExternals} external attendee${totalExternals > 1 ? "s" : ""} across today's meetings. Want me to research them and send you a briefing before your meetings?`;
              await adapter.sendMessage({
                tenantId,
                channel: channel as "telegram" | "whatsapp" | "app",
                recipient: recipient!,
                text: suggestionText,
              });
              logger.info({ tenantId, externals: totalExternals }, "Suggested meeting briefings to tenant");
            }
          }
        }
      }
```

**Step 4: Build**

Run: `pnpm --filter @babji/gateway build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add packages/gateway/src/job-runner.ts
git commit -m "feat(gateway): integrate meeting briefings into daily calendar summary job"
```

---

### Task 6: Add `meeting_briefing` job type to JobRunner

**Files:**
- Modify: `packages/gateway/src/job-runner.ts:159-177` (executeJob switch) and add new method

**Step 1: Add the case to executeJob**

In the `executeJob` method's switch statement (around line 160-177), add before the `default` case:

```typescript
      case "meeting_briefing":
        await this.runMeetingBriefing(job);
        break;
```

**Step 2: Add the `runMeetingBriefing` method**

Add this method to the `JobRunner` class:

```typescript
  private async runMeetingBriefing(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const tenantId = job.tenantId;
    const payload = job.payload as {
      eventId?: string;
      eventSummary?: string;
      startTime?: string;
      attendees?: Array<{ email: string; displayName: string }>;
      tenantDomain?: string;
    } | null;

    if (!payload?.attendees || !payload.tenantDomain) {
      logger.warn({ jobId: job.id }, "meeting_briefing job missing attendees or tenantDomain");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) return;

    const recipient = tenant.telegramUserId || tenant.phone;
    const channel = (tenant.telegramUserId ? "telegram" : "whatsapp") as "telegram" | "whatsapp" | "app";
    if (!recipient) return;

    const adapter = this.deps.adapters.find((a) => a.name === channel);
    if (!adapter) return;

    if (!this.deps.peopleConfig) {
      logger.warn({ jobId: job.id }, "meeting_briefing: people config not available");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    // Re-check if the meeting still exists (might have been cancelled)
    const tokenResult = await ensureValidToken(tenantId, "google_calendar", this.deps.vault, this.deps.db);
    if (tokenResult && tokenResult.status !== "expired" && payload.eventId) {
      try {
        const calHandler = new GoogleCalendarHandler(tokenResult.accessToken);
        // Try to fetch the specific event — if it 404s, it was cancelled
        const eventCheck = await calHandler.execute("list_events", {
          time_min: new Date().toISOString(),
          time_max: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          max_results: 50,
        }) as { events: Array<Record<string, unknown>> };

        const stillExists = eventCheck.events.some((e) => e.id === payload.eventId);
        if (!stillExists) {
          logger.info({ jobId: job.id, eventId: payload.eventId }, "Meeting was cancelled, skipping briefing");
          await this.deps.db.update(schema.scheduledJobs)
            .set({ status: "completed", lastRunAt: new Date() })
            .where(eq(schema.scheduledJobs.id, job.id));
          return;
        }
      } catch {
        // If calendar check fails, proceed with briefing anyway
      }
    }

    const timezone = tenant.timezone || "UTC";

    const briefingService = new MeetingBriefingService({
      db: this.deps.db,
      vault: this.deps.vault,
      llm: this.deps.llm,
      memory: this.deps.memory,
      availableSkills: this.deps.availableSkills,
      peopleConfig: this.deps.peopleConfig,
    });

    const meetings = [{
      eventId: payload.eventId || "",
      summary: payload.eventSummary || "(Meeting)",
      startTime: payload.startTime || "",
      attendees: payload.attendees,
    }];

    try {
      const briefing = await briefingService.generateBriefing(meetings, tenantId, tenant.name, timezone);

      await adapter.sendMessage({
        tenantId,
        channel,
        recipient,
        text: briefing,
      });

      logger.info({ tenantId, meeting: payload.eventSummary, attendees: payload.attendees.length }, "Sent pre-meeting briefing");
    } catch (err) {
      logger.error({ err, tenantId, jobId: job.id }, "Failed to generate/send pre-meeting briefing");
    }

    // One-time job — mark completed
    await this.deps.db.update(schema.scheduledJobs)
      .set({ status: "completed", lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));
  }
```

**Step 3: Build**

Run: `pnpm --filter @babji/gateway build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add packages/gateway/src/job-runner.ts
git commit -m "feat(gateway): add meeting_briefing job type to JobRunner"
```

---

### Task 7: Pass peopleConfig to JobRunner in gateway index

**Files:**
- Modify: `packages/gateway/src/index.ts` (where JobRunner is instantiated)

**Step 1: Find where JobRunner is created and add `peopleConfig`**

The JobRunner is instantiated in `packages/gateway/src/index.ts`. Find the `new JobRunner(...)` call and add the `peopleConfig` field from the existing config values that are already used for the `MessageHandler`:

```typescript
    peopleConfig: config.scrapinApiKey ? {
      scrapinApiKey: config.scrapinApiKey,
      dataforseoLogin: config.dataforseoLogin,
      dataforseoPassword: config.dataforseoPassword,
    } : undefined,
```

**Step 2: Build**

Run: `pnpm --filter @babji/gateway build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add packages/gateway/src/index.ts
git commit -m "feat(gateway): pass peopleConfig to JobRunner for meeting briefings"
```

---

### Task 8: Add meeting briefing guidance to PromptBuilder

**Files:**
- Modify: `packages/agent/src/prompt-builder.ts:88-114` (after task management rules section)

**Step 1: Add meeting briefing rules**

In `packages/agent/src/prompt-builder.ts`, after the task management rules section (after line 105, `parts.push("  - Use recurrence for open-ended repeating tasks...")`) and before the Credits section (line 107 `parts.push("")`), add:

```typescript
    parts.push("");
    parts.push("## Meeting briefing rules");
    parts.push("You can research external attendees before meetings:");
    parts.push("- Use babji.research_meeting_attendees for on-demand briefings (e.g. 'who am I meeting at 2 PM?', 'brief me on my next meeting')");
    parts.push("- Use babji.enable_meeting_briefings to turn on automatic briefings ('morning' = with daily summary, 'pre_meeting' = 1 hour before each meeting)");
    parts.push("- Use babji.disable_meeting_briefings to turn them off");
    parts.push("- When suggesting meeting briefings, explain: 'I can research the people you are meeting today -- their role, background, and company. Each person uses 1 of your daily uses.'");
    parts.push("- If the user's daily calendar summary mentions external attendees and briefings are not enabled, the system will suggest it automatically. Support the suggestion if the user asks about it.");
```

**Step 2: Build**

Run: `pnpm --filter @babji/agent build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add packages/agent/src/prompt-builder.ts
git commit -m "feat(agent): add meeting briefing guidance to PromptBuilder"
```

---

### Task 9: Build, test, update CHANGELOG, and deploy

**Files:**
- Build: all 4 packages (db, agent, skills, gateway)
- Modify: `CHANGELOG.md`

**Step 1: Build all packages**

```bash
pnpm --filter @babji/db build
pnpm --filter @babji/agent build
pnpm --filter @babji/skills build
pnpm --filter @babji/gateway build
```

Expected: All clean builds.

**Step 2: Run tests**

```bash
pnpm --filter @babji/gateway test
```

Expected: All tests pass (34/34).

**Step 3: Update CHANGELOG.md**

Add an entry at the top of the `## 2026-03-09` section:

```markdown
### Meeting attendee briefing (BAB-5) [NOT YET DEPLOYED]
- **What:** Pre-meeting attendee research and briefing. When the daily calendar summary runs, detects external attendees (different email domain). If briefings enabled, researches them via Scrapin.io + DataForSEO (LinkedIn profiles) and sends a rich dossier. Two timing modes: "morning" (with calendar summary) or "pre_meeting" (1 hour before each meeting). On-demand via "brief me on my 2 PM meeting". Organic discovery -- suggests the feature when external attendees detected. Results cached 7 days per tenant.
- **Files:** `packages/db/src/schema.ts`, `packages/skills/src/registry.ts`, `packages/gateway/src/meeting-briefing.ts` (new), `packages/gateway/src/job-runner.ts`, `packages/gateway/src/message-handler.ts`, `packages/gateway/src/index.ts`, `packages/agent/src/prompt-builder.ts`
- **DB migration:** `ALTER TABLE tenants ADD COLUMN email_domain VARCHAR(100); ALTER TABLE tenants ADD COLUMN meeting_briefing_pref VARCHAR(20);`
```

**Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add meeting briefing feature to CHANGELOG"
```

**Step 5: Deploy to production**

```bash
# Sync
rsync -az --delete --exclude node_modules --exclude .git --exclude .env --exclude data /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

# Install deps
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'

# Restart gateway
ssh root@65.20.76.199 'kill $(pgrep -f "packages/gateway"); sleep 2; nohup /opt/babji/start-gateway.sh > /var/log/babji-gateway.log 2>&1 &'

# Verify
ssh root@65.20.76.199 'sleep 3 && tail -5 /var/log/babji-gateway.log'
```

Expected: "Babji Gateway running" in logs.

**Step 6: Update CHANGELOG entry to [DEPLOYED]**

Change `[NOT YET DEPLOYED]` to `[DEPLOYED]` and commit:

```bash
git add CHANGELOG.md
git commit -m "docs: mark meeting briefing as deployed"
```
