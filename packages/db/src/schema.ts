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
  },
  (table) => [
    index("idx_skill_requests_status").on(table.status),
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
