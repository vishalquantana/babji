import { eq, and, desc, inArray } from "drizzle-orm";
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
  const local = new Date(y, mo - 1, d, 0, 0, 0);
  const utcStr = local.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = local.toLocaleString("en-US", { timeZone: timezone });
  const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();
  return new Date(local.getTime() + offsetMs);
}

/** Converts a local time string "HH:MM" + IANA timezone to the next UTC timestamp for that local time */
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
  const localYear = Number(get("year"));
  const localMonth = Number(get("month"));
  const localDay = Number(get("day"));
  const localHour = Number(get("hour"));
  const localMinute = Number(get("minute"));

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
    const recurrence = (params.recurrence as string) || null;
    const reminderTime = (params.reminder_time as string) || "09:00";

    // --- Recurring reminder path ---
    if (recurrence) {
      const [todo] = await this.db.insert(schema.todos).values({
        tenantId: this.tenantId,
        title,
        notes,
        dueDate: null,
        reminderAt: null,
        priority: priority as "low" | "medium" | "high",
        status: "pending",
      }).returning();

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

      const freqLabel = recurrence === "daily" ? "every day" : recurrence === "weekdays" ? "every weekday (Mon-Fri)" : recurrence;
      return {
        success: true,
        task: { id: todo.id, title, dueDate: null, priority, notes, recurrence, reminderTime },
        hint: `Recurring ${recurrence} reminder set for ${reminderTime}. Confirm with the user: "I'll remind you ${freqLabel} at ${reminderTime}. Want to change the time or frequency?"`,
      };
    }

    // --- One-shot reminder path (existing logic) ---
    let reminderAt: Date | null = null;

    if (dueDate && remindBefore) {
      const durationMs = parseDuration(remindBefore);
      if (durationMs) {
        const dueDateUtc = localDateToUtcMidnight(dueDate, this.timezone);
        const nineAmOffset = 9 * 3_600_000;
        reminderAt = new Date(dueDateUtc.getTime() - durationMs + nineAmOffset);
        if (reminderAt.getTime() <= Date.now()) {
          reminderAt = null;
        }
      }
    }

    const [todo] = await this.db.insert(schema.todos).values({
      tenantId: this.tenantId,
      title,
      notes,
      dueDate,
      reminderAt,
      priority: priority as "low" | "medium" | "high",
      status: "pending",
    }).returning();

    if (reminderAt) {
      const [job] = await this.db.insert(schema.scheduledJobs).values({
        tenantId: this.tenantId,
        jobType: "todo_reminder",
        scheduleType: "once",
        scheduledAt: reminderAt,
        payload: { todoId: todo.id, title },
        status: "active",
      }).returning();

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

    // Categorize by urgency
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: this.timezone });

    const categorized = tasks.map((t) => {
      let urgency = "backlog";
      if (t.dueDate) {
        if (t.dueDate < todayStr) urgency = "overdue";
        else if (t.dueDate === todayStr) urgency = "today";
        else {
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
        recurrence: t.reminderJobId ? (jobMap.get(t.reminderJobId) || null) : null,
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

          // Cancel old reminder job
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
        updates.reminderJobId = null;
        updates.reminderAt = null;
      } else {
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
        updates.reminderAt = null;
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
        ? "Reminder updated. Confirm the new reminder date with the user."
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
