# Profile Verification & Correction Workflow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a global profile directory (DB table), evening calendar scanner, admin review UI, and LinkedIn URL correction/re-scrape flow so wrong profiles are caught before reaching users.

**Architecture:** New `profile_directory` DB table replaces per-tenant disk cache. Evening `profile_scan` job researches tomorrow's external attendees. Admin reviews via dashboard + Telegram notifications. Corrections update the global directory for all tenants.

**Tech Stack:** Drizzle ORM (PostgreSQL), Fastify (gateway API), Next.js 15 (admin dashboard), grammy (Telegram bot), Scrapin.io + DataForSEO (people research)

---

### Task 1: Add `profileDirectory` table to DB schema

**Files:**
- Modify: `packages/db/src/schema.ts`

**Step 1: Add enum and table definition**

Add after the `todos` table definition (line 143):

```typescript
export const profileStatusEnum = pgEnum("profile_status", [
  "pending",
  "verified",
  "corrected",
  "failed",
]);

export const profileDirectory = pgTable(
  "profile_directory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    displayName: varchar("display_name", { length: 255 }),
    linkedinUrl: text("linkedin_url"),
    scrapedData: jsonb("scraped_data").$type<Record<string, unknown>>(),
    status: profileStatusEnum("status").notNull().default("pending"),
    scrapedAt: timestamp("scraped_at"),
    verifiedBy: varchar("verified_by", { length: 100 }),
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_profile_email").on(table.email),
    index("idx_profile_status").on(table.status),
  ]
);
```

**Step 2: Verify the schema compiles**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/db build`
Expected: Success, no type errors

**Step 3: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat: add profileDirectory table to schema for global profile cache"
```

---

### Task 2: Run DB migration on production

**Step 1: Run ALTER TABLE**

```bash
ssh root@65.20.76.199 "docker exec -i babji-postgres-1 psql -U babji -d babji" <<'SQL'
CREATE TYPE profile_status AS ENUM ('pending', 'verified', 'corrected', 'failed');

CREATE TABLE profile_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255),
  linkedin_url TEXT,
  scraped_data JSONB,
  status profile_status NOT NULL DEFAULT 'pending',
  scraped_at TIMESTAMP,
  verified_by VARCHAR(100),
  verified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profile_email ON profile_directory(email);
CREATE INDEX idx_profile_status ON profile_directory(status);
SQL
```

**Step 2: Verify**

```bash
ssh root@65.20.76.199 "docker exec -i babji-postgres-1 psql -U babji -d babji -c '\d profile_directory'"
```

Expected: Table description with all columns.

---

### Task 3: Update MeetingBriefingService to use global profile directory

**Files:**
- Modify: `packages/gateway/src/meeting-briefing.ts`

**Changes to make:**

1. Add `Database` import and `db` to the constructor deps (already has it)
2. Replace `researchAttendee` method to query `profile_directory` instead of per-tenant disk cache:
   - Query by email (case-insensitive)
   - If found with status `verified`/`corrected` and `scraped_at` < 30 days, return `scraped_data`
   - If found with status `pending` and `scraped_at` < 7 days, return `scraped_data`
   - If not found or stale, research via PeopleHandler, UPSERT into `profile_directory` with status `pending`
   - On research failure, UPSERT with status `failed` and error in scraped_data
3. Remove `loadCache` and `saveCache` private methods (no longer needed)
4. Remove `BriefingCache` and `CacheEntry` interfaces
5. Keep `CACHE_TTL_MS` but rename to `PENDING_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000` and add `VERIFIED_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000`

**Key code for the new `researchAttendee`:**

```typescript
async researchAttendee(
  email: string,
  displayName: string,
  _tenantId: string, // kept for API compat, no longer used for per-tenant cache
): Promise<Record<string, unknown>> {
  const normalizedEmail = email.toLowerCase();

  // Check global profile directory
  const existing = await this.deps.db.query.profileDirectory.findFirst({
    where: eq(schema.profileDirectory.email, normalizedEmail),
  });

  if (existing?.scrapedData && existing.scrapedAt) {
    const age = Date.now() - new Date(existing.scrapedAt).getTime();
    const isVerified = existing.status === "verified" || existing.status === "corrected";
    const maxAge = isVerified ? VERIFIED_CACHE_TTL_MS : PENDING_CACHE_TTL_MS;

    if (age < maxAge && existing.status !== "failed") {
      logger.debug({ email, status: existing.status }, "Using cached profile from directory");
      return existing.scrapedData;
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

    // Upsert into profile_directory
    const linkedinUrl = (result.linkedInUrl as string) || null;
    await this.deps.db.insert(schema.profileDirectory).values({
      email: normalizedEmail,
      displayName,
      linkedinUrl,
      scrapedData: result,
      status: "pending",
      scrapedAt: new Date(),
    }).onConflictDoUpdate({
      target: schema.profileDirectory.email,
      set: {
        displayName,
        linkedinUrl,
        scrapedData: result,
        status: "pending",
        scrapedAt: new Date(),
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, email }, "Failed to research attendee");

    const errorData = { found: false, email, displayName, error: message };

    // Upsert with failed status
    await this.deps.db.insert(schema.profileDirectory).values({
      email: normalizedEmail,
      displayName,
      scrapedData: errorData,
      status: "failed",
      scrapedAt: new Date(),
    }).onConflictDoUpdate({
      target: schema.profileDirectory.email,
      set: {
        displayName,
        scrapedData: errorData,
        status: "failed",
        scrapedAt: new Date(),
      },
    });

    return errorData;
  }
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway build`

**Step 3: Run tests**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add packages/gateway/src/meeting-briefing.ts
git commit -m "feat: switch MeetingBriefingService from disk cache to global profile directory DB table"
```

---

### Task 4: Add evening profile_scan job to JobRunner

**Files:**
- Modify: `packages/gateway/src/job-runner.ts`

**Changes:**

1. Add `profile_scan` to the `executeJob` switch statement
2. In `runCalendarSummary`, after the meeting briefing integration block, add logic to schedule a `profile_scan` job for 6 PM local time if one doesn't already exist for today
3. New `runProfileScan` method:
   - Get all calendar-connected tenants (query `service_connections` for provider `google_calendar`)
   - For each tenant: fetch tomorrow's events, extract external attendees
   - For each new email not in `profile_directory`: research via PeopleHandler, insert with status `pending`
   - Cap at 20 new profiles per scan
   - Collect all newly added profiles
   - If any new profiles, call `AdminNotifier.notifyNewProfiles()` (Task 5)
   - Mark job completed (one-shot, re-created daily by calendar summary)

**Key code for scheduling in `runCalendarSummary`:**

After the existing meeting briefing block (around line 355), add:

```typescript
// Schedule evening profile scan for tomorrow's meetings
if (this.deps.peopleConfig) {
  const existing = await this.deps.db.query.scheduledJobs.findFirst({
    where: and(
      eq(schema.scheduledJobs.tenantId, tenantId),
      eq(schema.scheduledJobs.jobType, "profile_scan"),
      eq(schema.scheduledJobs.status, "active"),
    ),
  });

  if (!existing) {
    const scanTime = nextUtcForLocalTime("18:00", timezone);
    await this.deps.db.insert(schema.scheduledJobs).values({
      tenantId,
      jobType: "profile_scan",
      scheduleType: "once",
      scheduledAt: scanTime,
      payload: { tenantDomain: tenantDomain },
    });
    logger.info({ tenantId, scanTime: scanTime.toISOString() }, "Scheduled evening profile scan");
  }
}
```

**Key code for `runProfileScan`:**

```typescript
private async runProfileScan(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
  const tenantId = job.tenantId;
  const payload = job.payload as { tenantDomain?: string } | null;

  if (!payload?.tenantDomain || !this.deps.peopleConfig) {
    await this.deps.db.update(schema.scheduledJobs)
      .set({ status: "failed", lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));
    return;
  }

  const tenant = await this.deps.db.query.tenants.findFirst({
    where: eq(schema.tenants.id, tenantId),
  });
  if (!tenant) {
    await this.deps.db.update(schema.scheduledJobs)
      .set({ status: "completed", lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));
    return;
  }

  const timezone = tenant.timezone || "UTC";
  const tokenResult = await ensureValidToken(tenantId, "google_calendar", this.deps.vault, this.deps.db);
  if (!tokenResult || tokenResult.status === "expired") {
    await this.deps.db.update(schema.scheduledJobs)
      .set({ status: "completed", lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));
    return;
  }

  // Fetch TOMORROW's events
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const todayStr = formatter.format(now);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = formatter.format(tomorrow);
  const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const dayAfterStr = formatter.format(dayAfter);

  const timeMinISO = new Date(`${tomorrowStr}T00:00:00+00:00`).toISOString();
  const timeMaxISO = new Date(`${dayAfterStr}T00:00:00+00:00`).toISOString();

  try {
    const calHandler = new GoogleCalendarHandler(tokenResult.accessToken);
    const result = await calHandler.execute("list_events", {
      time_min: timeMinISO,
      time_max: timeMaxISO,
      max_results: 50,
    }) as { events: Array<Record<string, unknown>>; count: number };

    const briefingService = new MeetingBriefingService({
      db: this.deps.db, vault: this.deps.vault, llm: this.deps.llm,
      memory: this.deps.memory, availableSkills: this.deps.availableSkills,
      peopleConfig: this.deps.peopleConfig!,
    });

    const meetings = briefingService.extractExternalAttendees(
      result.events, payload.tenantDomain,
    );

    // Collect unique attendee emails not yet in profile_directory
    const newProfiles: Array<{ email: string; displayName: string; meeting: string; tenantName: string }> = [];
    let researchCount = 0;
    const MAX_NEW_PER_SCAN = 20;

    for (const meeting of meetings) {
      for (const attendee of meeting.attendees) {
        if (researchCount >= MAX_NEW_PER_SCAN) break;

        const normalizedEmail = attendee.email.toLowerCase();
        const existing = await this.deps.db.query.profileDirectory.findFirst({
          where: eq(schema.profileDirectory.email, normalizedEmail),
        });

        if (existing) continue; // Already in directory

        // Research and insert
        const profile = await briefingService.researchAttendee(
          attendee.email, attendee.displayName, tenantId,
        );
        researchCount++;

        newProfiles.push({
          email: attendee.email,
          displayName: attendee.displayName,
          meeting: meeting.summary,
          tenantName: tenant.name,
        });
      }
      if (researchCount >= MAX_NEW_PER_SCAN) break;
    }

    // Notify admin of new profiles
    if (newProfiles.length > 0 && this.deps.adminNotifier) {
      await this.deps.adminNotifier.notifyNewProfiles(newProfiles, tomorrowStr);
    }

    logger.info({ tenantId, newProfiles: newProfiles.length, total: researchCount }, "Profile scan completed");
  } catch (err) {
    logger.error({ err, tenantId }, "Profile scan failed");
  }

  await this.deps.db.update(schema.scheduledJobs)
    .set({ status: "completed", lastRunAt: new Date() })
    .where(eq(schema.scheduledJobs.id, job.id));
}
```

**Step 2: Add `adminNotifier` to `JobRunnerDeps` interface:**

```typescript
export interface JobRunnerDeps {
  // ... existing fields ...
  adminNotifier?: AdminNotifier;
}
```

**Step 3: Verify it compiles**

Run: `pnpm --filter @babji/gateway build`

**Step 4: Run tests**

Run: `pnpm --filter @babji/gateway test`

**Step 5: Commit**

```bash
git add packages/gateway/src/job-runner.ts
git commit -m "feat: add profile_scan job type for evening pre-scanning tomorrow's meetings"
```

---

### Task 5: Add `notifyNewProfiles` method to AdminNotifier

**Files:**
- Modify: `packages/gateway/src/admin-notifier.ts`

**Step 1: Add the method**

```typescript
async notifyNewProfiles(
  profiles: Array<{ email: string; displayName: string; meeting: string; tenantName: string }>,
  dateStr: string,
): Promise<void> {
  const lines = [`New meeting attendees discovered (${dateStr}):\n`];

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    lines.push(`${i + 1}. ${p.email} -> ${p.displayName}`);
    lines.push(`   Meeting: "${p.meeting}" (for ${p.tenantName})`);
  }

  lines.push("");
  lines.push("Review & correct: babji.quantana.top/admin -> Profile Directory");

  await this.notify(lines.join("\n"));
}
```

**Step 2: Verify it compiles**

Run: `pnpm --filter @babji/gateway build`

**Step 3: Commit**

```bash
git add packages/gateway/src/admin-notifier.ts
git commit -m "feat: add notifyNewProfiles method to AdminNotifier for evening scan alerts"
```

---

### Task 6: Pass AdminNotifier to JobRunner in index.ts

**Files:**
- Modify: `packages/gateway/src/index.ts`

**Step 1: Pass `adminNotifier` in the JobRunner constructor call**

The AdminNotifier is already created in index.ts. Just add it to the JobRunner deps:

```typescript
adminNotifier,
```

**Step 2: Verify it compiles and tests pass**

Run: `pnpm --filter @babji/gateway build && pnpm --filter @babji/gateway test`

**Step 3: Commit**

```bash
git add packages/gateway/src/index.ts
git commit -m "feat: pass adminNotifier to JobRunner for profile scan notifications"
```

---

### Task 7: Add admin API endpoints for profile directory

**Files:**
- Create: `apps/oauth-portal/src/app/api/admin/profiles/route.ts`
- Create: `apps/oauth-portal/src/app/api/admin/profiles/[id]/verify/route.ts`
- Create: `apps/oauth-portal/src/app/api/admin/profiles/[id]/rescrape/route.ts`

**Step 1: Create GET /api/admin/profiles**

`apps/oauth-portal/src/app/api/admin/profiles/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { desc, eq } from "drizzle-orm";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");

  const databaseUrl = process.env.DATABASE_URL || "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    let profiles;
    if (statusFilter) {
      profiles = await db.select().from(schema.profileDirectory)
        .where(eq(schema.profileDirectory.status, statusFilter as any))
        .orderBy(desc(schema.profileDirectory.createdAt));
    } else {
      profiles = await db.select().from(schema.profileDirectory)
        .orderBy(desc(schema.profileDirectory.createdAt));
    }

    return NextResponse.json({ profiles });
  } finally {
    await close();
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as { id: string; linkedinUrl: string };
  if (!body.id || !body.linkedinUrl) {
    return NextResponse.json({ error: "Missing id or linkedinUrl" }, { status: 400 });
  }

  const databaseUrl = process.env.DATABASE_URL || "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    await db.update(schema.profileDirectory)
      .set({ linkedinUrl: body.linkedinUrl })
      .where(eq(schema.profileDirectory.id, body.id));

    return NextResponse.json({ ok: true });
  } finally {
    await close();
  }
}
```

**Step 2: Create POST /api/admin/profiles/[id]/verify**

`apps/oauth-portal/src/app/api/admin/profiles/[id]/verify/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { eq } from "drizzle-orm";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const databaseUrl = process.env.DATABASE_URL || "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    await db.update(schema.profileDirectory)
      .set({
        status: "verified",
        verifiedBy: "admin",
        verifiedAt: new Date(),
      })
      .where(eq(schema.profileDirectory.id, id));

    return NextResponse.json({ ok: true });
  } finally {
    await close();
  }
}
```

**Step 3: Create POST /api/admin/profiles/[id]/rescrape**

`apps/oauth-portal/src/app/api/admin/profiles/[id]/rescrape/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { eq } from "drizzle-orm";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { PeopleHandler } from "@babji/skills";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const databaseUrl = process.env.DATABASE_URL || "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    const profile = await db.query.profileDirectory.findFirst({
      where: eq(schema.profileDirectory.id, id),
    });

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (!profile.linkedinUrl) {
      return NextResponse.json({ error: "No LinkedIn URL to scrape" }, { status: 400 });
    }

    const scrapinApiKey = process.env.SCRAPIN_API_KEY;
    const dataforseoLogin = process.env.DATAFORSEO_LOGIN;
    const dataforseoPassword = process.env.DATAFORSEO_PASSWORD;

    if (!scrapinApiKey || !dataforseoLogin || !dataforseoPassword) {
      return NextResponse.json({ error: "People research config not available" }, { status: 503 });
    }

    const people = new PeopleHandler(
      { login: dataforseoLogin, password: dataforseoPassword },
      { apiKey: scrapinApiKey },
    );

    const result = await people.execute("lookup_profile", {
      linkedin_url: profile.linkedinUrl,
    }) as Record<string, unknown>;

    const newStatus = profile.status === "pending" || profile.status === "failed"
      ? "corrected"
      : profile.status;

    await db.update(schema.profileDirectory)
      .set({
        scrapedData: result,
        scrapedAt: new Date(),
        status: newStatus,
        verifiedBy: "admin",
        verifiedAt: new Date(),
      })
      .where(eq(schema.profileDirectory.id, id));

    return NextResponse.json({ ok: true, profile: result });
  } finally {
    await close();
  }
}
```

**Step 4: Verify it compiles**

Run: `pnpm --filter oauth-portal build`

**Step 5: Commit**

```bash
git add apps/oauth-portal/src/app/api/admin/profiles/
git commit -m "feat: add admin API endpoints for profile directory (list, verify, rescrape)"
```

---

### Task 8: Add Profile Directory section to admin dashboard

**Files:**
- Modify: `apps/oauth-portal/src/app/api/admin/data/route.ts` — add `profileDirectory` to the data response
- Modify: `apps/oauth-portal/src/app/admin/dashboard/client.tsx` — add Profile Directory section

**Step 1: Update data route to include profiles**

In `route.ts`, add to the Promise.all:

```typescript
db.select().from(schema.profileDirectory).orderBy(desc(schema.profileDirectory.createdAt)),
```

And update the response:

```typescript
return NextResponse.json({ tenants, connections, skillRequests, recentAudit, profiles });
```

**Step 2: Add Profile interface and update DashboardData in client.tsx**

```typescript
interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  linkedinUrl: string | null;
  scrapedData: Record<string, unknown> | null;
  status: string;
  scrapedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

interface DashboardData {
  tenants: Tenant[];
  connections: Connection[];
  skillRequests: SkillRequest[];
  recentAudit: AuditEntry[];
  profiles: Profile[];
}
```

**Step 3: Add Profile Directory card component**

After the Skill Requests card and before Recent Activity, add a new card with:
- Table showing: Email, Name/Title, LinkedIn URL (truncated), Status badge, Scraped At, Actions
- Filter buttons: All, Pending, Failed
- Verify button (green) — calls `POST /api/admin/profiles/:id/verify`
- Edit button — shows inline edit field for LinkedIn URL
- Rescrape button — calls `POST /api/admin/profiles/:id/rescrape`
- Expanded row on click — shows full `scrapedData` formatted

The UI should follow the existing card/table patterns in `client.tsx` (same `cardStyle`, `badgeStyle`, table structure).

**Status badge colors:**
- pending: `#6b7280` (gray)
- verified: `#10b981` (green)
- corrected: `#2563eb` (blue)
- failed: `#ef4444` (red)

**Step 4: Verify it compiles**

Run: `pnpm --filter oauth-portal build`

**Step 5: Commit**

```bash
git add apps/oauth-portal/src/app/api/admin/data/route.ts apps/oauth-portal/src/app/admin/dashboard/client.tsx
git commit -m "feat: add Profile Directory section to admin dashboard with verify/edit/rescrape"
```

---

### Task 9: Update CHANGELOG and deploy

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add changelog entry**

Add under `## 2026-03-09`, after the meeting briefing entry:

```markdown
### Profile verification & correction workflow [DEPLOYED]
- **What:** Global profile directory (DB table) replaces per-tenant disk cache for meeting attendee profiles. Evening scanner job (`profile_scan`) researches tomorrow's external attendees and notifies admin of new profiles. Admin dashboard "Profile Directory" section shows all profiles with verify/edit/rescrape actions. Admin can paste correct LinkedIn URL and trigger re-scrape. Corrections are global — benefit all tenants.
- **Files:** `packages/db/src/schema.ts`, `packages/gateway/src/meeting-briefing.ts`, `packages/gateway/src/job-runner.ts`, `packages/gateway/src/admin-notifier.ts`, `packages/gateway/src/index.ts`, `apps/oauth-portal/src/app/api/admin/profiles/` (new), `apps/oauth-portal/src/app/api/admin/data/route.ts`, `apps/oauth-portal/src/app/admin/dashboard/client.tsx`
- **DB migration:** `CREATE TABLE profile_directory (...)` with `profile_status` enum
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "chore: add profile verification workflow to CHANGELOG"
```

**Step 3: Build, deploy, and verify**

```bash
# Build locally
pnpm --filter @babji/gateway build

# Sync to server
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

# Install deps on server
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'

# Restart gateway
ssh root@65.20.76.199 'kill $(pgrep -f "packages/gateway"); nohup /opt/babji/start-gateway.sh > /var/log/babji-gateway.log 2>&1 &'

# Verify gateway
ssh root@65.20.76.199 'sleep 2 && tail -10 /var/log/babji-gateway.log'

# Build and restart OAuth portal
ssh root@65.20.76.199 'cd /opt/babji && pnpm --filter oauth-portal build'
ssh root@65.20.76.199 'kill $(pgrep -f "next-server") 2>/dev/null; sleep 1; nohup /opt/babji/start-oauth-portal.sh > /var/log/babji-oauth.log 2>&1 &'

# Verify OAuth portal
ssh root@65.20.76.199 'sleep 3 && tail -5 /var/log/babji-oauth.log'
```
