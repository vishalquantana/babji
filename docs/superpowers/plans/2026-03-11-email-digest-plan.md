# Email Digest Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add proactive email digest to Babji -- a background job that triages unread Gmail, drafts replies, and sends a numbered digest via Telegram/WhatsApp 2x daily.

**Architecture:** New `EmailDigestRunner` class fetches unread emails, calls `gemini-3.1-flash-lite-preview` for triage/classification, formats a digest message, writes pending drafts to a tenant JSON file, and sends via channel adapter. Integrates with existing `JobRunner`, `PromptBuilder`, and babji skill actions.

**Tech Stack:** TypeScript, Gmail API (googleapis), Vercel AI SDK (`generateText`), Drizzle ORM, node:fs

**Spec:** `docs/superpowers/specs/2026-03-11-email-digest-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/gateway/src/email-digest.ts` | Create | EmailDigestRunner class -- fetch, triage, format, write drafts |
| `packages/gateway/src/job-runner.ts` | Modify | Add `email_digest` case + `runEmailDigest` + `rescheduleEmailDigest` |
| `packages/gateway/src/server.ts` | Modify | Seed `email_digest` job on Gmail post-connect |
| `packages/skills/src/registry.ts` | Modify | Add `configure_email_digest` action to babji skill |
| `packages/gateway/src/message-handler.ts` | Modify | Handle `configure_email_digest` action + inject pending drafts into PromptBuilder |
| `packages/agent/src/prompt-builder.ts` | Modify | Add `pendingDrafts` to PromptContext + email digest sections |

---

## Chunk 1: EmailDigestRunner Core

### Task 1: Create EmailDigestRunner class skeleton

**Files:**
- Create: `packages/gateway/src/email-digest.ts`

- [ ] **Step 1: Create the file with interfaces, deps, and class skeleton**

```typescript
// packages/gateway/src/email-digest.ts
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { google } from "googleapis";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { logger } from "./logger.js";

// ── Interfaces ──

export interface EmailDigestDeps {
  googleApiKey: string;
  memoryBaseDir: string;
}

export interface TriagedEmail {
  emailId: string;
  priority: "urgent" | "reply_needed" | "action" | "fyi" | "skip";
  reason: string;
  suggestedAction: "reply" | "forward" | "archive" | "none";
  draftReply?: string;
  needsFullRead: boolean;
  // Original email metadata (carried through from fetch)
  from: string;
  subject: string;
  snippet: string;
  date: string;
}

export interface PendingDraft {
  index: number;
  emailId: string;
  from: string;
  to: string;
  subject: string;
  draftReply: string;
  threadId?: string;
}

export interface PendingDraftsFile {
  digestTimestamp: string;
  items: PendingDraft[];
  expiresAt: string;
}

// ── Constants ──

const MAX_EMAILS_PER_BATCH = 20;
const MAX_FULL_READS = 3;
const DRAFT_EXPIRY_HOURS = 12;
const TRIAGE_MODEL = "gemini-3.1-flash-lite-preview";

// ── Service ──

export class EmailDigestRunner {
  constructor(private deps: EmailDigestDeps) {}

  /**
   * Run a full email digest cycle for a tenant.
   * Returns the formatted digest message, or null if no emails need attention.
   */
  async run(
    accessToken: string,
    tenantId: string,
    userName: string,
    memoryContent: string,
    lastCheckedAt: string | null,
  ): Promise<{ message: string; draftsCount: number } | null> {
    // 1. Fetch unread emails
    const emails = await this.fetchUnreadEmails(accessToken, lastCheckedAt);
    if (emails.length === 0) return null;

    // 2. Triage with LLM
    const triaged = await this.triageEmails(emails, userName, memoryContent);

    // 3. For needsFullRead items, fetch full body (max 3)
    const needsFullRead = triaged.filter((t) => t.needsFullRead && t.priority !== "skip");
    const fullReads = needsFullRead.slice(0, MAX_FULL_READS);
    if (fullReads.length > 0) {
      await this.enrichWithFullBody(accessToken, fullReads, triaged, userName, memoryContent);
    }

    // 4. Filter out "skip" items
    const actionable = triaged.filter((t) => t.priority !== "skip");
    if (actionable.length === 0) return null;

    // 5. Format digest message
    const message = this.formatDigest(actionable);

    // 6. Write pending drafts file
    const drafts = actionable.filter((t) => t.draftReply);
    if (drafts.length > 0) {
      await this.writePendingDrafts(tenantId, actionable);
    }

    return { message, draftsCount: drafts.length };
  }

  // ── Private methods (stubs for now, implemented in next steps) ──

  private async fetchUnreadEmails(
    accessToken: string,
    lastCheckedAt: string | null,
  ): Promise<Array<{ id: string; from: string; subject: string; snippet: string; date: string }>> {
    throw new Error("Not implemented");
  }

  private async triageEmails(
    emails: Array<{ id: string; from: string; subject: string; snippet: string; date: string }>,
    userName: string,
    memoryContent: string,
  ): Promise<TriagedEmail[]> {
    throw new Error("Not implemented");
  }

  private async enrichWithFullBody(
    accessToken: string,
    fullReads: TriagedEmail[],
    allTriaged: TriagedEmail[],
    userName: string,
    memoryContent: string,
  ): Promise<void> {
    throw new Error("Not implemented");
  }

  private formatDigest(actionable: TriagedEmail[]): string {
    throw new Error("Not implemented");
  }

  async writePendingDrafts(tenantId: string, actionable: TriagedEmail[]): Promise<void> {
    throw new Error("Not implemented");
  }

  /**
   * Read pending drafts for a tenant. Returns null if file doesn't exist or is expired.
   */
  static async readPendingDrafts(memoryBaseDir: string, tenantId: string): Promise<PendingDraftsFile | null> {
    const filePath = join(memoryBaseDir, tenantId, "pending-email-drafts.json");
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as PendingDraftsFile;
      if (new Date(data.expiresAt) < new Date()) {
        // Expired -- delete silently
        await unlink(filePath).catch(() => {});
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Delete the pending drafts file (after all items acted on).
   */
  static async deletePendingDrafts(memoryBaseDir: string, tenantId: string): Promise<void> {
    const filePath = join(memoryBaseDir, tenantId, "pending-email-drafts.json");
    await unlink(filePath).catch(() => {});
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/vishalkumar/Downloads/babji && npx tsc --noEmit packages/gateway/src/email-digest.ts 2>&1 | head -20`

Note: May see errors from stubs -- that's expected. The important thing is no syntax errors.

- [ ] **Step 3: Commit skeleton**

```bash
git add packages/gateway/src/email-digest.ts
git commit -m "feat: add EmailDigestRunner skeleton (email-digest.ts)"
```

### Task 2: Implement fetchUnreadEmails

**Files:**
- Modify: `packages/gateway/src/email-digest.ts`

- [ ] **Step 1: Replace the fetchUnreadEmails stub with real implementation**

Replace the `fetchUnreadEmails` stub method with:

```typescript
  private async fetchUnreadEmails(
    accessToken: string,
    lastCheckedAt: string | null,
  ): Promise<Array<{ id: string; from: string; subject: string; snippet: string; date: string }>> {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth });

    // Build query: unread, skip promotions/social, only newer than lastCheckedAt
    let query = "is:unread -category:promotions -category:social";
    if (lastCheckedAt) {
      // Gmail uses epoch seconds for after: filter
      const epochSec = Math.floor(new Date(lastCheckedAt).getTime() / 1000);
      query += ` after:${epochSec}`;
    }

    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: MAX_EMAILS_PER_BATCH,
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) return [];

    // Fetch metadata for each message
    const emails = await Promise.all(
      messages.map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        const headers = detail.data.payload?.headers || [];
        return {
          id: msg.id!,
          from: headers.find((h) => h.name === "From")?.value || "",
          subject: headers.find((h) => h.name === "Subject")?.value || "(No subject)",
          snippet: detail.data.snippet || "",
          date: headers.find((h) => h.name === "Date")?.value || "",
        };
      }),
    );

    return emails;
  }
```

- [ ] **Step 2: Commit**

```bash
git add packages/gateway/src/email-digest.ts
git commit -m "feat: implement fetchUnreadEmails in EmailDigestRunner"
```

### Task 3: Implement triageEmails (LLM call)

**Files:**
- Modify: `packages/gateway/src/email-digest.ts`

- [ ] **Step 1: Replace the triageEmails stub with real LLM triage implementation**

Replace the `triageEmails` stub method with:

```typescript
  private async triageEmails(
    emails: Array<{ id: string; from: string; subject: string; snippet: string; date: string }>,
    userName: string,
    memoryContent: string,
  ): Promise<TriagedEmail[]> {
    const google = createGoogleGenerativeAI({ apiKey: this.deps.googleApiKey });

    const systemPrompt = `You are an executive assistant triaging emails for ${userName}.
Context about this person:
${memoryContent}

Classify each email and suggest actions. Return a JSON array with no additional text.

Priority categories:
- "urgent": time-sensitive, someone waiting, deadline mentioned
- "reply_needed": direct question or request, no hard deadline
- "action": needs user to do something (review, approve, sign)
- "fyi": informational, no response needed but worth knowing
- "skip": newsletters, promotions, automated notifications

Smart triage signals:
- Questions directed at the user
- Action requests ("please review", "can you send", "need your approval")
- Emails from people (not automated notifications)
- Threads the user is already participating in
- Skip: promotions, social notifications, automated alerts, newsletters

For each email return:
{
  "emailId": "the message id",
  "priority": "urgent|reply_needed|action|fyi|skip",
  "reason": "brief explanation",
  "suggestedAction": "reply|forward|archive|none",
  "draftReply": "draft reply text if suggestedAction is reply, or null",
  "needsFullRead": true/false (true if the snippet is not enough to understand the email)
}

Draft replies should be concise and professional, matching ${userName}'s communication style.
Sign replies as ${userName} -- never use placeholders like [Your Name].`;

    const emailList = emails.map((e) => ({
      id: e.id,
      from: e.from,
      subject: e.subject,
      snippet: e.snippet,
      date: e.date,
    }));

    try {
      const result = await generateText({
        model: google(TRIAGE_MODEL),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(emailList) },
        ],
      });

      // Parse JSON response
      const text = result.text.trim();
      // Strip markdown code fences if present
      const jsonStr = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(jsonStr) as Array<{
        emailId: string;
        priority: string;
        reason: string;
        suggestedAction: string;
        draftReply?: string;
        needsFullRead?: boolean;
      }>;

      // Merge LLM output with original email metadata
      return parsed.map((item) => {
        const original = emails.find((e) => e.id === item.emailId);
        return {
          emailId: item.emailId,
          priority: item.priority as TriagedEmail["priority"],
          reason: item.reason,
          suggestedAction: item.suggestedAction as TriagedEmail["suggestedAction"],
          draftReply: item.draftReply || undefined,
          needsFullRead: item.needsFullRead ?? false,
          from: original?.from || "",
          subject: original?.subject || "",
          snippet: original?.snippet || "",
          date: original?.date || "",
        };
      });
    } catch (err) {
      logger.error({ err }, "Email triage LLM call failed");
      // Fallback: mark all as FYI so digest still works
      return emails.map((e) => ({
        emailId: e.id,
        priority: "fyi" as const,
        reason: "Could not classify (LLM error)",
        suggestedAction: "none" as const,
        needsFullRead: false,
        from: e.from,
        subject: e.subject,
        snippet: e.snippet,
        date: e.date,
      }));
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add packages/gateway/src/email-digest.ts
git commit -m "feat: implement LLM triage in EmailDigestRunner"
```

### Task 4: Implement enrichWithFullBody, formatDigest, writePendingDrafts

**Files:**
- Modify: `packages/gateway/src/email-digest.ts`

- [ ] **Step 1: Replace enrichWithFullBody stub**

```typescript
  private async enrichWithFullBody(
    accessToken: string,
    fullReads: TriagedEmail[],
    allTriaged: TriagedEmail[],
    userName: string,
    memoryContent: string,
  ): Promise<void> {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth });

    for (const item of fullReads) {
      try {
        const res = await gmail.users.messages.get({
          userId: "me",
          id: item.emailId,
          format: "full",
        });

        const body = this.extractBody(res.data.payload);
        if (!body) continue;

        // If the triage didn't generate a draft but the full body warrants one,
        // re-triage just this email with full body
        if (!item.draftReply && (item.priority === "urgent" || item.priority === "reply_needed")) {
          const googleAi = createGoogleGenerativeAI({ apiKey: this.deps.googleApiKey });
          const result = await generateText({
            model: googleAi(TRIAGE_MODEL),
            messages: [
              {
                role: "system",
                content: `You are an executive assistant for ${userName}. Based on the full email body below, draft a concise, professional reply. Sign as ${userName}. Context: ${memoryContent}. Return ONLY the reply text, nothing else.`,
              },
              {
                role: "user",
                content: `From: ${item.from}\nSubject: ${item.subject}\n\n${body.slice(0, 3000)}`,
              },
            ],
          });
          // Update the item in the allTriaged array
          const idx = allTriaged.findIndex((t) => t.emailId === item.emailId);
          if (idx !== -1) {
            allTriaged[idx].draftReply = result.text.trim();
          }
        }
      } catch (err) {
        logger.warn({ err, emailId: item.emailId }, "Failed to fetch full email body");
      }
    }
  }

  private extractBody(payload: any): string | null {
    if (!payload) return null;

    // Simple text/plain extraction
    if (payload.mimeType === "text/plain" && payload.body?.data) {
      return Buffer.from(payload.body.data, "base64").toString("utf-8");
    }

    // Multipart: recurse into parts
    if (payload.parts) {
      for (const part of payload.parts) {
        const result = this.extractBody(part);
        if (result) return result;
      }
    }

    return null;
  }
```

- [ ] **Step 2: Replace formatDigest stub**

```typescript
  private formatDigest(actionable: TriagedEmail[]): string {
    const priorityLabel: Record<string, string> = {
      urgent: "URGENT",
      reply_needed: "REPLY NEEDED",
      action: "ACTION",
      fyi: "FYI",
    };

    const lines: string[] = [];
    lines.push(`You have ${actionable.length} email${actionable.length > 1 ? "s" : ""} that need${actionable.length === 1 ? "s" : ""} attention:\n`);

    actionable.forEach((item, i) => {
      const idx = i + 1;
      const label = priorityLabel[item.priority] || item.priority.toUpperCase();
      const timeAgo = this.formatTimeAgo(item.date);
      const fromShort = item.from.replace(/<.*>/, "").trim() || item.from;

      lines.push(`${idx}. [${label}] From: ${fromShort}${timeAgo ? ` - ${timeAgo}` : ""}`);
      lines.push(`   "${item.subject}"`);

      if (item.draftReply) {
        // Indent draft reply
        const draftLines = item.draftReply.split("\n").map((l, li) =>
          li === 0 ? `   -> Draft reply: "${l}` : `      ${l}`
        );
        const lastIdx = draftLines.length - 1;
        draftLines[lastIdx] = draftLines[lastIdx] + '"';
        lines.push(draftLines.join("\n"));
      } else if (item.priority !== "fyi") {
        lines.push(`   -> No draft (needs your review first)`);
      }

      lines.push(""); // blank line between items
    });

    lines.push(`Reply with: "send 1" / "edit 2 to say ..." / "skip all"`);

    return lines.join("\n");
  }

  private formatTimeAgo(dateStr: string): string {
    if (!dateStr) return "";
    try {
      const date = new Date(dateStr);
      const diffMs = Date.now() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDays = Math.floor(diffHr / 24);
      return `${diffDays}d ago`;
    } catch {
      return "";
    }
  }
```

- [ ] **Step 3: Replace writePendingDrafts stub**

```typescript
  async writePendingDrafts(tenantId: string, actionable: TriagedEmail[]): Promise<void> {
    const drafts = actionable
      .filter((t) => t.draftReply)
      .map((t, i) => ({
        index: i + 1,
        emailId: t.emailId,
        from: t.from,
        to: t.from.match(/<(.+?)>/)?.[1] || t.from, // Extract email from "Name <email>" format
        subject: `Re: ${t.subject.replace(/^Re:\s*/i, "")}`,
        draftReply: t.draftReply!,
      }));

    if (drafts.length === 0) return;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + DRAFT_EXPIRY_HOURS * 60 * 60 * 1000);

    const data: PendingDraftsFile = {
      digestTimestamp: now.toISOString(),
      items: drafts,
      expiresAt: expiresAt.toISOString(),
    };

    const filePath = join(this.deps.memoryBaseDir, tenantId, "pending-email-drafts.json");
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    logger.info({ tenantId, draftCount: drafts.length }, "Wrote pending email drafts");
  }
```

- [ ] **Step 4: Verify the file compiles**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway build 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/email-digest.ts
git commit -m "feat: implement digest formatting, full body enrichment, and draft persistence"
```

---

## Chunk 2: Job Runner Integration

### Task 5: Add email_digest case to JobRunner

**Files:**
- Modify: `packages/gateway/src/job-runner.ts:170-197` (executeJob switch)
- Modify: `packages/gateway/src/job-runner.ts` (add new method after existing job methods)

- [ ] **Step 1: Add import for EmailDigestRunner at top of job-runner.ts**

After line 15 (`import { MeetingBriefingService } from "./meeting-briefing.js";`), add:

```typescript
import { EmailDigestRunner } from "./email-digest.js";
```

- [ ] **Step 2: Add email_digest case to executeJob switch**

In the `executeJob` method (line 170), add a new case before the `default`:

```typescript
      case "email_digest":
        await this.runEmailDigest(job);
        break;
```

Insert this after the `case "daily_usage_report"` block (after line 192).

- [ ] **Step 3: Add runEmailDigest method**

Add this method after the `runDailyUsageReport` method (find the appropriate spot, likely around line 900+):

```typescript
  private async runEmailDigest(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const tenantId = job.tenantId;

    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) {
      logger.warn({ tenantId }, "Tenant not found for email digest job");
      return;
    }

    const timezone = tenant.timezone || "UTC";

    // Get Gmail token
    const tokenResult = await ensureValidToken(tenantId, "gmail", this.deps.vault, this.deps.db);
    if (!tokenResult || tokenResult.status === "expired") {
      logger.warn({ tenantId, status: tokenResult?.status }, "Gmail token expired for email digest, skipping");
      await this.rescheduleEmailDigest(job, timezone);
      return;
    }

    // Determine recipient channel
    const recipient = tenant.telegramUserId || tenant.phone;
    const channel = tenant.telegramUserId ? "telegram" : "whatsapp";
    if (!recipient) {
      logger.warn({ tenantId }, "No recipient channel for email digest");
      await this.rescheduleEmailDigest(job, timezone);
      return;
    }

    const adapter = this.deps.adapters.find((a) => a.name === channel);
    if (!adapter) {
      logger.warn({ tenantId, channel }, "No adapter found for email digest");
      await this.rescheduleEmailDigest(job, timezone);
      return;
    }

    try {
      const memoryContent = await this.deps.memory.readMemory(tenantId);
      const payload = (job.payload || {}) as Record<string, unknown>;
      const lastCheckedAt = (payload.lastCheckedAt as string) || null;

      const memoryBaseDir = process.env.MEMORY_BASE_DIR || "./data/tenants";

      const runner = new EmailDigestRunner({
        googleApiKey: this.deps.googleApiKey,
        memoryBaseDir,
      });

      const result = await runner.run(
        tokenResult.accessToken,
        tenantId,
        tenant.name,
        memoryContent,
        lastCheckedAt,
      );

      if (result) {
        await adapter.sendMessage({
          tenantId,
          channel: channel as "telegram" | "whatsapp" | "app",
          recipient,
          text: result.message,
        });

        logger.info({ tenantId, draftsCount: result.draftsCount }, "Sent email digest");
      } else {
        logger.info({ tenantId }, "Email digest: no actionable emails, silent skip");
      }

      // Update payload with lastCheckedAt and stats
      const prevStats = payload as Record<string, number>;
      const updatedPayload = {
        lastCheckedAt: new Date().toISOString(),
        emailsTriaged: (prevStats.emailsTriaged || 0) + (result ? 1 : 0),
      };

      await this.deps.db.update(schema.scheduledJobs)
        .set({ payload: updatedPayload })
        .where(eq(schema.scheduledJobs.id, job.id));

      // Log background job usage
      if (this.deps.usageTracker) {
        this.deps.usageTracker.logBackgroundJob({ tenantId, jobType: "email_digest" }).catch(() => {});
      }
    } catch (err) {
      logger.error({ err, tenantId }, "Email digest failed");
    }

    await this.rescheduleEmailDigest(job, timezone);
  }
```

- [ ] **Step 4: Add rescheduleEmailDigest method**

Add this method near `rescheduleDaily` (around line 1057):

```typescript
  private async rescheduleEmailDigest(job: typeof schema.scheduledJobs.$inferSelect, timezone: string): Promise<void> {
    const rule = job.recurrenceRule || "08:00,17:00";
    const times = rule.split(",").map((t) => t.trim());

    // Find the next time slot that hasn't passed yet today
    const now = new Date();
    let nextRun: Date | null = null;

    for (const time of times) {
      const candidate = nextUtcForLocalTime(time, timezone);
      // nextUtcForLocalTime returns tomorrow if the time already passed today,
      // so pick the earliest candidate
      if (!nextRun || candidate < nextRun) {
        nextRun = candidate;
      }
    }

    if (!nextRun) {
      nextRun = nextUtcForLocalTime(times[0], timezone);
    }

    await this.deps.db.update(schema.scheduledJobs)
      .set({ scheduledAt: nextRun, lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));

    logger.info({ jobId: job.id, nextRun: nextRun.toISOString() }, "Rescheduled email digest job");
  }
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway build 2>&1 | tail -20`

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/job-runner.ts
git commit -m "feat: add email_digest job type to JobRunner"
```

---

## Chunk 3: Post-Connect Seeding & Skill Action

### Task 6: Seed email_digest job on Gmail connect

**Files:**
- Modify: `packages/gateway/src/server.ts:87-157` (post-connect endpoint)

- [ ] **Step 1: Add email_digest job seeding after the google_calendar block**

After the closing `}` of the `if (provider === "google_calendar" && db)` block (around line 157), add:

```typescript
    // Auto-seed email_digest job when Gmail is connected
    if (provider === "gmail" && db) {
      try {
        const existing = await db.query.scheduledJobs.findFirst({
          where: and(
            eq(schema.scheduledJobs.tenantId, tenantId),
            eq(schema.scheduledJobs.jobType, "email_digest"),
          ),
        });

        if (!existing) {
          const tenant = await db.query.tenants.findFirst({
            where: eq(schema.tenants.id, tenantId),
          });
          const timezone = tenant?.timezone || "UTC";
          const scheduledAt = nextUtcForLocalTime("08:00", timezone);

          await db.insert(schema.scheduledJobs).values({
            tenantId,
            jobType: "email_digest",
            scheduleType: "daily",
            scheduledAt,
            recurrenceRule: "08:00,17:00",
            payload: { lastCheckedAt: null },
            status: "active",
          });

          logger.info({ tenantId, scheduledAt: scheduledAt.toISOString() }, "Seeded email digest job on Gmail connect");
        }
      } catch (err) {
        logger.error({ err, tenantId }, "Failed to seed email digest job");
      }
    }
```

Note: `nextUtcForLocalTime` is already imported from `./job-runner.js` at line 9 of server.ts.

- [ ] **Step 2: Verify build**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway build 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/server.ts
git commit -m "feat: seed email_digest job on Gmail OAuth connect"
```

### Task 7: Add configure_email_digest to babji skill definition

**Files:**
- Modify: `packages/skills/src/registry.ts:691-872` (babji skill actions array)

- [ ] **Step 1: Add new action to the babji skill actions array**

After the `research_meeting_attendees` action (ends around line 869), add before the closing `]` of the actions array:

```typescript
    {
      name: "configure_email_digest",
      description: "Configure the automatic email digest frequency. Babji checks your email and sends digests of what needs attention. Default is morning + evening.",
      parameters: {
        frequency: {
          type: "string",
          required: true,
          description: "How often to send digests: 'morning_only' (once at 8 AM), 'morning_evening' (8 AM + 5 PM, default), 'three_times' (8 AM + 12 PM + 5 PM), or 'off' (disable)",
        },
        times: {
          type: "string",
          required: false,
          description: "Custom times as comma-separated HH:MM values, e.g. '07:00,12:00,18:00'. Overrides frequency presets.",
        },
      },
    },
```

- [ ] **Step 2: Commit**

```bash
git add packages/skills/src/registry.ts
git commit -m "feat: add configure_email_digest to babji skill actions"
```

### Task 8: Handle configure_email_digest in message-handler

**Files:**
- Modify: `packages/gateway/src/message-handler.ts:430-433` (babji skill executor)

- [ ] **Step 1: Add configure_email_digest handler**

Before the `throw new Error(\`Unknown babji action: ${actionName}\`)` line (line 433), add:

```typescript
          if (actionName === "configure_email_digest") {
            const frequency = params.frequency as string;
            const validFreqs = ["morning_only", "morning_evening", "three_times", "off"];
            if (!validFreqs.includes(frequency)) {
              return { success: false, error: `frequency must be one of: ${validFreqs.join(", ")}` };
            }

            const freqToRule: Record<string, string> = {
              morning_only: "08:00",
              morning_evening: "08:00,17:00",
              three_times: "08:00,12:00,17:00",
            };

            // Allow custom times override
            const customTimes = params.times as string | undefined;
            const recurrenceRule = customTimes || freqToRule[frequency];

            if (frequency === "off") {
              // Deactivate the email_digest job
              const existingJob = await this.deps.db.query.scheduledJobs.findFirst({
                where: and(
                  eq(schema.scheduledJobs.tenantId, tenantId),
                  eq(schema.scheduledJobs.jobType, "email_digest"),
                ),
              });
              if (existingJob) {
                await this.deps.db.update(schema.scheduledJobs)
                  .set({ status: "paused" })
                  .where(eq(schema.scheduledJobs.id, existingJob.id));
              }
              return { success: true, message: "Email digests turned off. You can re-enable them anytime." };
            }

            // Update or create the email_digest job
            const existingJob = await this.deps.db.query.scheduledJobs.findFirst({
              where: and(
                eq(schema.scheduledJobs.tenantId, tenantId),
                eq(schema.scheduledJobs.jobType, "email_digest"),
              ),
            });

            if (existingJob) {
              await this.deps.db.update(schema.scheduledJobs)
                .set({ recurrenceRule, status: "active" })
                .where(eq(schema.scheduledJobs.id, existingJob.id));
            } else {
              const { nextUtcForLocalTime } = await import("./job-runner.js");
              const tz = tenant.timezone || "UTC";
              const firstTime = recurrenceRule!.split(",")[0].trim();
              await this.deps.db.insert(schema.scheduledJobs).values({
                tenantId,
                jobType: "email_digest",
                scheduleType: "daily",
                scheduledAt: nextUtcForLocalTime(firstTime, tz),
                recurrenceRule: recurrenceRule!,
                payload: { lastCheckedAt: null },
                status: "active",
              });
            }

            const freqDesc: Record<string, string> = {
              morning_only: "once each morning at 8 AM",
              morning_evening: "morning (8 AM) and evening (5 PM)",
              three_times: "three times daily (8 AM, 12 PM, 5 PM)",
            };
            return {
              success: true,
              message: `Email digests set to ${customTimes ? `custom times: ${customTimes}` : freqDesc[frequency]}. I will triage your inbox and send a summary with draft replies.`,
            };
          }
```

- [ ] **Step 2: Add the needed import at top of message-handler.ts**

At the top of the file (around line 13), add:

```typescript
import { schema } from "@babji/db";
```

Note: Check if `schema` is already imported. If the file already imports from `@babji/db`, this may already exist. Also check that `and`, `eq` are imported from `drizzle-orm` (line 2 already has `eq, and, isNull`).

Also verify `schema.scheduledJobs` is accessible. The drizzle schema should already have `scheduledJobs` -- confirm by checking the db package's schema exports.

- [ ] **Step 3: Verify build**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway build 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/message-handler.ts
git commit -m "feat: handle configure_email_digest babji action"
```

---

## Chunk 4: PromptBuilder Integration

### Task 9: Add pending drafts to PromptBuilder

**Files:**
- Modify: `packages/agent/src/prompt-builder.ts:2-11` (PromptContext interface)
- Modify: `packages/agent/src/prompt-builder.ts:107-140` (build method body)

- [ ] **Step 1: Add pendingDrafts to PromptContext interface**

In `packages/agent/src/prompt-builder.ts`, add to the `PromptContext` interface (after line 10, `completedSkillRequests`):

```typescript
  pendingDrafts?: {
    items: Array<{
      index: number;
      to: string;
      subject: string;
      draftReply: string;
    }>;
  };
  gmailConnected?: boolean;
```

- [ ] **Step 2: Add email digest sections to the build method**

In the `build` method, after the meeting briefing rules section (around line 115, after the empty `parts.push("")`), add:

```typescript
    // Email digest section (only when Gmail is connected)
    if (ctx.gmailConnected) {
      parts.push("## Email digest");
      parts.push("Babji checks your email automatically and sends digests of what needs attention.");
      parts.push("- Use babji.configure_email_digest to change frequency or turn off");
      parts.push("- When the user mentions email digests, scheduling, or 'check my emails', use this action");
      parts.push("");
    }

    // Pending email drafts context (only when drafts file exists and not expired)
    if (ctx.pendingDrafts && ctx.pendingDrafts.items.length > 0) {
      parts.push("## Pending email drafts");
      parts.push("You sent an email digest earlier. The user may respond with actions:");
      parts.push('- "send 1" or "send all" -> call gmail.send_email with the draft');
      parts.push('- "edit 2 to be shorter" -> modify the draft, show it, wait for approval');
      parts.push('- "skip 3" or "skip all" -> discard those drafts');
      parts.push('- "reply to Alice saying..." -> override the draft entirely');
      parts.push("");
      parts.push("Pending drafts:");
      for (const item of ctx.pendingDrafts.items) {
        parts.push(`${item.index}. To: ${item.to} | Subject: ${item.subject} | Draft: "${item.draftReply}"`);
      }
      parts.push("");
    }
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/agent build 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/prompt-builder.ts
git commit -m "feat: add email digest and pending drafts to PromptBuilder"
```

### Task 10: Inject pending drafts into PromptBuilder call in message-handler

**Files:**
- Modify: `packages/gateway/src/message-handler.ts:527-536` (PromptBuilder.build call)

- [ ] **Step 1: Read pending drafts before building prompt**

Before the `PromptBuilder.build()` call (around line 527), add:

```typescript
      // Read pending email drafts for prompt injection
      const memoryBaseDir = process.env.MEMORY_BASE_DIR || "./data/tenants";
      const { EmailDigestRunner } = await import("./email-digest.js");
      const pendingDraftsFile = await EmailDigestRunner.readPendingDrafts(memoryBaseDir, tenantId);
      const pendingDrafts = pendingDraftsFile ? {
        items: pendingDraftsFile.items.map((d) => ({
          index: d.index,
          to: d.to,
          subject: d.subject,
          draftReply: d.draftReply,
        })),
      } : undefined;
      const gmailConnected = connectedProviders.includes("gmail");
```

- [ ] **Step 2: Pass pendingDrafts and gmailConnected to PromptBuilder.build()**

Update the `PromptBuilder.build()` call to include the new fields:

```typescript
      const systemPrompt = PromptBuilder.build({
        soul,
        memory: memoryContent,
        skills: this.deps.availableSkills,
        connections: connectedProviders,
        userName: tenant.name,
        timezone: tenant.timezone ?? "UTC",
        completedSkillRequests,
        pendingDrafts,
        gmailConnected,
      });
```

- [ ] **Step 3: Verify full build**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/agent build && pnpm --filter @babji/gateway build 2>&1 | tail -20`

- [ ] **Step 4: Run tests**

Run: `cd /Users/vishalkumar/Downloads/babji && pnpm --filter @babji/gateway test 2>&1 | tail -30`

All existing tests should pass (no breaking changes to existing interfaces since new fields are optional).

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/message-handler.ts
git commit -m "feat: inject pending email drafts into PromptBuilder context"
```

---

## Chunk 5: Build, Deploy, Test

### Task 11: Full build and local verification

**Files:** All modified files

- [ ] **Step 1: Build all affected packages**

```bash
cd /Users/vishalkumar/Downloads/babji
pnpm --filter @babji/agent build
pnpm --filter @babji/gateway build
```

- [ ] **Step 2: Run gateway tests**

```bash
pnpm --filter @babji/gateway test
```

All tests should pass.

- [ ] **Step 3: Quick smoke test -- verify imports resolve**

```bash
cd /Users/vishalkumar/Downloads/babji
node -e "
  import('./packages/gateway/dist/email-digest.js')
    .then(m => console.log('EmailDigestRunner:', typeof m.EmailDigestRunner))
    .catch(e => console.error('IMPORT FAILED:', e.message))
"
```

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git status
# Only commit if there are unstaged changes
git commit -m "chore: final build for email digest feature"
```

### Task 12: Deploy to production

- [ ] **Step 1: Rsync code to server**

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/
```

- [ ] **Step 2: Install deps on server**

```bash
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'
```

- [ ] **Step 3: Restart gateway**

```bash
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'
```

- [ ] **Step 4: Verify health**

```bash
ssh root@65.20.76.199 'sleep 2 && curl -s http://localhost:3000/health'
```

- [ ] **Step 5: Verify email_digest appears in loaded skills**

```bash
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 logs babji-gateway --lines 20 --nostream' | grep -i "email\|digest\|skill"
```

- [ ] **Step 6: Test end-to-end**

Via Telegram, send a message to Babji asking to check emails. Then verify:
1. If Gmail is already connected, the email_digest job should have been seeded (check DB)
2. If not connected, connect Gmail -- the post-connect flow should seed the job
3. The next time the job fires, a digest should arrive

To manually trigger the digest for testing, insert a job that's already due:

```sql
-- Run on production DB (ssh + docker exec)
INSERT INTO scheduled_jobs (tenant_id, job_type, schedule_type, scheduled_at, recurrence_rule, payload, status)
SELECT id, 'email_digest', 'daily', NOW(), '08:00,17:00', '{"lastCheckedAt": null}', 'active'
FROM tenants
WHERE telegram_user_id IS NOT NULL
LIMIT 1;
```

Then wait 30 seconds for the JobRunner tick to pick it up.

- [ ] **Step 7: Update CHANGELOG.md**

Add entry for the email digest feature with date and files changed.

- [ ] **Step 8: Commit changelog**

```bash
git add CHANGELOG.md
git commit -m "docs: add email digest feature to CHANGELOG"
```
