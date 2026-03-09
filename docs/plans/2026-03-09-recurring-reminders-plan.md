# Recurring Reminders (BAB-4) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users create recurring reminders (daily, weekdays, weekly, monthly, yearly) at a specific time, leveraging the existing `scheduledJobs` infrastructure.

**Architecture:** Add `recurrence` and `reminder_time` params to the `babji` skill's `add_task`/`update_task` actions. TodosHandler creates recurring scheduled jobs. JobRunner reschedules instead of completing for recurring jobs. No DB schema changes needed.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, existing `nextUtcForLocalTime()` utility

---

### Task 1: Add recurrence and reminder_time parameters to skill registry

**Files:**
- Modify: `packages/skills/src/registry.ts` (lines 683-712 for add_task, lines 737-771 for update_task)

**Step 1: Add parameters to add_task action**

In `packages/skills/src/registry.ts`, find the `add_task` action inside `checkWithTeacherSkill` and add two new parameters after `notes`:

```typescript
        recurrence: {
          type: "string",
          required: false,
          description: "For recurring reminders: 'daily', 'weekdays' (Mon-Fri), 'weekly', 'monthly', or 'yearly'. When set, reminder_time is used instead of due_date/remind_before.",
        },
        reminder_time: {
          type: "string",
          required: false,
          description: "Time of day for recurring reminders in HH:MM 24-hour format (e.g. '09:20', '14:00'). Defaults to '09:00'. Only used when recurrence is set.",
        },
```

Also update the `add_task` description to mention recurring reminders:

```typescript
      description: "Add a new todo or reminder for the user. Use smart defaults for remind_before: gift/purchase tasks get 5-7 days, preparation tasks 2-3 days, meetings 1 day, general deadlines 1 day. Always confirm the reminder timing with the user after creating. For recurring reminders (e.g. 'remind me every day at 9:20 AM'), use the recurrence and reminder_time parameters instead of due_date/remind_before.",
```

**Step 2: Add parameters to update_task action**

In the same file, find `update_task` action and add after the `notes` parameter:

```typescript
        recurrence: {
          type: "string",
          required: false,
          description: "Change to recurring: 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'. Set to 'none' to stop recurrence.",
        },
        reminder_time: {
          type: "string",
          required: false,
          description: "New time for recurring reminder in HH:MM format (e.g. '09:20'). Only used with recurrence.",
        },
```

**Step 3: Verify**

Run: `pnpm --filter @babji/skills build` (or just check TypeScript compiles — registry.ts is just data)

**Step 4: Commit**

```bash
git add packages/skills/src/registry.ts
git commit -m "feat(BAB-4): add recurrence and reminder_time params to add_task/update_task registry"
```

---

### Task 2: Implement recurring job creation in TodosHandler.addTask()

**Files:**
- Modify: `packages/skills/src/todos/handler.ts` (addTask method, lines 53-122)

**Step 1: Import nextUtcForLocalTime**

At the top of `packages/skills/src/todos/handler.ts`, add:

```typescript
import { nextUtcForLocalTime } from "@babji/gateway/job-runner";
```

Wait — `nextUtcForLocalTime` is in the gateway package. The todos handler is in the skills package. To avoid a circular dependency, we need to **copy the `nextUtcForLocalTime` function into the todos handler** (or create a shared utility). The simplest approach: duplicate the function into `packages/skills/src/todos/handler.ts` since it's small (~25 lines).

Add this function after `localDateToUtcMidnight`:

```typescript
/** Converts a local time string "HH:MM" + IANA timezone to the next UTC timestamp */
function nextUtcForLocalTime(localTime: string, timezone: string): Date {
  const [hours, minutes] = localTime.split(":").map(Number);
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
  const localDay = Number(get("day"));
  const localHour = Number(get("hour"));
  const localMinute = Number(get("minute"));
  const localYear = Number(get("year"));
  const localMonth = Number(get("month"));

  let targetDay = localDay;
  if (localHour > hours || (localHour === hours && localMinute >= minutes)) {
    targetDay += 1;
  }

  const targetLocal = new Date(localYear, localMonth - 1, targetDay, hours, minutes, 0);
  const utcStr = targetLocal.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = targetLocal.toLocaleString("en-US", { timeZone: timezone });
  const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();
  return new Date(targetLocal.getTime() + offsetMs);
}
```

**Step 2: Add recurring logic to addTask()**

In the `addTask` method, after the existing `let reminderAt` block (after line 76), add handling for the `recurrence` parameter:

```typescript
    const recurrence = (params.recurrence as string) || null;
    const reminderTime = (params.reminder_time as string) || "09:00";

    // Insert the todo
    const [todo] = await this.db.insert(schema.todos).values({
      tenantId: this.tenantId,
      title,
      notes,
      dueDate,
      reminderAt: recurrence ? null : reminderAt,  // No single reminderAt for recurring
      priority: priority as "low" | "medium" | "high",
      status: "pending",
    }).returning();

    if (recurrence) {
      // Recurring reminder — create a recurring scheduled job
      const scheduleType = recurrence === "weekly" ? "weekly" : "daily";
      const firstRun = nextUtcForLocalTime(reminderTime, this.timezone);

      const [job] = await this.db.insert(schema.scheduledJobs).values({
        tenantId: this.tenantId,
        jobType: "todo_reminder",
        scheduleType,
        scheduledAt: firstRun,
        recurrenceRule: reminderTime,
        payload: { todoId: todo.id, title, recurrence },
        status: "active",
      }).returning();

      await this.db.update(schema.todos)
        .set({ reminderJobId: job.id })
        .where(eq(schema.todos.id, todo.id));

      return {
        success: true,
        task: { id: todo.id, title, dueDate, priority, notes, recurrence, reminderTime },
        hint: `Recurring ${recurrence} reminder set for ${reminderTime}. Confirm with the user: "I'll remind you ${recurrence === "daily" ? "every day" : recurrence === "weekdays" ? "every weekday (Mon-Fri)" : recurrence} at ${reminderTime}. Want to change the time or frequency?"`,
      };
    }

    // Existing one-shot reminder logic (unchanged)
    if (reminderAt) {
      // ... existing code for one-shot job creation ...
    }
```

The key change: when `recurrence` is set, we skip the `due_date`/`remind_before` single-shot logic and instead create a recurring job with `scheduleType` set appropriately and `recurrence` stored in the payload.

**Step 3: Verify build**

Run: `pnpm --filter @babji/skills build`

**Step 4: Commit**

```bash
git add packages/skills/src/todos/handler.ts
git commit -m "feat(BAB-4): handle recurring reminders in TodosHandler.addTask()"
```

---

### Task 3: Implement recurring handling in TodosHandler.updateTask()

**Files:**
- Modify: `packages/skills/src/todos/handler.ts` (updateTask method, lines 198-264)

**Step 1: Add recurrence handling to updateTask()**

After the existing `remind_before` handling block (around line 247), add:

```typescript
    // Handle recurrence change
    const newRecurrence = params.recurrence as string | undefined;
    const newReminderTime = params.reminder_time as string | undefined;

    if (newRecurrence) {
      // Cancel existing reminder job
      if (task.reminderJobId) {
        await this.db.update(schema.scheduledJobs)
          .set({ status: "completed" })
          .where(eq(schema.scheduledJobs.id, task.reminderJobId));
      }

      if (newRecurrence === "none") {
        // Stop recurrence — just clear the job
        updates.reminderJobId = null;
        updates.reminderAt = null;
      } else {
        // Create new recurring job
        const time = newReminderTime || "09:00";
        const scheduleType = newRecurrence === "weekly" ? "weekly" : "daily";
        const firstRun = nextUtcForLocalTime(time, this.timezone);

        const [job] = await this.db.insert(schema.scheduledJobs).values({
          tenantId: this.tenantId,
          jobType: "todo_reminder",
          scheduleType,
          scheduledAt: firstRun,
          recurrenceRule: time,
          payload: { todoId: taskId, title: (params.title as string) || task.title, recurrence: newRecurrence },
          status: "active",
        }).returning();

        updates.reminderJobId = job.id;
        updates.reminderAt = null; // Clear one-shot reminderAt
      }
    } else if (newReminderTime && task.reminderJobId) {
      // Just changing the time on an existing recurring job
      const existingJob = await this.db.query.scheduledJobs.findFirst({
        where: eq(schema.scheduledJobs.id, task.reminderJobId),
      });
      if (existingJob && existingJob.scheduleType !== "once") {
        const firstRun = nextUtcForLocalTime(newReminderTime, this.timezone);
        await this.db.update(schema.scheduledJobs)
          .set({ recurrenceRule: newReminderTime, scheduledAt: firstRun })
          .where(eq(schema.scheduledJobs.id, task.reminderJobId));
      }
    }
```

**Step 2: Verify build**

Run: `pnpm --filter @babji/skills build`

**Step 3: Commit**

```bash
git add packages/skills/src/todos/handler.ts
git commit -m "feat(BAB-4): handle recurrence changes in TodosHandler.updateTask()"
```

---

### Task 4: Modify JobRunner.runTodoReminder() to reschedule recurring jobs

**Files:**
- Modify: `packages/gateway/src/job-runner.ts` (runTodoReminder method, lines 308-366)

**Step 1: Replace one-shot completion with reschedule logic**

Replace the last section of `runTodoReminder()` (currently lines 362-365, the "Mark job as completed" block) with:

```typescript
    // Handle rescheduling
    const recurrence = (payload as Record<string, unknown>).recurrence as string | undefined;

    if (!recurrence || job.scheduleType === "once") {
      // One-time job — mark as completed
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
    } else {
      // Recurring job — reschedule
      const timezone = tenant.timezone || "UTC";
      await this.rescheduleRecurring(job, recurrence, timezone);
    }
```

**Step 2: Add rescheduleRecurring method**

Add a new private method to the `JobRunner` class:

```typescript
  private async rescheduleRecurring(
    job: typeof schema.scheduledJobs.$inferSelect,
    recurrence: string,
    timezone: string,
  ): Promise<void> {
    const localTime = job.recurrenceRule || "09:00";
    let nextRun: Date;

    switch (recurrence) {
      case "daily":
        nextRun = nextUtcForLocalTime(localTime, timezone);
        break;

      case "weekdays": {
        // Find next weekday
        nextRun = nextUtcForLocalTime(localTime, timezone);
        const dayOfWeek = new Date(nextRun.toLocaleString("en-US", { timeZone: timezone })).getDay();
        // 0=Sun, 6=Sat
        if (dayOfWeek === 6) {
          nextRun = new Date(nextRun.getTime() + 2 * 86_400_000); // Sat → Mon
        } else if (dayOfWeek === 0) {
          nextRun = new Date(nextRun.getTime() + 1 * 86_400_000); // Sun → Mon
        }
        break;
      }

      case "weekly":
        nextRun = new Date(nextUtcForLocalTime(localTime, timezone).getTime() + 6 * 86_400_000);
        // nextUtcForLocalTime already gives us tomorrow, +6 more days = 7 days total
        break;

      case "monthly": {
        // Schedule same day next month at same time
        const nowInTz = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
        const targetMonth = nowInTz.getMonth() + 1;
        const targetYear = targetMonth > 11 ? nowInTz.getFullYear() + 1 : nowInTz.getFullYear();
        const clampedMonth = targetMonth > 11 ? 0 : targetMonth;
        const targetDay = Math.min(nowInTz.getDate(), new Date(targetYear, clampedMonth + 1, 0).getDate());
        const [hours, minutes] = localTime.split(":").map(Number);
        const targetLocal = new Date(targetYear, clampedMonth, targetDay, hours, minutes, 0);
        const utcStr = targetLocal.toLocaleString("en-US", { timeZone: "UTC" });
        const tzStr = targetLocal.toLocaleString("en-US", { timeZone: timezone });
        nextRun = new Date(targetLocal.getTime() + (new Date(utcStr).getTime() - new Date(tzStr).getTime()));
        break;
      }

      case "yearly": {
        const nowInTz2 = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
        const [hours, minutes] = localTime.split(":").map(Number);
        const targetLocal = new Date(nowInTz2.getFullYear() + 1, nowInTz2.getMonth(), nowInTz2.getDate(), hours, minutes, 0);
        const utcStr = targetLocal.toLocaleString("en-US", { timeZone: "UTC" });
        const tzStr = targetLocal.toLocaleString("en-US", { timeZone: timezone });
        nextRun = new Date(targetLocal.getTime() + (new Date(utcStr).getTime() - new Date(tzStr).getTime()));
        break;
      }

      default:
        // Unknown recurrence — treat as daily
        nextRun = nextUtcForLocalTime(localTime, timezone);
        break;
    }

    await this.deps.db.update(schema.scheduledJobs)
      .set({ scheduledAt: nextRun, lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));

    logger.info({ jobId: job.id, recurrence, nextRun: nextRun.toISOString() }, "Rescheduled recurring todo reminder");
  }
```

**Step 3: Verify build**

Run: `pnpm --filter @babji/gateway build`

**Step 4: Commit**

```bash
git add packages/gateway/src/job-runner.ts
git commit -m "feat(BAB-4): reschedule recurring todo reminders instead of completing"
```

---

### Task 5: Show recurrence in list_tasks response

**Files:**
- Modify: `packages/skills/src/todos/handler.ts` (listTasks method, lines 124-173)

**Step 1: Look up linked job for recurrence info**

In the `listTasks` method, after fetching tasks (line 135), look up associated jobs to detect recurrence:

```typescript
    // Look up recurrence info from linked jobs
    const jobIds = tasks.map((t) => t.reminderJobId).filter(Boolean) as string[];
    let jobMap = new Map<string, { scheduleType: string; payload: Record<string, unknown> | null }>();
    if (jobIds.length > 0) {
      const jobs = await this.db.query.scheduledJobs.findMany({
        where: and(
          eq(schema.scheduledJobs.tenantId, this.tenantId),
          // Filter to only active jobs with these IDs
        ),
      });
      // We need to filter by IDs — since Drizzle doesn't support `IN` easily in findMany,
      // use a simpler approach: fetch all active todo_reminder jobs for this tenant
      for (const j of jobs) {
        if (j.jobType === "todo_reminder" && j.status === "active") {
          jobMap.set(j.id, { scheduleType: j.scheduleType, payload: j.payload as Record<string, unknown> | null });
        }
      }
    }
```

Actually, a simpler approach: use `inArray` from drizzle-orm. Add the import at top:

```typescript
import { eq, and, desc, inArray } from "drizzle-orm";
```

Then in `listTasks`, after fetching tasks:

```typescript
    // Look up recurrence info from linked jobs
    const jobIds = tasks.map((t) => t.reminderJobId).filter((id): id is string => id !== null);
    const jobMap = new Map<string, string | null>();
    if (jobIds.length > 0) {
      const jobs = await this.db
        .select({ id: schema.scheduledJobs.id, scheduleType: schema.scheduledJobs.scheduleType, payload: schema.scheduledJobs.payload })
        .from(schema.scheduledJobs)
        .where(inArray(schema.scheduledJobs.id, jobIds));
      for (const j of jobs) {
        const payload = j.payload as { recurrence?: string } | null;
        jobMap.set(j.id, payload?.recurrence || (j.scheduleType !== "once" ? j.scheduleType : null));
      }
    }
```

Then in the `categorized` map, add `recurrence`:

```typescript
      return {
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
        priority: t.priority,
        status: t.status,
        notes: t.notes,
        urgency,
        recurrence: t.reminderJobId ? (jobMap.get(t.reminderJobId) || null) : null,
        completedAt: t.completedAt?.toISOString() || null,
      };
```

**Step 2: Verify build**

Run: `pnpm --filter @babji/skills build`

**Step 3: Commit**

```bash
git add packages/skills/src/todos/handler.ts
git commit -m "feat(BAB-4): show recurrence field in list_tasks response"
```

---

### Task 6: Add recurring reminder guidance to PromptBuilder

**Files:**
- Modify: `packages/agent/src/prompt-builder.ts` (task management rules section, around lines 88-99)

**Step 1: Add recurring reminder guidance**

In the "Task management rules" section of `PromptBuilder.build()`, after the existing rules (line 99), add:

```typescript
    parts.push("- For RECURRING reminders (e.g. 'remind me every day at 9:20 AM to check orders'):");
    parts.push("  - Use recurrence param: 'daily', 'weekdays' (Mon-Fri), 'weekly', 'monthly', 'yearly'");
    parts.push("  - Use reminder_time param: 'HH:MM' in 24-hour format (default '09:00')");
    parts.push("  - Do NOT set due_date or remind_before for recurring reminders");
    parts.push("  - After creating, confirm: 'I will remind you [frequency] at [time]. Want to change the time or frequency?'");
    parts.push("  - Use recurrence for open-ended repeating tasks (no end date). Use due_date + remind_before for one-time deadlines.");
```

**Step 2: Verify build**

Run: `pnpm --filter @babji/agent build`

**Step 3: Commit**

```bash
git add packages/agent/src/prompt-builder.ts
git commit -m "feat(BAB-4): add recurring reminder guidance to PromptBuilder"
```

---

### Task 7: Build, deploy, and verify

**Files:**
- Build: `packages/skills`, `packages/agent`, `packages/gateway`
- Update: `CHANGELOG.md`

**Step 1: Build all packages**

```bash
pnpm --filter @babji/db build
pnpm --filter @babji/skills build
pnpm --filter @babji/agent build
pnpm --filter @babji/gateway build
```

**Step 2: Run tests**

```bash
pnpm --filter @babji/gateway test
```

Expected: All 31 tests pass.

**Step 3: Update CHANGELOG.md**

Add a new entry under `## 2026-03-09`:

```markdown
### Recurring reminders (BAB-4) [DEPLOYED]
- **What:** Added recurring reminders. Users can say "remind me every day at 9:20 AM to check orders" and the system creates a repeating scheduled job. Supports daily, weekdays (Mon-Fri), weekly, monthly, and yearly recurrence. JobRunner reschedules instead of completing for recurring jobs. list_tasks shows recurrence info. PromptBuilder guides Brain on when to use recurring vs single reminders. No schema changes — uses existing scheduledJobs infrastructure.
- **Files:** `packages/skills/src/registry.ts`, `packages/skills/src/todos/handler.ts`, `packages/gateway/src/job-runner.ts`, `packages/agent/src/prompt-builder.ts`
- **Jira:** BAB-4 (Done)
```

**Step 4: Commit changelog**

```bash
git add CHANGELOG.md
git commit -m "docs: add BAB-4 recurring reminders to CHANGELOG"
```

**Step 5: Deploy to production**

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

ssh root@65.20.76.199 'cd /opt/babji && pnpm install --frozen-lockfile'
ssh root@65.20.76.199 'kill $(pgrep -f "packages/gateway") 2>/dev/null; sleep 2; nohup /opt/babji/start-gateway.sh > /var/log/babji-gateway.log 2>&1 &'
ssh root@65.20.76.199 'sleep 3 && tail -10 /var/log/babji-gateway.log'
```

**Step 6: Verify deployment**

Check logs show "JobRunner started" and no errors.

**Step 7: Test via Telegram**

Send to Babji: "Remind me every day at 9:20 AM to check orders"
Expected: Babji creates a recurring daily reminder and confirms timing.
