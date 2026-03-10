# Todo & Reminder System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users create, manage, and receive reminders for todos through natural conversation with Babji.

**Architecture:** New `todos` DB table stores tasks with optional due dates and reminder timestamps. A `babji_tasks` skill (no auth required) provides CRUD actions the LLM calls. When a todo has a reminder date, a `scheduledJobs` row is created so the existing job runner fires a message via Telegram/WhatsApp.

**Tech Stack:** PostgreSQL (drizzle-orm), TypeScript, existing job-runner (30s tick), existing skill handler pattern.

---

### Task 1: Add `todos` table to DB schema

**Files:**
- Modify: `packages/db/src/schema.ts:113-140` (after `jobStatusEnum`, before `scheduledJobs`)

**Step 1: Add enums and table definition**

Add these after line 118 (`jobStatusEnum` closing) in `packages/db/src/schema.ts`:

```typescript
export const todoPriorityEnum = pgEnum("todo_priority", ["low", "medium", "high"]);
export const todoStatusEnum = pgEnum("todo_status", ["pending", "done"]);

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    title: text("title").notNull(),
    notes: text("notes"),
    dueDate: varchar("due_date", { length: 10 }), // "2026-04-15" (ISO date string, not timestamp)
    reminderAt: timestamp("reminder_at"),           // UTC timestamp when to send reminder
    reminderJobId: uuid("reminder_job_id"),          // FK to scheduledJobs (nullable)
    priority: todoPriorityEnum("priority").notNull().default("medium"),
    status: todoStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_todos_tenant").on(table.tenantId),
    index("idx_todos_status").on(table.tenantId, table.status),
  ]
);
```

Note: `dueDate` is a varchar "2026-04-15" not a timestamp, because we want the date in the tenant's local timezone without time-of-day ambiguity. `reminderAt` is a UTC timestamp for the job runner.

**Step 2: Build the db package to verify types compile**

Run: `pnpm --filter @babji/db build`
Expected: Clean build, no errors.

**Step 3: Run the SQL migration on production DB**

SSH into the production server and run the SQL to create the enums and table:

```sql
CREATE TYPE todo_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE todo_status AS ENUM ('pending', 'done');

CREATE TABLE todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  notes TEXT,
  due_date VARCHAR(10),
  reminder_at TIMESTAMPTZ,
  reminder_job_id UUID,
  priority todo_priority NOT NULL DEFAULT 'medium',
  status todo_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_todos_tenant ON todos(tenant_id);
CREATE INDEX idx_todos_status ON todos(tenant_id, status);
```

Run: `ssh root@65.20.76.199 "docker exec -i babji-postgres psql -U babji -d babji" < migration.sql`

**Step 4: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat: add todos table to DB schema for todo/reminder system"
```

---

### Task 2: Create TodosHandler skill

**Files:**
- Create: `packages/skills/src/todos/handler.ts`
- Create: `packages/skills/src/todos/index.ts`
- Modify: `packages/skills/src/index.ts:1-14` (add export)

**Step 1: Create the handler**

Create `packages/skills/src/todos/handler.ts`:

```typescript
import { eq, and, lte, desc } from "drizzle-orm";
import type { SkillHandler } from "@babji/agent";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";

/** Parse "5d", "1w", "3h" etc. into milliseconds */
function parseDuration(s: string): number | null {
  const m = s.trim().match(/^(\d+)\s*(h|d|w)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2].toLowerCase()) {
    case "h": return n * 3_600_000;
    case "d": return n * 86_400_000;
    case "w": return n * 7 * 86_400_000;
    default: return null;
  }
}

/** Convert a date string "2026-04-15" in a given timezone to a UTC Date at midnight local */
function localDateToUtcMidnight(dateStr: string, timezone: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  // Create a date at midnight local time
  const local = new Date(y, mo - 1, d, 0, 0, 0);
  // Calculate UTC offset for this timezone
  const utcStr = local.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = local.toLocaleString("en-US", { timeZone: timezone });
  const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();
  return new Date(local.getTime() + offsetMs);
}

export class TodosHandler implements SkillHandler {
  constructor(
    private db: Database,
    private tenantId: string,
    private timezone: string,
  ) {}

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "add_task":
        return this.addTask(params);
      case "list_tasks":
        return this.listTasks(params);
      case "complete_task":
        return this.completeTask(params);
      case "update_task":
        return this.updateTask(params);
      case "delete_task":
        return this.deleteTask(params);
      default:
        throw new Error(`Unknown babji_tasks action: ${actionName}`);
    }
  }

  private async addTask(params: Record<string, unknown>) {
    const title = params.title as string;
    if (!title) throw new Error("Missing required parameter: title for add_task");

    const dueDate = (params.due_date as string) || null;
    const remindBefore = (params.remind_before as string) || null;
    const priority = (params.priority as string) || "medium";
    const notes = (params.notes as string) || null;

    let reminderAt: Date | null = null;
    let reminderJobId: string | null = null;

    // Calculate reminder time
    if (dueDate && remindBefore) {
      const durationMs = parseDuration(remindBefore);
      if (durationMs) {
        const dueDateUtc = localDateToUtcMidnight(dueDate, this.timezone);
        // Remind at 9:00 AM local time on the reminder day
        const nineAmOffset = 9 * 3_600_000;
        reminderAt = new Date(dueDateUtc.getTime() - durationMs + nineAmOffset);
        // Don't set reminder in the past
        if (reminderAt.getTime() <= Date.now()) {
          reminderAt = null;
        }
      }
    }

    // Insert the todo
    const [todo] = await this.db.insert(schema.todos).values({
      tenantId: this.tenantId,
      title,
      notes,
      dueDate,
      reminderAt,
      priority: priority as "low" | "medium" | "high",
      status: "pending",
    }).returning();

    // Create a scheduled job for the reminder
    if (reminderAt) {
      const [job] = await this.db.insert(schema.scheduledJobs).values({
        tenantId: this.tenantId,
        jobType: "todo_reminder",
        scheduleType: "once",
        scheduledAt: reminderAt,
        payload: { todoId: todo.id, title },
        status: "active",
      }).returning();

      reminderJobId = job.id;
      await this.db.update(schema.todos)
        .set({ reminderJobId: job.id })
        .where(eq(schema.todos.id, todo.id));
    }

    return {
      success: true,
      task: {
        id: todo.id,
        title,
        dueDate,
        reminderAt: reminderAt?.toISOString() || null,
        priority,
        notes,
      },
      hint: reminderAt
        ? `Reminder scheduled for ${reminderAt.toLocaleDateString("en-US", { timeZone: this.timezone, month: "long", day: "numeric", year: "numeric" })}. Confirm this timing with the user or ask if they want to change it.`
        : dueDate
          ? "No reminder was set. Ask the user if they'd like a reminder before the due date."
          : "Task added with no due date. Let the user know they can add a due date later.",
    };
  }

  private async listTasks(params: Record<string, unknown>) {
    const statusFilter = (params.status as string) || "pending";

    const conditions = [eq(schema.todos.tenantId, this.tenantId)];
    if (statusFilter !== "all") {
      conditions.push(eq(schema.todos.status, statusFilter as "pending" | "done"));
    }

    const tasks = await this.db.query.todos.findMany({
      where: and(...conditions),
      orderBy: [desc(schema.todos.dueDate)],
    });

    // Sort: overdue first, then due today, then this week, then no date
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-CA", { timeZone: this.timezone }); // "2026-03-09"

    const categorized = tasks.map((t) => {
      let urgency = "backlog";
      if (t.dueDate) {
        if (t.dueDate < todayStr) urgency = "overdue";
        else if (t.dueDate === todayStr) urgency = "today";
        else {
          // Check if within 7 days
          const dueDateMs = new Date(t.dueDate + "T00:00:00").getTime();
          const nowMs = new Date(todayStr + "T00:00:00").getTime();
          if (dueDateMs - nowMs <= 7 * 86_400_000) urgency = "this_week";
          else urgency = "later";
        }
      }
      return {
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
        priority: t.priority,
        status: t.status,
        notes: t.notes,
        urgency,
        completedAt: t.completedAt?.toISOString() || null,
      };
    });

    // Sort by urgency: overdue > today > this_week > later > backlog
    const urgencyOrder: Record<string, number> = { overdue: 0, today: 1, this_week: 2, later: 3, backlog: 4 };
    categorized.sort((a, b) => (urgencyOrder[a.urgency] ?? 5) - (urgencyOrder[b.urgency] ?? 5));

    return {
      tasks: categorized,
      count: categorized.length,
      hint: "Present these as a friendly list grouped by urgency. For 'what should I work on today', focus on overdue and today items first.",
    };
  }

  private async completeTask(params: Record<string, unknown>) {
    const taskId = params.task_id as string;
    if (!taskId) throw new Error("Missing required parameter: task_id for complete_task");

    const task = await this.db.query.todos.findFirst({
      where: and(eq(schema.todos.id, taskId), eq(schema.todos.tenantId, this.tenantId)),
    });
    if (!task) return { success: false, error: "Task not found" };

    await this.db.update(schema.todos)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(schema.todos.id, taskId));

    // Cancel any pending reminder job
    if (task.reminderJobId) {
      await this.db.update(schema.scheduledJobs)
        .set({ status: "completed" })
        .where(eq(schema.scheduledJobs.id, task.reminderJobId));
    }

    return { success: true, title: task.title, hint: "Congratulate the user briefly." };
  }

  private async updateTask(params: Record<string, unknown>) {
    const taskId = params.task_id as string;
    if (!taskId) throw new Error("Missing required parameter: task_id for update_task");

    const task = await this.db.query.todos.findFirst({
      where: and(eq(schema.todos.id, taskId), eq(schema.todos.tenantId, this.tenantId)),
    });
    if (!task) return { success: false, error: "Task not found" };

    const updates: Record<string, unknown> = {};
    if (params.title) updates.title = params.title;
    if (params.notes !== undefined) updates.notes = params.notes;
    if (params.priority) updates.priority = params.priority;
    if (params.due_date) updates.dueDate = params.due_date;

    // Handle remind_before change
    const newDueDate = (params.due_date as string) || task.dueDate;
    const remindBefore = params.remind_before as string;

    if (remindBefore && newDueDate) {
      const durationMs = parseDuration(remindBefore);
      if (durationMs) {
        const dueDateUtc = localDateToUtcMidnight(newDueDate, this.timezone);
        const nineAmOffset = 9 * 3_600_000;
        const newReminderAt = new Date(dueDateUtc.getTime() - durationMs + nineAmOffset);

        if (newReminderAt.getTime() > Date.now()) {
          updates.reminderAt = newReminderAt;

          // Cancel old reminder job if exists
          if (task.reminderJobId) {
            await this.db.update(schema.scheduledJobs)
              .set({ status: "completed" })
              .where(eq(schema.scheduledJobs.id, task.reminderJobId));
          }

          // Create new reminder job
          const [job] = await this.db.insert(schema.scheduledJobs).values({
            tenantId: this.tenantId,
            jobType: "todo_reminder",
            scheduleType: "once",
            scheduledAt: newReminderAt,
            payload: { todoId: taskId, title: (params.title as string) || task.title },
            status: "active",
          }).returning();

          updates.reminderJobId = job.id;
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return { success: true, message: "No changes to apply" };
    }

    await this.db.update(schema.todos)
      .set(updates)
      .where(eq(schema.todos.id, taskId));

    return {
      success: true,
      updated: Object.keys(updates),
      hint: updates.reminderAt
        ? `Reminder updated. Confirm the new reminder date with the user.`
        : "Task updated.",
    };
  }

  private async deleteTask(params: Record<string, unknown>) {
    const taskId = params.task_id as string;
    if (!taskId) throw new Error("Missing required parameter: task_id for delete_task");

    const task = await this.db.query.todos.findFirst({
      where: and(eq(schema.todos.id, taskId), eq(schema.todos.tenantId, this.tenantId)),
    });
    if (!task) return { success: false, error: "Task not found" };

    // Cancel reminder job if exists
    if (task.reminderJobId) {
      await this.db.update(schema.scheduledJobs)
        .set({ status: "completed" })
        .where(eq(schema.scheduledJobs.id, task.reminderJobId));
    }

    await this.db.delete(schema.todos).where(eq(schema.todos.id, taskId));

    return { success: true, title: task.title };
  }
}
```

**Step 2: Create barrel export**

Create `packages/skills/src/todos/index.ts`:

```typescript
export { TodosHandler } from "./handler.js";
```

**Step 3: Add export to package index**

In `packages/skills/src/index.ts`, add after line 11:

```typescript
export { TodosHandler } from "./todos/index.js";
```

**Step 4: Build skills package**

Run: `pnpm --filter @babji/skills build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add packages/skills/src/todos/ packages/skills/src/index.ts
git commit -m "feat: add TodosHandler with CRUD + smart reminder scheduling"
```

---

### Task 3: Register `babji_tasks` skill in registry

**Files:**
- Modify: `packages/skills/src/registry.ts:651-685` (the `checkWithTeacherSkill` definition)
- Modify: `packages/skills/src/registry.ts:755` (`allSkills` array)

**Step 1: Add task actions to the babji skill**

In `packages/skills/src/registry.ts`, add these actions to the `checkWithTeacherSkill` definition's `actions` array (after the `connect_service` action, before the closing `]` at line 683):

```typescript
    {
      name: "add_task",
      description: "Add a new todo or reminder for the user. Use smart defaults for remind_before: gift/purchase tasks get 5-7 days, preparation tasks 2-3 days, meetings 1 day, general deadlines 1 day. Always confirm the reminder timing with the user after creating.",
      parameters: {
        title: {
          type: "string",
          required: true,
          description: "Short description of what to do",
        },
        due_date: {
          type: "string",
          required: false,
          description: "Due date in ISO format YYYY-MM-DD. Omit for general todos with no deadline.",
        },
        remind_before: {
          type: "string",
          required: false,
          description: "How long before due_date to send a reminder. Examples: '5d' (5 days), '1w' (1 week), '3h' (3 hours). Only works if due_date is set.",
        },
        priority: {
          type: "string",
          required: false,
          description: "Priority: 'low', 'medium' (default), or 'high'",
        },
        notes: {
          type: "string",
          required: false,
          description: "Additional context or details about the task",
        },
      },
    },
    {
      name: "list_tasks",
      description: "List the user's todos. Call this when the user asks 'what are my todos', 'what should I work on today', 'what's on my plate', or similar.",
      parameters: {
        status: {
          type: "string",
          required: false,
          description: "Filter: 'pending' (default), 'done', or 'all'",
        },
      },
    },
    {
      name: "complete_task",
      description: "Mark a todo as done.",
      parameters: {
        task_id: {
          type: "string",
          required: true,
          description: "The UUID of the task to complete",
        },
      },
    },
    {
      name: "update_task",
      description: "Update a todo's title, due date, reminder timing, priority, or notes.",
      parameters: {
        task_id: {
          type: "string",
          required: true,
          description: "The UUID of the task to update",
        },
        title: {
          type: "string",
          required: false,
          description: "New title",
        },
        due_date: {
          type: "string",
          required: false,
          description: "New due date in YYYY-MM-DD format",
        },
        remind_before: {
          type: "string",
          required: false,
          description: "New reminder offset, e.g. '3d', '1w'",
        },
        priority: {
          type: "string",
          required: false,
          description: "New priority: 'low', 'medium', 'high'",
        },
        notes: {
          type: "string",
          required: false,
          description: "New notes",
        },
      },
    },
    {
      name: "delete_task",
      description: "Delete a todo permanently.",
      parameters: {
        task_id: {
          type: "string",
          required: true,
          description: "The UUID of the task to delete",
        },
      },
    },
```

**Step 2: Build to verify**

Run: `pnpm --filter @babji/skills build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add packages/skills/src/registry.ts
git commit -m "feat: register babji_tasks actions (add/list/complete/update/delete)"
```

---

### Task 4: Wire TodosHandler into message-handler

**Files:**
- Modify: `packages/gateway/src/message-handler.ts:1-9` (imports)
- Modify: `packages/gateway/src/message-handler.ts:356-378` (babji skill registration block)

**Step 1: Add import**

In `packages/gateway/src/message-handler.ts`, add `TodosHandler` to the imports at line 9:

```typescript
import { GmailHandler, GoogleCalendarHandler, GoogleAdsHandler, GoogleAnalyticsHandler, PeopleHandler, TodosHandler } from "@babji/skills";
```

**Step 2: Register TodosHandler in the babji skill executor**

In the babji skill registration block (around line 356-378), we need to handle the task actions alongside `check_with_teacher` and `connect_service`. Replace the `babji` skill registration with:

```typescript
      // ── Register "babji" skill handler (check_with_teacher, connect_service, task actions) ──
      const todosHandler = new TodosHandler(this.deps.db, tenantId, tenant.timezone ?? "UTC");

      toolExecutor.registerSkill("babji", {
        execute: async (actionName: string, params: Record<string, unknown>) => {
          if (actionName === "check_with_teacher") {
            const result = await this.deps.skillRequests.create(
              tenantId,
              params.skill_name as string,
              params.context as string,
            );
            return { submitted: true, requestId: result.id };
          }
          if (actionName === "connect_service") {
            const raw = (params.service_name as string || "").toLowerCase().trim();
            const provider = matchProvider(raw);
            if (!provider) {
              return { success: false, error: `Unknown service "${raw}". Available: gmail, google_calendar, google_ads, google_analytics` };
            }
            const link = await this.generateConnectLink(tenantId, provider, channel, sender);
            return link;
          }
          // Task actions: add_task, list_tasks, complete_task, update_task, delete_task
          const taskActions = ["add_task", "list_tasks", "complete_task", "update_task", "delete_task"];
          if (taskActions.includes(actionName)) {
            return todosHandler.execute(actionName, params);
          }
          throw new Error(`Unknown babji action: ${actionName}`);
        },
      });
```

**Step 3: Build gateway**

Run: `pnpm --filter @babji/gateway build`
Expected: Clean build.

**Step 4: Run tests**

Run: `pnpm --filter @babji/gateway test`
Expected: 29/29 pass (no test changes needed — existing tests don't exercise task actions).

**Step 5: Commit**

```bash
git add packages/gateway/src/message-handler.ts
git commit -m "feat: wire TodosHandler into message-handler babji skill"
```

---

### Task 5: Add `todo_reminder` job type to job-runner

**Files:**
- Modify: `packages/gateway/src/job-runner.ts:151-163` (executeJob switch)
- Modify: `packages/gateway/src/job-runner.ts:261-292` (after runReminder method)

**Step 1: Add case to executeJob switch**

In `packages/gateway/src/job-runner.ts`, add a case in the `executeJob` switch (after line 158):

```typescript
      case "todo_reminder":
        await this.runTodoReminder(job);
        break;
```

**Step 2: Add the runTodoReminder method**

After the `runReminder` method (after line 292), add:

```typescript
  private async runTodoReminder(job: typeof schema.scheduledJobs.$inferSelect): Promise<void> {
    const tenantId = job.tenantId;
    const payload = job.payload as { todoId?: string; title?: string } | null;

    if (!payload?.todoId) {
      logger.warn({ jobId: job.id }, "todo_reminder job missing todoId in payload");
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "failed", lastRunAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
      return;
    }

    // Load the todo to check it's still pending
    const todo = await this.deps.db.query.todos.findFirst({
      where: and(eq(schema.todos.id, payload.todoId), eq(schema.todos.tenantId, tenantId)),
    });

    if (!todo || todo.status === "done") {
      // Todo was completed or deleted — just mark job as done
      await this.deps.db.update(schema.scheduledJobs)
        .set({ status: "completed", lastRunAt: new Date() })
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

    // Format a friendly reminder
    const title = todo.title;
    const dueDate = todo.dueDate;
    let message = `Hey ${tenant.name}, just a heads up -- "${title}"`;
    if (dueDate) {
      const formattedDate = new Date(dueDate + "T00:00:00").toLocaleDateString("en-US", {
        timeZone: tenant.timezone || "UTC",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      message += ` is coming up on ${formattedDate}`;
    }
    message += `. Want to mark it done, push it back, or need help with it?`;

    await adapter.sendMessage({ tenantId, channel, recipient, text: message });

    logger.info({ tenantId, todoId: payload.todoId, title }, "Sent todo reminder");

    // Mark job as completed
    await this.deps.db.update(schema.scheduledJobs)
      .set({ status: "completed", lastRunAt: new Date() })
      .where(eq(schema.scheduledJobs.id, job.id));
  }
```

**Step 3: Add import for `and` if not present (check line 1)**

Line 1 already has: `import { eq, and, lte } from "drizzle-orm";` — good, `and` is already imported.

Also need to import `schema.todos`. Check if `schema` is already imported — yes, line 3: `import { schema } from "@babji/db";`. The `todos` table is part of the schema export, so no new import needed.

**Step 4: Build**

Run: `pnpm --filter @babji/gateway build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add packages/gateway/src/job-runner.ts
git commit -m "feat: add todo_reminder job type to job-runner"
```

---

### Task 6: Add todo guidance to system prompt

**Files:**
- Modify: `packages/agent/src/prompt-builder.ts:77-87` (before formatting rules section)

**Step 1: Add todo guidance**

In `packages/agent/src/prompt-builder.ts`, add before the "Formatting rules" section (before line 78):

```typescript
    parts.push("## Task management rules");
    parts.push("You have built-in task management. When users mention todos, reminders, or things to remember:");
    parts.push("- Use babji.add_task to create todos. Pick a smart remind_before default:");
    parts.push("  - Gift/purchase: '5d' to '7d' (shipping time)");
    parts.push("  - Preparation (presentation, report): '2d' to '3d'");
    parts.push("  - Meeting/call: '1d'");
    parts.push("  - General deadline: '1d'");
    parts.push("- After creating a task with a reminder, ALWAYS confirm the timing: 'I will remind you on [date] -- [X] days before. Want me to change the timing?'");
    parts.push("- When the user asks 'what should I work on today', 'my todos', 'what is on my plate', call babji.list_tasks");
    parts.push("- Present task lists grouped by urgency: overdue first, then today, this week, then backlog");
    parts.push("- When referencing tasks for complete/update/delete, use the task ID from list_tasks results");
    parts.push("");
```

**Step 2: Build agent package**

Run: `pnpm --filter @babji/agent build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add packages/agent/src/prompt-builder.ts
git commit -m "feat: add todo management guidance to LLM system prompt"
```

---

### Task 7: Build, test, and deploy

**Step 1: Build all packages**

Run: `pnpm --filter @babji/db build && pnpm --filter @babji/agent build && pnpm --filter @babji/skills build && pnpm --filter @babji/gateway build`
Expected: All clean.

**Step 2: Run tests**

Run: `pnpm --filter @babji/gateway test`
Expected: 29/29 pass.

**Step 3: Run SQL migration on production**

```bash
ssh root@65.20.76.199 "docker exec -i babji-postgres psql -U babji -d babji <<'SQL'
CREATE TYPE todo_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE todo_status AS ENUM ('pending', 'done');

CREATE TABLE todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  notes TEXT,
  due_date VARCHAR(10),
  reminder_at TIMESTAMPTZ,
  reminder_job_id UUID,
  priority todo_priority NOT NULL DEFAULT 'medium',
  status todo_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_todos_tenant ON todos(tenant_id);
CREATE INDEX idx_todos_status ON todos(tenant_id, status);
SQL"
```

**Step 4: Deploy to production**

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

ssh root@65.20.76.199 'cd /opt/babji && pnpm install --frozen-lockfile'

ssh root@65.20.76.199 'kill $(pgrep -f "packages/gateway"); nohup /opt/babji/start-gateway.sh > /var/log/babji-gateway.log 2>&1 &'

ssh root@65.20.76.199 'sleep 2 && tail -10 /var/log/babji-gateway.log'
```

Expected: Gateway starts, "JobRunner started (30s interval)" in logs.

**Step 5: Test via Telegram**

Send to Babji: "Remind me to buy a gift for mom's birthday on April 15"
Expected: Babji creates a task and suggests a reminder 5 days before, asks for confirmation.

Send: "What are my todos?"
Expected: Babji lists the task.

**Step 6: Update CHANGELOG.md**

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat: todo and reminder system - complete implementation"
```
