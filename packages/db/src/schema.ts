import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  varchar,
  jsonb,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

export const planEnum = pgEnum("plan", ["free", "prepaid", "pro"]);
export const skillRequestStatusEnum = pgEnum("skill_request_status", [
  "pending",
  "in_progress",
  "completed",
  "rejected",
]);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }).unique(),
    telegramUserId: varchar("telegram_user_id", { length: 50 }).unique(),
    plan: planEnum("plan").notNull().default("free"),
    timezone: varchar("timezone", { length: 50 }).notNull().default("UTC"),
    containerStatus: varchar("container_status", { length: 20 })
      .notNull()
      .default("pending"),
    onboardingPhase: varchar("onboarding_phase", { length: 20 })
      .notNull()
      .default("name"),
    emailDomain: varchar("email_domain", { length: 100 }),
    meetingBriefingPref: varchar("meeting_briefing_pref", { length: 20 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_tenants_phone").on(table.phone),
    index("idx_tenants_telegram").on(table.telegramUserId),
  ]
);

export const creditBalances = pgTable("credit_balances", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  dailyFree: integer("daily_free").notNull().default(5),
  prepaid: integer("prepaid").notNull().default(0),
  proMonthly: integer("pro_monthly").notNull().default(0),
  lastDailyReset: timestamp("last_daily_reset").notNull().defaultNow(),
});

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    type: varchar("type", { length: 30 }).notNull(),
    amount: integer("amount").notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_credit_tx_tenant").on(table.tenantId),
  ]
);

export const serviceConnections = pgTable(
  "service_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    provider: varchar("provider", { length: 50 }).notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    tokenRef: text("token_ref").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_connections_tenant").on(table.tenantId),
    index("idx_connections_provider").on(table.tenantId, table.provider),
  ]
);

export const skillRequests = pgTable(
  "skill_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    skillName: varchar("skill_name", { length: 100 }).notNull(),
    context: text("context").notNull(),
    status: skillRequestStatusEnum("status").notNull().default("pending"),
    assignedTo: varchar("assigned_to", { length: 100 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    notifiedAt: timestamp("notified_at"),
  },
  (table) => [
    index("idx_skill_requests_status").on(table.status),
  ]
);

export const shortLinks = pgTable("short_links", {
  id: varchar("id", { length: 12 }).primaryKey(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
    dueDate: varchar("due_date", { length: 10 }), // "2026-04-15" ISO date string
    reminderAt: timestamp("reminder_at"),
    reminderJobId: uuid("reminder_job_id"),
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

export const jobStatusEnum = pgEnum("job_status", [
  "active",
  "paused",
  "completed",
  "failed",
]);

export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    jobType: varchar("job_type", { length: 50 }).notNull(), // e.g. "daily_calendar_summary", "reminder"
    scheduleType: varchar("schedule_type", { length: 20 }).notNull(), // "once" | "daily" | "cron"
    scheduledAt: timestamp("scheduled_at").notNull(), // next run time (UTC)
    recurrenceRule: varchar("recurrence_rule", { length: 50 }), // for daily: "07:30" (local time), for cron: cron expr
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    status: jobStatusEnum("status").notNull().default("active"),
    lastRunAt: timestamp("last_run_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_jobs_due").on(table.status, table.scheduledAt),
    index("idx_jobs_tenant").on(table.tenantId),
  ]
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    action: varchar("action", { length: 100 }).notNull(),
    skillName: varchar("skill_name", { length: 100 }),
    channel: varchar("channel", { length: 20 }),
    creditCost: integer("credit_cost").notNull().default(0),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_audit_tenant").on(table.tenantId),
    index("idx_audit_created").on(table.createdAt),
  ]
);
