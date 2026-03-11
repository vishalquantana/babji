# Daily Jira Report (BAB-38) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-send a daily Jira report at 09:00 (configurable) for every tenant with a connected Jira account, covering assigned open issues and recent project activity.

**Architecture:** New `DailyJiraReportService` class follows the `DailyBriefingService` pattern. A `daily_jira_report` job type is added to `JobRunner`. Auto-seeded on Jira OAuth connect. Configurable via a new `configure_jira_report` action in the `babji` skill.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL), JiraHandler (Atlassian REST API v3), Vercel AI SDK (Gemini lite model)

---

### Task 1: Add `jiraReportPref` column to tenants schema

**Files:**
- Modify: `packages/db/src/schema.ts:38` (after `briefingPref` line)

**Step 1: Add the column**

In `packages/db/src/schema.ts`, add after line 38 (`briefingPref`):

```typescript
jiraReportPref: varchar("jira_report_pref", { length: 20 }).default("morning"),
```

**Step 2: Run the ALTER TABLE on production**

```bash
ssh root@65.20.76.199 'docker exec -i babji-postgres psql -U babji -d babji -c "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS jira_report_pref VARCHAR(20) DEFAULT '\''morning'\'';"'
```

**Step 3: Verify locally**

```bash
pnpm --filter @babji/db build
```
Expected: builds without errors.

**Step 4: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add jiraReportPref column to tenants (BAB-38)"
```

---

### Task 2: Create `DailyJiraReportService`

**Files:**
- Create: `packages/gateway/src/daily-jira-report.ts`

**Step 1: Create the service file**

Create `packages/gateway/src/daily-jira-report.ts`:

```typescript
import { eq } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import { TokenVault } from "@babji/crypto";
import { JiraHandler } from "@babji/skills";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ensureValidToken } from "./token-refresh.js";
import { logger } from "./logger.js";

const REPORT_MODEL = "gemini-3.1-flash-lite-preview";

export interface DailyJiraReportDeps {
  db: Database;
  vault: TokenVault;
  googleApiKey: string;
}

interface ReportSection {
  label: string;
  content: string;
}

interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  priority: string;
  type: string;
  updated: string;
}

export class DailyJiraReportService {
  constructor(private deps: DailyJiraReportDeps) {}

  async generateReport(
    tenant: typeof schema.tenants.$inferSelect,
    timezone: string,
  ): Promise<string | null> {
    const tenantId = tenant.id;

    // Get Jira token + cloudId
    const tokenResult = await ensureValidToken(tenantId, "jira", this.deps.vault, this.deps.db);
    if (!tokenResult || tokenResult.status === "expired") {
      logger.warn({ tenantId }, "Jira token expired for daily report, skipping");
      return null;
    }

    const cloudId = tokenResult.cloudId;
    if (!cloudId) {
      logger.warn({ tenantId }, "No Jira cloudId available for daily report, skipping");
      return null;
    }

    const jira = new JiraHandler(tokenResult.accessToken, cloudId);
    const sections: ReportSection[] = [];

    // Fetch assigned issues and recently updated in parallel
    const [assignedSection, recentSection] = await Promise.all([
      this.getAssignedIssuesSection(jira, tenantId),
      this.getRecentActivitySection(jira, tenantId),
    ]);

    if (assignedSection) sections.push(assignedSection);
    if (recentSection) {
      // Deduplicate: remove issues from "recent" that are already in "assigned"
      if (assignedSection) {
        const assignedKeys = new Set(
          (assignedSection as ReportSection & { _keys?: string[] })._keys || [],
        );
        const filtered = (recentSection as ReportSection & { _keys?: string[]; _raw?: JiraIssue[] })
          ._raw?.filter((i) => !assignedKeys.has(i.key));
        if (filtered && filtered.length > 0) {
          const lines = filtered.map(
            (i) => `- ${i.key}: ${i.summary} (${i.status}, by ${i.assignee})`,
          );
          sections.push({
            label: "Recent activity in your projects",
            content: lines.join("\n"),
          });
        }
      } else {
        sections.push(recentSection);
      }
    }

    if (sections.length === 0) return null;

    return this.composeReport(tenant.name, timezone, sections);
  }

  private async getAssignedIssuesSection(
    jira: JiraHandler,
    tenantId: string,
  ): Promise<(ReportSection & { _keys: string[] }) | null> {
    try {
      const result = (await jira.execute("search_issues", {
        jql: "assignee = currentUser() AND status != Done ORDER BY status, priority DESC",
        max_results: 30,
      })) as { issues: JiraIssue[]; total: number };

      if (result.issues.length === 0) return null;

      // Group by status
      const byStatus = new Map<string, JiraIssue[]>();
      for (const issue of result.issues) {
        const group = byStatus.get(issue.status) || [];
        group.push(issue);
        byStatus.set(issue.status, group);
      }

      const lines: string[] = [];
      for (const [status, issues] of byStatus) {
        lines.push(`${status} (${issues.length}):`);
        for (const i of issues) {
          lines.push(`- ${i.key}: ${i.summary} (${i.priority})`);
        }
      }

      return {
        label: `Your assigned issues (${result.issues.length})`,
        content: lines.join("\n"),
        _keys: result.issues.map((i) => i.key),
      };
    } catch (err) {
      logger.warn({ err, tenantId }, "Daily Jira report: assigned issues fetch failed");
      return null;
    }
  }

  private async getRecentActivitySection(
    jira: JiraHandler,
    tenantId: string,
  ): Promise<(ReportSection & { _keys: string[]; _raw: JiraIssue[] }) | null> {
    try {
      // First get assigned issues to find project keys
      const assigned = (await jira.execute("search_issues", {
        jql: "assignee = currentUser() AND status != Done",
        max_results: 50,
      })) as { issues: JiraIssue[] };

      const projectKeys = new Set(assigned.issues.map((i) => i.key.split("-")[0]));
      if (projectKeys.size === 0) return null;

      const projectList = Array.from(projectKeys).join(", ");
      const jql = `project IN (${projectList}) AND updated >= -24h AND assignee != currentUser() ORDER BY updated DESC`;

      const result = (await jira.execute("search_issues", {
        jql,
        max_results: 20,
      })) as { issues: JiraIssue[] };

      if (result.issues.length === 0) return null;

      const lines = result.issues.map(
        (i) => `- ${i.key}: ${i.summary} (${i.status}, by ${i.assignee})`,
      );

      return {
        label: "Recent activity in your projects",
        content: lines.join("\n"),
        _keys: result.issues.map((i) => i.key),
        _raw: result.issues,
      };
    } catch (err) {
      logger.warn({ err, tenantId }, "Daily Jira report: recent activity fetch failed");
      return null;
    }
  }

  private async composeReport(
    userName: string,
    timezone: string,
    sections: ReportSection[],
  ): Promise<string> {
    const googleAi = createGoogleGenerativeAI({ apiKey: this.deps.googleApiKey });

    const rawData = sections.map((s) => `### ${s.label}\n${s.content}`).join("\n\n");

    try {
      const result = await generateText({
        model: googleAi(REPORT_MODEL),
        messages: [
          {
            role: "system",
            content: `You are Babji, a business assistant. Compose a concise daily Jira report for ${userName}. Rules:
- Start with "Here's your Jira report for today:"
- Group assigned issues by status
- Separately list what changed in their projects in the last 24 hours
- Use plain text only -- no markdown, no emojis, no bold/italic
- Use line breaks and dashes for structure
- Keep the total message under 2000 characters
- End with a brief one-liner like "Want me to update any of these?"`,
          },
          {
            role: "user",
            content: rawData,
          },
        ],
      });

      return result.text.trim();
    } catch (err) {
      logger.warn({ err }, "Daily Jira report: LLM composition failed, using raw format");
      const lines = [`Here's your Jira report for today:\n`];
      for (const s of sections) {
        lines.push(`-- ${s.label} --`);
        lines.push(s.content);
        lines.push("");
      }
      return lines.join("\n");
    }
  }
}
```

**Step 2: Verify it compiles**

```bash
pnpm --filter @babji/gateway build
```
Expected: builds without errors.

**Step 3: Commit**

```bash
git add packages/gateway/src/daily-jira-report.ts
git commit -m "feat: add DailyJiraReportService (BAB-38)"
```

---

### Task 3: Add `daily_jira_report` job type to JobRunner

**Files:**
- Modify: `packages/gateway/src/job-runner.ts:17` (add import)
- Modify: `packages/gateway/src/job-runner.ts:204` (add case in switch)
- Modify: `packages/gateway/src/job-runner.ts` (add `runDailyJiraReport` method before `rescheduleWeekly`)

**Step 1: Add the import**

At the top of `job-runner.ts`, after line 18 (`import { MemoryScannerService } from "./memory-scanner.js";`), add:

```typescript
import { DailyJiraReportService } from "./daily-jira-report.js";
```

**Step 2: Add the case to `executeJob` switch**

In the `executeJob` switch (after the `memory_scan` case around line 203), add:

```typescript
      case "daily_jira_report":
        await this.runDailyJiraReport(job);
        break;
```

**Step 3: Add the `runDailyJiraReport` method**

Add this method before `rescheduleWeekly` (before line 1390):

```typescript
  private async runDailyJiraReport(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const tenantId = job.tenantId;

    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) {
      logger.warn({ tenantId }, "Tenant not found for daily Jira report job");
      return;
    }

    // Check if Jira report is disabled
    const jiraReportPref = (tenant as Record<string, unknown>).jiraReportPref as string | null;
    if (jiraReportPref === "off") {
      logger.info({ tenantId }, "Daily Jira report disabled for tenant, skipping");
      const timezone = tenant.timezone || "UTC";
      await this.rescheduleDaily(job, timezone);
      return;
    }

    const timezone = tenant.timezone || "UTC";

    const recipient = tenant.telegramUserId || tenant.phone;
    const channel = tenant.telegramUserId ? "telegram" : "whatsapp";
    if (!recipient) {
      logger.warn({ tenantId }, "No recipient channel for daily Jira report");
      await this.rescheduleDaily(job, timezone);
      return;
    }

    const adapter = this.deps.adapters.find((a) => a.name === channel);
    if (!adapter) {
      logger.warn({ tenantId, channel }, "No adapter found for daily Jira report");
      await this.rescheduleDaily(job, timezone);
      return;
    }

    try {
      const reportService = new DailyJiraReportService({
        db: this.deps.db,
        vault: this.deps.vault,
        googleApiKey: this.deps.googleApiKey,
      });

      const message = await reportService.generateReport(tenant, timezone);

      if (message) {
        await adapter.sendMessage({
          tenantId,
          channel: channel as "telegram" | "whatsapp" | "app",
          recipient,
          text: message,
        });
        logger.info({ tenantId }, "Sent daily Jira report");
      } else {
        logger.info({ tenantId }, "Daily Jira report: nothing to report, silent skip");
      }

      // Log background job usage
      if (this.deps.usageTracker) {
        this.deps.usageTracker.logBackgroundJob({ tenantId, jobType: "daily_jira_report" }).catch(() => {});
      }
    } catch (err) {
      logger.error({ err, tenantId }, "Daily Jira report failed");
    }

    // Reschedule for tomorrow
    await this.rescheduleDaily(job, timezone);
  }
```

**Step 4: Verify it compiles**

```bash
pnpm --filter @babji/gateway build
```

**Step 5: Commit**

```bash
git add packages/gateway/src/job-runner.ts
git commit -m "feat: add daily_jira_report job type to JobRunner (BAB-38)"
```

---

### Task 4: Auto-seed job on Jira OAuth connect

**Files:**
- Modify: `packages/gateway/src/server.ts:221` (after the Gmail auto-seed block, before the `setImmediate`)

**Step 1: Add auto-seed block for Jira**

After the Gmail auto-seed block (line 221 — after `}` that closes `if (provider === "gmail" && db)`), add:

```typescript
    // Auto-seed daily Jira report when Jira is connected
    if (provider === "jira" && db) {
      try {
        const existingJiraReport = await db.query.scheduledJobs.findFirst({
          where: and(
            eq(schema.scheduledJobs.tenantId, tenantId),
            eq(schema.scheduledJobs.jobType, "daily_jira_report"),
          ),
        });

        if (!existingJiraReport) {
          const tenant = await db.query.tenants.findFirst({
            where: eq(schema.tenants.id, tenantId),
          });
          const timezone = tenant?.timezone || "UTC";
          const scheduledAt = nextUtcForLocalTime("09:00", timezone);

          await db.insert(schema.scheduledJobs).values({
            tenantId,
            jobType: "daily_jira_report",
            scheduleType: "daily",
            scheduledAt,
            recurrenceRule: "09:00",
            payload: {},
            status: "active",
          });

          logger.info({ tenantId, scheduledAt: scheduledAt.toISOString() }, "Seeded daily Jira report job on Jira connect");
        }
      } catch (err) {
        logger.error({ err, tenantId }, "Failed to seed daily Jira report job");
      }
    }
```

Also add `"jira"` to the `providerMeta` map (around line 71) so post-connect shows a summary:

```typescript
      jira: {
        displayName: "Jira",
        prompt: "I just connected my Jira account. Show me my currently assigned issues — what's in progress, what's waiting, and anything that needs attention.",
      },
```

**Step 2: Verify it compiles**

```bash
pnpm --filter @babji/gateway build
```

**Step 3: Commit**

```bash
git add packages/gateway/src/server.ts
git commit -m "feat: auto-seed daily Jira report on Jira connect (BAB-38)"
```

---

### Task 5: Add `configure_jira_report` action to skill registry + message handler

**Files:**
- Modify: `packages/skills/src/registry.ts` (add action to `babji` skill, around line 900)
- Modify: `packages/gateway/src/message-handler.ts` (add handler after `configure_email_digest`)

**Step 1: Add action to registry**

In `packages/skills/src/registry.ts`, find the `babji` skill's actions array. After the `configure_briefing` action (around line 901), add:

```typescript
    {
      name: "configure_jira_report",
      description: "Configure the daily Jira report. Automatically sends a report of your assigned issues and recent project activity every morning. Only available when Jira is connected.",
      parameters: {
        mode: {
          type: "string",
          required: true,
          description: "Report mode: 'on' (enable, default), or 'off' (disable)",
        },
        time: {
          type: "string",
          required: false,
          description: "Optional time override in HH:MM 24-hour format (e.g. '09:00'). Default is 09:00.",
        },
      },
    },
```

**Step 2: Add handler in message-handler.ts**

In `packages/gateway/src/message-handler.ts`, after the `configure_email_digest` handler block (find the closing `}` after the email digest config logic), add:

```typescript
          if (actionName === "configure_jira_report") {
            const mode = params.mode as string;
            const validModes = ["on", "off"];
            if (!validModes.includes(mode)) {
              return { success: false, error: "mode must be one of: " + validModes.join(", ") };
            }

            // Update tenant preference
            await this.deps.db.update(schema.tenants)
              .set({ jiraReportPref: mode === "on" ? "morning" : "off" } as Record<string, unknown>)
              .where(eq(schema.tenants.id, tenantId));

            const existingJob = await this.deps.db.query.scheduledJobs.findFirst({
              where: and(
                eq(schema.scheduledJobs.tenantId, tenantId),
                eq(schema.scheduledJobs.jobType, "daily_jira_report"),
              ),
            });

            if (mode === "off") {
              if (existingJob) {
                await this.deps.db.update(schema.scheduledJobs)
                  .set({ status: "paused" })
                  .where(eq(schema.scheduledJobs.id, existingJob.id));
              }
              return { success: true, message: "Daily Jira report turned off. Say 'turn on my Jira report' to re-enable anytime." };
            }

            // Update or create the job
            const customTime = params.time as string | undefined;
            const tz = tenant.timezone || "UTC";

            if (existingJob) {
              const updates: Record<string, unknown> = { status: "active" };
              if (customTime) {
                updates.recurrenceRule = customTime;
                updates.scheduledAt = nextUtcForLocalTime(customTime, tz);
              }
              await this.deps.db.update(schema.scheduledJobs)
                .set(updates)
                .where(eq(schema.scheduledJobs.id, existingJob.id));
            } else {
              const time = customTime || "09:00";
              await this.deps.db.insert(schema.scheduledJobs).values({
                tenantId,
                jobType: "daily_jira_report",
                scheduleType: "daily",
                scheduledAt: nextUtcForLocalTime(time, tz),
                recurrenceRule: time,
                payload: {},
                status: "active",
              });
            }

            const effectiveTime = customTime || existingJob?.recurrenceRule || "09:00";
            return {
              success: true,
              message: `Daily Jira report ${mode === "on" ? "enabled" : "updated"} -- you'll get it at ${effectiveTime} every morning. Say 'change my Jira report time' to adjust.`,
            };
          }
```

Note: `nextUtcForLocalTime` is already imported in `message-handler.ts` — verify this, and add the import if missing:

```typescript
import { nextUtcForLocalTime } from "./job-runner.js";
```

**Step 3: Verify it compiles**

```bash
pnpm --filter @babji/skills build && pnpm --filter @babji/gateway build
```

**Step 4: Commit**

```bash
git add packages/skills/src/registry.ts packages/gateway/src/message-handler.ts
git commit -m "feat: add configure_jira_report action (BAB-38)"
```

---

### Task 6: Add Jira report section to PromptBuilder

**Files:**
- Modify: `packages/agent/src/prompt-builder.ts:131` (after the daily briefing section)

**Step 1: Add the section**

After the `## Daily briefing` section (around line 131, after the blank `parts.push("");`), add:

```typescript
    // Jira report section (only when Jira is connected)
    if (ctx.connections.includes("jira")) {
      parts.push("## Jira daily report");
      parts.push("Babji sends a daily Jira report every morning (default 09:00) with your assigned open issues and recent activity in your projects.");
      parts.push("- Use babji.configure_jira_report to change the time or turn off");
      parts.push("- When the user mentions 'Jira report', 'change Jira report time', or 'turn off Jira updates', use configure_jira_report");
      parts.push("");
    }
```

**Step 2: Verify it compiles**

```bash
pnpm --filter @babji/agent build
```

**Step 3: Commit**

```bash
git add packages/agent/src/prompt-builder.ts
git commit -m "feat: add Jira report section to PromptBuilder (BAB-38)"
```

---

### Task 7: Check `ensureValidToken` returns `cloudId` for Jira

**Files:**
- Inspect: `packages/gateway/src/token-refresh.ts`

**Step 1: Verify that `ensureValidToken` returns `cloudId`**

Read `packages/gateway/src/token-refresh.ts` and check that the return type includes `cloudId`. The `TokenVault.retrieve()` method should return the `cloud_id` that was stored during OAuth callback (see `apps/oauth-portal/src/app/api/callback/[provider]/route.ts:108`).

If `cloudId` is NOT in the return type of `ensureValidToken`, you'll need to:
1. Read the token data from vault: `vault.retrieve(tenantId, "jira")` returns `{ access_token, refresh_token, expires_at, cloud_id }`
2. Ensure the return includes `cloudId: tokenData.cloud_id`

**Step 2: If changes are needed, update and commit**

```bash
pnpm --filter @babji/gateway build
git add packages/gateway/src/token-refresh.ts
git commit -m "fix: include cloudId in ensureValidToken return for Jira (BAB-38)"
```

---

### Task 8: Run tests + build

**Files:**
- No changes

**Step 1: Run tests**

```bash
pnpm --filter @babji/gateway test
```
Expected: all tests pass (no Jira-specific tests needed — the service follows the same pattern as daily-briefing which is tested via e2e).

**Step 2: Full build**

```bash
pnpm --filter @babji/agent build && pnpm --filter @babji/skills build && pnpm --filter @babji/gateway build
```
Expected: all packages build without errors.

---

### Task 9: Seed job for existing Jira-connected tenants

**Files:**
- No code changes — one-time SQL on production

**Step 1: Find tenants with Jira connected but no daily_jira_report job**

```bash
ssh root@65.20.76.199 'docker exec -i babji-postgres psql -U babji -d babji -c "
  SELECT sc.tenant_id, t.name, t.timezone
  FROM service_connections sc
  JOIN tenants t ON t.id = sc.tenant_id
  WHERE sc.provider = '\''jira'\''
  AND sc.tenant_id NOT IN (
    SELECT tenant_id FROM scheduled_jobs WHERE job_type = '\''daily_jira_report'\''
  );
"'
```

**Step 2: Insert jobs for each tenant found** (adjust timezone per tenant)

```bash
ssh root@65.20.76.199 'docker exec -i babji-postgres psql -U babji -d babji -c "
  INSERT INTO scheduled_jobs (id, tenant_id, job_type, schedule_type, scheduled_at, recurrence_rule, payload, status)
  SELECT
    gen_random_uuid(),
    sc.tenant_id,
    '\''daily_jira_report'\'',
    '\''daily'\'',
    NOW() + INTERVAL '\''1 day'\'',
    '\''09:00'\'',
    '\''{}'\''::jsonb,
    '\''active'\''
  FROM service_connections sc
  WHERE sc.provider = '\''jira'\''
  AND sc.tenant_id NOT IN (
    SELECT tenant_id FROM scheduled_jobs WHERE job_type = '\''daily_jira_report'\''
  );
"'
```

---

### Task 10: Deploy and update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Update CHANGELOG**

Add entry to `CHANGELOG.md`:

```markdown
### 2026-03-11 — Daily Jira Report (BAB-38)
- New `DailyJiraReportService` sends daily report of assigned issues + recent project activity
- Auto-seeded at 09:00 when Jira is connected
- Configurable via `configure_jira_report` (time + on/off)
- New `jiraReportPref` column on tenants table
- Files: `daily-jira-report.ts` (new), `job-runner.ts`, `server.ts`, `message-handler.ts`, `registry.ts`, `prompt-builder.ts`, `schema.ts`
- Status: deployed
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add BAB-38 daily Jira report to CHANGELOG"
```

**Step 3: Deploy**

```bash
pnpm --filter @babji/agent build && pnpm --filter @babji/skills build && pnpm --filter @babji/gateway build

rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'

# Verify
ssh root@65.20.76.199 'sleep 2 && curl -s http://localhost:3000/health'
```

**Step 4: Update BAB-38 to Done in Jira**

```bash
ssh root@65.20.76.199 'source /opt/babji/.env && curl -s -X POST "https://${JIRA_HOST}/rest/api/3/issue/BAB-38/transitions" -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" -H "Content-Type: application/json" -d "{\"transition\":{\"id\":\"41\"}}"'
```
