# Connect Reminder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a weekly evening reminder (6 PM local) nudging users to connect Gmail and/or Calendar, capping at 4 reminders, auto-stopping when they connect.

**Architecture:** New `connect_reminder` job type in the existing `JobRunner` scheduled jobs system. A `connectReminderStatus` column on `tenants` tracks state. The job checks connections, sends value-focused messages, and reschedules weekly. The OAuth callback auto-completes the job when both services are connected.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Fastify, existing JobRunner/adapter infrastructure.

---

### Task 1: Add `connectReminderStatus` column to tenants schema

**Files:**
- Modify: `packages/db/src/schema.ts:21-47`

**Step 1: Add the column to the tenants table definition**

In `packages/db/src/schema.ts`, add `connectReminderStatus` after line 39 (`jiraReportPref`):

```typescript
    connectReminderStatus: varchar("connect_reminder_status", { length: 20 }).default("active"),
```

**Step 2: Run the DB migration on the production server**

```bash
ssh root@65.20.76.199 'source /opt/babji/.env && PGPASSWORD=babji_prod_2026 psql -U babji -d babji -c "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS connect_reminder_status VARCHAR(20) DEFAULT '\''active'\'';"'
```

**Step 3: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat: add connectReminderStatus column to tenants schema"
```

---

### Task 2: Add `connect_reminder` case to JobRunner.executeJob()

**Files:**
- Modify: `packages/gateway/src/job-runner.ts:174-213`

**Step 1: Add the case to the switch statement**

In `packages/gateway/src/job-runner.ts`, add a new case after the `daily_jira_report` case (line 208):

```typescript
      case "connect_reminder":
        await this.runConnectReminder(job);
        break;
```

**Step 2: Commit**

```bash
git add packages/gateway/src/job-runner.ts
git commit -m "feat: add connect_reminder case to JobRunner switch"
```

---

### Task 3: Implement `runConnectReminder()` method in JobRunner

**Files:**
- Modify: `packages/gateway/src/job-runner.ts` (add method before `rescheduleWeekly`, around line 1463)

**Step 1: Add the `runConnectReminder` method**

Insert this method before the `private async rescheduleWeekly` method (line 1464):

```typescript
  private async runConnectReminder(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const tenantId = job.tenantId;
    const payload = (job.payload || {}) as { reminderCount?: number; maxReminders?: number };
    const reminderCount = payload.reminderCount ?? 0;
    const maxReminders = payload.maxReminders ?? 4;

    const tenant = await this.deps.db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant) {
      logger.warn({ tenantId }, "Tenant not found for connect_reminder job");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    const timezone = tenant.timezone || "UTC";

    // Check if tenant already has both Gmail and Calendar connected
    const connections = await this.deps.db.query.serviceConnections.findMany({
      where: eq(schema.serviceConnections.tenantId, tenantId),
    });
    const hasGmail = connections.some((c) => c.provider === "gmail");
    const hasCalendar = connections.some((c) => c.provider === "google_calendar");

    if (hasGmail && hasCalendar) {
      // Both connected — we're done
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      await this.deps.db.update(schema.tenants)
        .set({ connectReminderStatus: "connected" } as Record<string, unknown>)
        .where(eq(schema.tenants.id, tenantId));
      logger.info({ tenantId }, "Connect reminder: both services connected, marking completed");
      return;
    }

    // Check if we've exhausted all reminders
    if (reminderCount >= maxReminders) {
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      await this.deps.db.update(schema.tenants)
        .set({ connectReminderStatus: "exhausted" } as Record<string, unknown>)
        .where(eq(schema.tenants.id, tenantId));
      logger.info({ tenantId, reminderCount }, "Connect reminder: max reminders reached, marking exhausted");
      return;
    }

    // Determine which services are missing and build the message
    let message: string;
    if (!hasGmail && !hasCalendar) {
      message = `Hey ${tenant.name}! I can do a lot more for you once you connect your Gmail and Calendar -- daily inbox summaries, meeting briefings, smart reminders. Type **connect gmail** or **connect calendar** to get started.`;
    } else if (!hasGmail) {
      message = `Hey ${tenant.name}! Just a thought -- if you connect your Gmail, I can give you a daily inbox summary, help draft replies, and flag important emails. Just type **connect gmail** to get started.`;
    } else {
      message = `Hey ${tenant.name}! Quick idea -- connect your Google Calendar and I'll send you daily agendas, meeting briefings, and remind you before important meetings. Type **connect calendar** to set it up.`;
    }

    // Send the reminder
    const recipient = tenant.telegramUserId || tenant.phone;
    const channel = tenant.telegramUserId ? "telegram" : "whatsapp";
    if (!recipient) {
      logger.warn({ tenantId }, "No recipient channel for connect reminder");
      await this.rescheduleConnectReminder(job, timezone, reminderCount + 1, maxReminders);
      return;
    }

    const adapter = this.deps.adapters.find((a) => a.name === channel);
    if (!adapter) {
      logger.warn({ tenantId, channel }, "No adapter found for connect reminder");
      await this.rescheduleConnectReminder(job, timezone, reminderCount + 1, maxReminders);
      return;
    }

    await adapter.sendMessage({
      tenantId,
      channel: channel as "telegram" | "whatsapp" | "app",
      recipient,
      text: message,
    });

    logger.info({ tenantId, reminderCount: reminderCount + 1, hasGmail, hasCalendar }, "Sent connect reminder");

    // Log background job usage
    if (this.deps.usageTracker) {
      this.deps.usageTracker.logBackgroundJob({ tenantId, jobType: "connect_reminder" }).catch(() => {});
    }

    // Reschedule for +7 days
    await this.rescheduleConnectReminder(job, timezone, reminderCount + 1, maxReminders);
  }

  private async rescheduleConnectReminder(
    job: typeof schema.scheduledJobs.$inferSelect,
    timezone: string,
    newCount: number,
    maxReminders: number,
  ): Promise<void> {
    const localTime = job.recurrenceRule || "18:00";
    // Schedule 7 days from now at the same local time
    const nextRun = new Date(nextUtcForLocalTime(localTime, timezone).getTime() + 6 * 86_400_000);

    await this.deps.db.update(schema.scheduledJobs)
      .set({
        scheduledAt: nextRun,
        lastRunAt: new Date(),
        payload: { reminderCount: newCount, maxReminders },
      })
      .where(eq(schema.scheduledJobs.id, job.id));

    logger.info({ jobId: job.id, nextRun: nextRun.toISOString(), reminderCount: newCount }, "Rescheduled connect reminder");
  }
```

**Step 2: Commit**

```bash
git add packages/gateway/src/job-runner.ts
git commit -m "feat: implement runConnectReminder + rescheduleConnectReminder in JobRunner"
```

---

### Task 4: Seed `connect_reminder` jobs on server startup

**Files:**
- Modify: `packages/gateway/src/index.ts:187-244` (inside the existing tenant seeding block)

**Step 1: Add connect_reminder seeding after memory_scan seeding**

After the memory_scan seeding block (around line 241, before the closing `}` of the try block), add:

```typescript
      // Seed connect_reminder for tenants missing Gmail or Calendar
      const tenantConnections = await db.query.serviceConnections.findMany({
        where: eq(schema.serviceConnections.tenantId, tenant.id),
      });
      const hasGmail = tenantConnections.some((c) => c.provider === "gmail");
      const hasCalendar = tenantConnections.some((c) => c.provider === "google_calendar");
      const reminderStatus = (tenant as Record<string, unknown>).connectReminderStatus as string | null;

      if (!hasGmail || !hasCalendar) {
        if (reminderStatus === "active" || reminderStatus === "snoozed" || reminderStatus === null) {
          const existingReminder = await db.query.scheduledJobs.findFirst({
            where: and(
              eq(schema.scheduledJobs.tenantId, tenant.id),
              eq(schema.scheduledJobs.jobType, "connect_reminder"),
            ),
          });
          if (!existingReminder) {
            const tz = tenant.timezone || "UTC";
            await db.insert(schema.scheduledJobs).values({
              tenantId: tenant.id,
              jobType: "connect_reminder",
              scheduleType: "daily",
              scheduledAt: nextUtcForLocalTime("18:00", tz),
              recurrenceRule: "18:00",
              payload: { reminderCount: 0, maxReminders: 4 },
              status: "active",
            });
            logger.info({ tenantId: tenant.id }, "Seeded connect_reminder job for existing tenant");
          }
        }
      }
```

**Step 2: Commit**

```bash
git add packages/gateway/src/index.ts
git commit -m "feat: seed connect_reminder jobs on server startup for tenants missing Gmail/Calendar"
```

---

### Task 5: Seed `connect_reminder` when a new tenant completes onboarding

**Files:**
- Modify: `packages/gateway/src/message-handler.ts:911-942` (inside the `setImmediate` block that seeds jobs for new tenants)

**Step 1: Add connect_reminder seeding after the memory_scan seeding**

After the memory_scan insert (around line 937, before the logger.info on line 938), add:

```typescript
            // Seed connect_reminder (will fire in 7 days at 6 PM local)
            await this.deps.db.insert(schema.scheduledJobs).values({
              tenantId,
              jobType: "connect_reminder",
              scheduleType: "daily",
              scheduledAt: new Date(nextUtcForLocalTime("18:00", tz).getTime() + 6 * 86_400_000),
              recurrenceRule: "18:00",
              payload: { reminderCount: 0, maxReminders: 4 },
              status: "active",
            });
```

Update the logger.info to include connect_reminder:

```typescript
            logger.info({ tenantId }, "Seeded daily_briefing + memory_scan + connect_reminder for new tenant");
```

**Step 2: Commit**

```bash
git add packages/gateway/src/message-handler.ts
git commit -m "feat: seed connect_reminder job when new tenant completes onboarding"
```

---

### Task 6: Auto-complete `connect_reminder` when Gmail/Calendar are connected via OAuth

**Files:**
- Modify: `packages/gateway/src/server.ts:46-289` (inside the `/api/connect-complete` handler)

**Step 1: Add auto-complete logic after the existing job-seeding blocks**

After the Jira job-seeding block (around line 259, before the `// Fire and forget` comment on line 260), add:

```typescript
    // Auto-complete connect_reminder if both Gmail and Calendar are now connected
    if ((provider === "gmail" || provider === "google_calendar") && db) {
      setImmediate(async () => {
        try {
          const allConnections = await db!.query.serviceConnections.findMany({
            where: eq(schema.serviceConnections.tenantId, tenantId),
          });
          const hasGmail = allConnections.some((c) => c.provider === "gmail");
          const hasCalendar = allConnections.some((c) => c.provider === "google_calendar");

          if (hasGmail && hasCalendar) {
            // Find and complete the connect_reminder job
            const reminderJob = await db!.query.scheduledJobs.findFirst({
              where: and(
                eq(schema.scheduledJobs.tenantId, tenantId),
                eq(schema.scheduledJobs.jobType, "connect_reminder"),
                eq(schema.scheduledJobs.status, "active"),
              ),
            });
            if (reminderJob) {
              await db!.update(schema.scheduledJobs)
                .set({ status: "completed", lastRunAt: new Date() })
                .where(eq(schema.scheduledJobs.id, reminderJob.id));
              logger.info({ tenantId }, "Auto-completed connect_reminder: both Gmail and Calendar connected");
            }

            await db!.update(schema.tenants)
              .set({ connectReminderStatus: "connected" } as Record<string, unknown>)
              .where(eq(schema.tenants.id, tenantId));
          }
        } catch (err) {
          logger.error({ err, tenantId }, "Failed to auto-complete connect_reminder on service connect");
        }
      });
    }
```

**Step 2: Commit**

```bash
git add packages/gateway/src/server.ts
git commit -m "feat: auto-complete connect_reminder when both Gmail and Calendar are connected"
```

---

### Task 7: Detect "stop reminding" intent and snooze the job

**Files:**
- Modify: `packages/gateway/src/message-handler.ts` (add detection early in the `handle()` method, after the "connect" command check around line 295)

**Step 1: Add the stop-reminding detection**

After the connect command handler (after line 295), add:

```typescript
      // ── Handle "stop reminding" intent for connect reminders ──
      const stopReminderRe = /\b(stop\s+remind|don'?t\s+remind|no\s+more\s+remind|stop\s+nag)/i;
      if (stopReminderRe.test(message.text)) {
        const reminderJob = await this.deps.db.query.scheduledJobs.findFirst({
          where: and(
            eq(schema.scheduledJobs.tenantId, tenantId),
            eq(schema.scheduledJobs.jobType, "connect_reminder"),
            eq(schema.scheduledJobs.status, "active"),
          ),
        });
        if (reminderJob) {
          const tz = tenant.timezone || "UTC";
          const nextRun = new Date(nextUtcForLocalTime("18:00", tz).getTime() + 6 * 86_400_000);
          const payload = (reminderJob.payload || {}) as { reminderCount?: number; maxReminders?: number };
          await this.deps.db.update(schema.scheduledJobs)
            .set({
              scheduledAt: nextRun,
              lastRunAt: new Date(),
              payload: { reminderCount: payload.reminderCount ?? 0, maxReminders: payload.maxReminders ?? 4 },
            })
            .where(eq(schema.scheduledJobs.id, reminderJob.id));
          await this.deps.db.update(schema.tenants)
            .set({ connectReminderStatus: "snoozed" } as Record<string, unknown>)
            .where(eq(schema.tenants.id, tenantId));
          logger.info({ tenantId }, "Connect reminder snoozed by user request");
          // Don't return — let the message also flow through Brain for a natural response
        }
      }
```

**Step 2: Commit**

```bash
git add packages/gateway/src/message-handler.ts
git commit -m "feat: detect 'stop reminding' intent and snooze connect_reminder job"
```

---

### Task 8: Build, test, and deploy

**Files:**
- All modified files

**Step 1: Build the agent and gateway packages**

```bash
pnpm --filter @babji/agent build
pnpm --filter @babji/gateway build
```

**Step 2: Run tests**

```bash
pnpm --filter @babji/gateway test
```

Expected: All existing tests should pass (no test changes needed — the new code is additive).

**Step 3: Deploy to production**

```bash
# Sync to server
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

# Install deps
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'

# Run the DB migration (if not done in Task 1)
ssh root@65.20.76.199 'source /opt/babji/.env && PGPASSWORD=babji_prod_2026 psql -U babji -d babji -c "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS connect_reminder_status VARCHAR(20) DEFAULT '\''active'\'';"'

# Restart gateway
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'

# Verify
ssh root@65.20.76.199 'sleep 3 && curl -s http://localhost:3000/health'
```

**Step 4: Verify connect_reminder jobs were seeded**

```bash
ssh root@65.20.76.199 'source /opt/babji/.env && PGPASSWORD=babji_prod_2026 psql -U babji -d babji -c "SELECT j.id, t.name, j.status, j.scheduled_at, j.payload FROM scheduled_jobs j JOIN tenants t ON t.id = j.tenant_id WHERE j.job_type = '\''connect_reminder'\'' ORDER BY j.scheduled_at;"'
```

**Step 5: Commit the final build artifacts**

```bash
git add -A
git commit -m "feat: complete connect reminder feature — weekly nudge to connect Gmail/Calendar

- New connectReminderStatus column on tenants table
- connect_reminder job type in JobRunner (fires weekly at 6 PM local)
- Value-focused messages based on which services are missing
- Caps at 4 reminders, then marks as exhausted
- Auto-completes when both Gmail and Calendar are connected via OAuth
- Snoozes when user says 'stop reminding' / 'don't remind me'
- Seeds on startup for existing tenants, on onboarding for new tenants"
```
