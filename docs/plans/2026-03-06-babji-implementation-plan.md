# Babji Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Babji AI business assistant platform -- a multi-tenant, WhatsApp/Telegram-first agent that manages email, calendar, ads, and social media for business users.

**Architecture:** OpenClaw-inspired five-component architecture (Gateway, Brain, Memory, Skills, Heartbeat) built from scratch for multi-tenancy with Docker container isolation per tenant. Shared Gateway routes messages from channels to per-tenant agent containers. Billing/credits, OAuth, and admin dashboard are shared services.

**Tech Stack:** TypeScript/Node.js, Fastify, Baileys (WhatsApp), grammy (Telegram), Vercel AI SDK (multi-model LLM), PostgreSQL, Redis, Docker, Next.js (OAuth portal + admin), Stripe.

---

## Phase 1: Foundation (Monorepo + Core Types + Database)

Get the project scaffolded, typed, and wired to a database. Nothing runs yet, but everything compiles.

---

### Task 1: Initialize monorepo with pnpm workspaces

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`

**Step 1: Initialize root package.json**

```json
{
  "name": "babji",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

**Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

**Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  }
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.env
.env.*
*.enc
*.log
.DS_Store
```

**Step 5: Create .nvmrc**

```
22
```

**Step 6: Create packages/types with core type definitions**

`packages/types/src/index.ts`:
```typescript
// === Channel Types ===

export type Channel = "whatsapp" | "telegram" | "app";

export interface BabjiMessage {
  id: string;
  tenantId: string;
  channel: Channel;
  sender: string; // phone number, telegram user id, or app user id
  text: string;
  media?: MediaAttachment;
  timestamp: Date;
  replyTo?: string;
}

export interface MediaAttachment {
  type: "image" | "video" | "audio" | "document";
  url: string;
  mimeType: string;
  fileName?: string;
}

export interface OutboundMessage {
  tenantId: string;
  channel: Channel;
  recipient: string;
  text: string;
  media?: MediaAttachment;
  buttons?: MessageButton[];
}

export interface MessageButton {
  label: string;
  url?: string;
  callbackData?: string;
}

// === Tenant Types ===

export interface Tenant {
  id: string;
  name: string;
  phone?: string;
  telegramUserId?: string;
  plan: "free" | "prepaid" | "pro";
  timezone: string;
  createdAt: Date;
  lastActiveAt: Date;
}

// === Credit Types ===

export interface CreditBalance {
  tenantId: string;
  dailyFree: number; // remaining today
  prepaid: number;
  proMonthly: number; // remaining this month
  total: number; // computed
}

export type TransactionType =
  | "daily_grant"
  | "action_debit"
  | "prepaid_purchase"
  | "pro_monthly_grant"
  | "pro_monthly_reset";

export interface CreditTransaction {
  id: string;
  tenantId: string;
  type: TransactionType;
  amount: number; // positive = credit, negative = debit
  description: string;
  timestamp: Date;
}

// === Skill Types ===

export interface SkillDefinition {
  name: string;
  displayName: string;
  description: string;
  requiresAuth?: {
    provider: string;
    scopes: string[];
  };
  actions: SkillAction[];
  creditsPerAction: number;
}

export interface SkillAction {
  name: string;
  description: string;
  parameters: Record<string, SkillParameter>;
}

export interface SkillParameter {
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: unknown;
  description?: string;
}

export type SkillRequestStatus = "pending" | "in_progress" | "completed" | "rejected";

export interface SkillRequest {
  id: string;
  tenantId: string;
  skillName: string;
  context: string;
  status: SkillRequestStatus;
  assignedTo?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

// === Connection Types ===

export interface ServiceConnection {
  id: string;
  tenantId: string;
  provider: string;
  scopes: string[];
  tokenRef: string; // path to encrypted token file
  expiresAt: Date;
  createdAt: Date;
}

// === Agent Types ===

export interface AgentContext {
  tenant: Tenant;
  memory: string; // contents of MEMORY.md
  soul: string; // contents of SOUL.md
  connections: ServiceConnection[];
  skills: SkillDefinition[];
  sessionHistory: SessionMessage[];
}

export interface SessionMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
  timestamp: Date;
}

export interface ToolCall {
  id: string;
  skillName: string;
  actionName: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  result: unknown;
  error?: string;
}

// === Heartbeat Types ===

export interface HeartbeatConfig {
  tenantId: string;
  intervalMinutes: number;
  activeHoursStart: number; // 0-23
  activeHoursEnd: number; // 0-23
  timezone: string;
  instructions: string; // contents of HEARTBEAT.md
}

export type HeartbeatResult = "ok" | "notification_sent";
```

`packages/types/package.json`:
```json
{
  "name": "@babji/types",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "echo 'no tests yet'"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

`packages/types/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 7: Install dependencies and verify build**

Run: `pnpm install && pnpm build`
Expected: Clean compilation, `packages/types/dist/index.js` exists

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: initialize monorepo with pnpm workspaces and core types"
```

---

### Task 2: Database schema and migration setup

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `docker-compose.dev.yml` (PostgreSQL + Redis for local dev)

**Step 1: Create docker-compose.dev.yml for local PostgreSQL and Redis**

```yaml
version: "3.8"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: babji
      POSTGRES_USER: babji
      POSTGRES_PASSWORD: babji_dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

**Step 2: Create packages/db with Drizzle ORM schema**

`packages/db/package.json`:
```json
{
  "name": "@babji/db",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/migrate.ts",
    "db:push": "drizzle-kit push",
    "test": "vitest run"
  },
  "dependencies": {
    "drizzle-orm": "^0.38.0",
    "postgres": "^3.4.0",
    "@babji/types": "workspace:*"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/db/src/schema.ts`:
```typescript
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
    tokenRef: text("token_ref").notNull(), // path to encrypted token
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
```

`packages/db/src/index.ts`:
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
export { schema };
```

`packages/db/src/migrate.ts`:
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL || "postgres://babji:babji_dev@localhost:5432/babji";

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

async function main() {
  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
```

`packages/db/drizzle.config.ts`:
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgres://babji:babji_dev@localhost:5432/babji",
  },
});
```

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Start dev services, install deps, generate migrations**

Run: `docker compose -f docker-compose.dev.yml up -d`
Run: `pnpm install`
Run: `cd packages/db && pnpm db:generate && pnpm db:push`
Expected: PostgreSQL running, tables created

**Step 4: Verify schema by connecting to DB**

Run: `docker exec -it $(docker ps -q -f name=postgres) psql -U babji -c '\dt'`
Expected: Lists all tables (tenants, credit_balances, credit_transactions, etc.)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add database schema with Drizzle ORM and docker-compose dev setup"
```

---

## Phase 2: Gateway + Channel Adapters

Wire up the message ingestion pipeline. After this phase, you can send a WhatsApp message and see it arrive in the Gateway logs.

---

### Task 3: Gateway service scaffold with Fastify

**Files:**
- Create: `packages/gateway/package.json`
- Create: `packages/gateway/tsconfig.json`
- Create: `packages/gateway/src/index.ts`
- Create: `packages/gateway/src/server.ts`
- Create: `packages/gateway/src/config.ts`
- Create: `packages/gateway/src/tenant-resolver.ts`
- Create: `packages/gateway/src/message-normalizer.ts`
- Create: `packages/gateway/src/router.ts`
- Test: `packages/gateway/src/__tests__/tenant-resolver.test.ts`
- Test: `packages/gateway/src/__tests__/message-normalizer.test.ts`

**Step 1: Write failing test for TenantResolver**

`packages/gateway/src/__tests__/tenant-resolver.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { TenantResolver } from "../tenant-resolver.js";

describe("TenantResolver", () => {
  it("resolves tenant by phone number", async () => {
    const mockDb = {
      query: {
        tenants: {
          findFirst: vi.fn().mockResolvedValue({
            id: "tenant-1",
            name: "Test User",
            phone: "+1234567890",
          }),
        },
      },
    };
    const resolver = new TenantResolver(mockDb as any);
    const tenant = await resolver.resolveByPhone("+1234567890");
    expect(tenant?.id).toBe("tenant-1");
  });

  it("returns null for unknown phone", async () => {
    const mockDb = {
      query: {
        tenants: {
          findFirst: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
    const resolver = new TenantResolver(mockDb as any);
    const tenant = await resolver.resolveByPhone("+9999999999");
    expect(tenant).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/gateway && pnpm test`
Expected: FAIL - module not found

**Step 3: Implement TenantResolver**

`packages/gateway/src/tenant-resolver.ts`:
```typescript
import { eq } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";

export class TenantResolver {
  constructor(private db: Database) {}

  async resolveByPhone(phone: string) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(schema.tenants.phone, phone),
    });
    return tenant ?? null;
  }

  async resolveByTelegramId(telegramUserId: string) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(schema.tenants.telegramUserId, telegramUserId),
    });
    return tenant ?? null;
  }
}
```

**Step 4: Write failing test for MessageNormalizer**

`packages/gateway/src/__tests__/message-normalizer.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { MessageNormalizer } from "../message-normalizer.js";

describe("MessageNormalizer", () => {
  it("normalizes a WhatsApp message", () => {
    const raw = {
      key: { remoteJid: "1234567890@s.whatsapp.net", id: "msg-1" },
      message: { conversation: "Hello Babji" },
      messageTimestamp: 1709740800,
    };
    const normalized = MessageNormalizer.fromWhatsApp(raw, "tenant-1");
    expect(normalized.tenantId).toBe("tenant-1");
    expect(normalized.channel).toBe("whatsapp");
    expect(normalized.text).toBe("Hello Babji");
    expect(normalized.sender).toBe("1234567890");
  });

  it("normalizes a Telegram message", () => {
    const raw = {
      message_id: 42,
      from: { id: 99887766, first_name: "Test" },
      text: "Hey there",
      date: 1709740800,
    };
    const normalized = MessageNormalizer.fromTelegram(raw, "tenant-2");
    expect(normalized.tenantId).toBe("tenant-2");
    expect(normalized.channel).toBe("telegram");
    expect(normalized.text).toBe("Hey there");
    expect(normalized.sender).toBe("99887766");
  });
});
```

**Step 5: Implement MessageNormalizer**

`packages/gateway/src/message-normalizer.ts`:
```typescript
import { randomUUID } from "node:crypto";
import type { BabjiMessage } from "@babji/types";

export class MessageNormalizer {
  static fromWhatsApp(raw: any, tenantId: string): BabjiMessage {
    const jid = raw.key.remoteJid as string;
    const phone = jid.replace("@s.whatsapp.net", "").replace("@g.us", "");
    return {
      id: raw.key.id || randomUUID(),
      tenantId,
      channel: "whatsapp",
      sender: phone,
      text: raw.message?.conversation || raw.message?.extendedTextMessage?.text || "",
      timestamp: new Date((raw.messageTimestamp as number) * 1000),
    };
  }

  static fromTelegram(raw: any, tenantId: string): BabjiMessage {
    return {
      id: String(raw.message_id),
      tenantId,
      channel: "telegram",
      sender: String(raw.from.id),
      text: raw.text || "",
      timestamp: new Date(raw.date * 1000),
    };
  }
}
```

**Step 6: Implement Gateway config and server**

`packages/gateway/src/config.ts`:
```typescript
export interface GatewayConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  whatsapp: {
    enabled: boolean;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
  };
}

export function loadConfig(): GatewayConfig {
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl:
      process.env.DATABASE_URL ||
      "postgres://babji:babji_dev@localhost:5432/babji",
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
    whatsapp: {
      enabled: process.env.WHATSAPP_ENABLED !== "false",
    },
    telegram: {
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    },
  };
}
```

`packages/gateway/src/router.ts`:
```typescript
import type { BabjiMessage, OutboundMessage } from "@babji/types";

export interface AgentClient {
  sendMessage(message: BabjiMessage): Promise<OutboundMessage>;
}

export class Router {
  // In v1, this calls the agent directly. Later, it routes to per-tenant containers.
  constructor(private agentClient: AgentClient) {}

  async route(message: BabjiMessage): Promise<OutboundMessage> {
    return this.agentClient.sendMessage(message);
  }
}
```

`packages/gateway/src/server.ts`:
```typescript
import Fastify from "fastify";
import type { GatewayConfig } from "./config.js";

export function createServer(config: GatewayConfig) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
```

`packages/gateway/src/index.ts`:
```typescript
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main() {
  const config = loadConfig();
  const server = createServer(config);

  await server.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Babji Gateway running on port ${config.port}`);
}

main().catch((err) => {
  console.error("Gateway startup failed:", err);
  process.exit(1);
});
```

`packages/gateway/package.json`:
```json
{
  "name": "@babji/gateway",
  "version": "0.1.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "@babji/types": "workspace:*",
    "@babji/db": "workspace:*",
    "drizzle-orm": "^0.38.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 7: Run all tests**

Run: `pnpm install && cd packages/gateway && pnpm test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Gateway service scaffold with tenant resolver and message normalizer"
```

---

### Task 4: Baileys WhatsApp adapter

**Files:**
- Create: `packages/gateway/src/adapters/whatsapp.ts`
- Create: `packages/gateway/src/adapters/types.ts`
- Test: `packages/gateway/src/__tests__/whatsapp-adapter.test.ts`

**Step 1: Define the adapter interface**

`packages/gateway/src/adapters/types.ts`:
```typescript
import type { BabjiMessage, OutboundMessage } from "@babji/types";

export interface ChannelAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (message: BabjiMessage) => Promise<void>): void;
  sendMessage(message: OutboundMessage): Promise<void>;
}
```

**Step 2: Implement WhatsApp adapter using Baileys**

`packages/gateway/src/adapters/whatsapp.ts`:
```typescript
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type BaileysEventMap,
} from "baileys";
import { Boom } from "@hapi/boom";
import type { ChannelAdapter } from "./types.js";
import type { BabjiMessage, OutboundMessage } from "@babji/types";
import { MessageNormalizer } from "../message-normalizer.js";
import { TenantResolver } from "../tenant-resolver.js";
import type { Database } from "@babji/db";

export class WhatsAppAdapter implements ChannelAdapter {
  name = "whatsapp";
  private socket: WASocket | null = null;
  private messageHandler: ((msg: BabjiMessage) => Promise<void>) | null = null;
  private authDir: string;

  constructor(
    private tenantResolver: TenantResolver,
    private db: Database,
    authDir = "./data/whatsapp-auth"
  ) {
    this.authDir = authDir;
  }

  onMessage(handler: (message: BabjiMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    this.socket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
    });

    this.socket.ev.on("creds.update", saveCreds);

    this.socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close") {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (reason !== DisconnectReason.loggedOut) {
          console.log("WhatsApp disconnected, reconnecting...");
          this.start();
        } else {
          console.log("WhatsApp logged out. Please re-scan QR code.");
        }
      } else if (connection === "open") {
        console.log("WhatsApp connected.");
      }
    });

    this.socket.ev.on(
      "messages.upsert",
      async ({ messages }: BaileysEventMap["messages.upsert"]) => {
        for (const msg of messages) {
          if (msg.key.fromMe) continue;
          if (!msg.message) continue;

          const phone = (msg.key.remoteJid || "")
            .replace("@s.whatsapp.net", "")
            .replace("@g.us", "");

          let tenant = await this.tenantResolver.resolveByPhone(phone);
          const tenantId = tenant?.id || "onboarding:" + phone;

          const normalized = MessageNormalizer.fromWhatsApp(msg, tenantId);
          if (this.messageHandler) {
            await this.messageHandler(normalized);
          }
        }
      }
    );
  }

  async stop(): Promise<void> {
    this.socket?.end(undefined);
    this.socket = null;
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.socket) throw new Error("WhatsApp not connected");
    const jid = message.recipient + "@s.whatsapp.net";
    await this.socket.sendMessage(jid, { text: message.text });
  }
}
```

**Step 3: Add baileys dependency**

Add to `packages/gateway/package.json` dependencies:
```json
"baileys": "^7.0.0",
"@hapi/boom": "^10.0.0"
```

**Step 4: Run pnpm install and build**

Run: `pnpm install && cd packages/gateway && pnpm build`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Baileys WhatsApp adapter for Gateway"
```

---

### Task 5: Telegram adapter

**Files:**
- Create: `packages/gateway/src/adapters/telegram.ts`

**Step 1: Implement Telegram adapter using grammy**

`packages/gateway/src/adapters/telegram.ts`:
```typescript
import { Bot } from "grammy";
import type { ChannelAdapter } from "./types.js";
import type { BabjiMessage, OutboundMessage } from "@babji/types";
import { MessageNormalizer } from "../message-normalizer.js";
import { TenantResolver } from "../tenant-resolver.js";

export class TelegramAdapter implements ChannelAdapter {
  name = "telegram";
  private bot: Bot;
  private messageHandler: ((msg: BabjiMessage) => Promise<void>) | null = null;

  constructor(
    botToken: string,
    private tenantResolver: TenantResolver
  ) {
    this.bot = new Bot(botToken);
  }

  onMessage(handler: (message: BabjiMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    this.bot.on("message:text", async (ctx) => {
      const telegramUserId = String(ctx.from.id);
      let tenant = await this.tenantResolver.resolveByTelegramId(telegramUserId);
      const tenantId = tenant?.id || "onboarding:tg:" + telegramUserId;

      const normalized = MessageNormalizer.fromTelegram(
        {
          message_id: ctx.message.message_id,
          from: ctx.from,
          text: ctx.message.text,
          date: ctx.message.date,
        },
        tenantId
      );

      if (this.messageHandler) {
        await this.messageHandler(normalized);
      }
    });

    this.bot.start();
    console.log("Telegram bot started.");
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    await this.bot.api.sendMessage(message.recipient, message.text);
  }
}
```

**Step 2: Add grammy dependency**

Add to `packages/gateway/package.json` dependencies:
```json
"grammy": "^1.30.0"
```

**Step 3: Install, build, and verify**

Run: `pnpm install && cd packages/gateway && pnpm build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Telegram adapter for Gateway using grammy"
```

---

## Phase 3: Agent Brain (ReAct Loop + LLM Integration)

The core intelligence. After this phase, Babji can receive a message and respond using an LLM.

---

### Task 6: Agent brain with ReAct loop

**Files:**
- Create: `packages/agent/package.json`
- Create: `packages/agent/tsconfig.json`
- Create: `packages/agent/src/index.ts`
- Create: `packages/agent/src/brain.ts`
- Create: `packages/agent/src/llm-client.ts`
- Create: `packages/agent/src/tool-executor.ts`
- Create: `packages/agent/src/prompt-builder.ts`
- Test: `packages/agent/src/__tests__/brain.test.ts`
- Test: `packages/agent/src/__tests__/prompt-builder.test.ts`

**Step 1: Write failing test for PromptBuilder**

`packages/agent/src/__tests__/prompt-builder.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../prompt-builder.js";

describe("PromptBuilder", () => {
  it("builds system prompt from soul + memory + skills", () => {
    const prompt = PromptBuilder.build({
      soul: "You are Babji, a friendly AI assistant.",
      memory: "User's name is Alice. She runs a bakery.",
      skills: [
        {
          name: "gmail",
          displayName: "Gmail",
          description: "Manage emails",
          actions: [
            {
              name: "list_emails",
              description: "List emails",
              parameters: {},
            },
          ],
          creditsPerAction: 1,
        },
      ],
      connections: ["gmail"],
    });

    expect(prompt).toContain("You are Babji");
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("bakery");
    expect(prompt).toContain("gmail");
    expect(prompt).toContain("list_emails");
  });
});
```

**Step 2: Implement PromptBuilder**

`packages/agent/src/prompt-builder.ts`:
```typescript
import type { SkillDefinition } from "@babji/types";

interface PromptContext {
  soul: string;
  memory: string;
  skills: SkillDefinition[];
  connections: string[];
}

export class PromptBuilder {
  static build(ctx: PromptContext): string {
    const parts: string[] = [];

    parts.push(ctx.soul);
    parts.push("");
    parts.push("## What you remember about this client");
    parts.push(ctx.memory || "Nothing yet -- this is a new client.");
    parts.push("");
    parts.push("## Connected services");
    if (ctx.connections.length === 0) {
      parts.push("No services connected yet.");
    } else {
      parts.push(ctx.connections.join(", "));
    }
    parts.push("");
    parts.push("## Available skills");
    for (const skill of ctx.skills) {
      if (!ctx.connections.includes(skill.name) && skill.requiresAuth) continue;
      parts.push(`### ${skill.displayName} (${skill.name})`);
      parts.push(skill.description);
      for (const action of skill.actions) {
        const params = Object.entries(action.parameters)
          .map(([k, v]) => `${k}: ${v.type}${v.required ? " (required)" : ""}`)
          .join(", ");
        parts.push(`- ${action.name}(${params}): ${action.description}`);
      }
    }

    return parts.join("\n");
  }
}
```

**Step 3: Write failing test for Brain**

`packages/agent/src/__tests__/brain.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { Brain } from "../brain.js";

describe("Brain", () => {
  it("returns LLM response for a simple message", async () => {
    const mockLlm = {
      chat: vi.fn().mockResolvedValue({
        content: "Hey! I'm Babji, nice to meet you!",
        toolCalls: [],
      }),
    };
    const mockToolExecutor = { execute: vi.fn() };

    const brain = new Brain(mockLlm as any, mockToolExecutor as any);
    const response = await brain.process({
      systemPrompt: "You are Babji.",
      messages: [{ role: "user" as const, content: "Hi" }],
      maxTurns: 5,
    });

    expect(response.content).toContain("Babji");
    expect(mockLlm.chat).toHaveBeenCalledOnce();
  });

  it("executes tool calls and loops", async () => {
    const mockLlm = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          toolCalls: [
            { id: "tc-1", skillName: "gmail", actionName: "list_emails", parameters: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: "You have 3 unread emails.",
          toolCalls: [],
        }),
    };
    const mockToolExecutor = {
      execute: vi.fn().mockResolvedValue({
        toolCallId: "tc-1",
        success: true,
        result: [{ subject: "Email 1" }, { subject: "Email 2" }, { subject: "Email 3" }],
      }),
    };

    const brain = new Brain(mockLlm as any, mockToolExecutor as any);
    const response = await brain.process({
      systemPrompt: "You are Babji.",
      messages: [{ role: "user" as const, content: "Check my email" }],
      maxTurns: 5,
    });

    expect(response.content).toContain("3 unread");
    expect(mockLlm.chat).toHaveBeenCalledTimes(2);
    expect(mockToolExecutor.execute).toHaveBeenCalledOnce();
  });
});
```

**Step 4: Implement Brain (ReAct loop)**

`packages/agent/src/brain.ts`:
```typescript
import type { ToolCall, ToolResult } from "@babji/types";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

interface LlmResponse {
  content: string;
  toolCalls: ToolCall[];
}

export interface LlmClient {
  chat(messages: ChatMessage[]): Promise<LlmResponse>;
}

export interface ToolExecutor {
  execute(toolCall: ToolCall): Promise<ToolResult>;
}

interface ProcessInput {
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTurns: number;
}

interface ProcessOutput {
  content: string;
  toolCallsMade: ToolCall[];
}

export class Brain {
  constructor(
    private llm: LlmClient,
    private toolExecutor: ToolExecutor
  ) {}

  async process(input: ProcessInput): Promise<ProcessOutput> {
    const messages: ChatMessage[] = [
      { role: "system", content: input.systemPrompt },
      ...input.messages,
    ];

    const allToolCalls: ToolCall[] = [];

    for (let turn = 0; turn < input.maxTurns; turn++) {
      const response = await this.llm.chat(messages);

      if (response.toolCalls.length === 0) {
        return { content: response.content, toolCallsMade: allToolCalls };
      }

      messages.push({
        role: "assistant",
        content: response.content || "",
        toolCalls: response.toolCalls,
      });

      for (const toolCall of response.toolCalls) {
        allToolCalls.push(toolCall);
        const result = await this.toolExecutor.execute(toolCall);
        messages.push({
          role: "tool",
          content: JSON.stringify(result.result),
          toolCallId: toolCall.id,
        });
      }
    }

    return {
      content: "I ran out of thinking steps. Let me try a different approach.",
      toolCallsMade: allToolCalls,
    };
  }
}
```

**Step 5: Implement LLM client with multi-model support**

`packages/agent/src/llm-client.ts`:
```typescript
import { generateText, type CoreMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ToolCall } from "@babji/types";

type Provider = "anthropic" | "openai" | "google";

interface LlmConfig {
  primaryProvider: Provider;
  fallbackProviders: Provider[];
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

interface LlmResponse {
  content: string;
  toolCalls: ToolCall[];
}

export class MultiModelLlmClient {
  private config: LlmConfig;

  constructor(config: LlmConfig) {
    this.config = config;
  }

  private getModel(provider: Provider) {
    switch (provider) {
      case "anthropic": {
        const anthropic = createAnthropic({ apiKey: this.config.anthropicApiKey });
        return anthropic("claude-sonnet-4-20250514");
      }
      case "openai": {
        const openai = createOpenAI({ apiKey: this.config.openaiApiKey });
        return openai("gpt-4o");
      }
      case "google": {
        const google = createGoogleGenerativeAI({ apiKey: this.config.googleApiKey });
        return google("gemini-2.0-flash");
      }
    }
  }

  async chat(messages: ChatMessage[]): Promise<LlmResponse> {
    const providers = [this.config.primaryProvider, ...this.config.fallbackProviders];

    for (const provider of providers) {
      try {
        const model = this.getModel(provider);
        const coreMessages: CoreMessage[] = messages.map((m) => ({
          role: m.role as any,
          content: m.content,
        }));

        const result = await generateText({
          model,
          messages: coreMessages,
        });

        return {
          content: result.text,
          toolCalls: [], // Tool calls handled via AI SDK tool definitions in production
        };
      } catch (err) {
        console.error(`LLM provider ${provider} failed:`, err);
        continue;
      }
    }

    throw new Error("All LLM providers failed");
  }
}
```

**Step 6: Implement ToolExecutor stub**

`packages/agent/src/tool-executor.ts`:
```typescript
import type { ToolCall, ToolResult } from "@babji/types";

export interface SkillHandler {
  execute(actionName: string, parameters: Record<string, unknown>): Promise<unknown>;
}

export class ToolExecutor {
  private handlers = new Map<string, SkillHandler>();

  registerSkill(skillName: string, handler: SkillHandler): void {
    this.handlers.set(skillName, handler);
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const handler = this.handlers.get(toolCall.skillName);
    if (!handler) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: `Skill "${toolCall.skillName}" not available. It may need to be connected first.`,
      };
    }

    try {
      const result = await handler.execute(toolCall.actionName, toolCall.parameters);
      return { toolCallId: toolCall.id, success: true, result };
    } catch (err) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }
}
```

`packages/agent/src/index.ts`:
```typescript
export { Brain } from "./brain.js";
export type { LlmClient, ToolExecutor as IToolExecutor } from "./brain.js";
export { ToolExecutor } from "./tool-executor.js";
export { MultiModelLlmClient } from "./llm-client.js";
export { PromptBuilder } from "./prompt-builder.js";
```

`packages/agent/package.json`:
```json
{
  "name": "@babji/agent",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@babji/types": "workspace:*",
    "ai": "^4.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/google": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/agent/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 7: Run tests**

Run: `pnpm install && cd packages/agent && pnpm test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Agent brain with ReAct loop, multi-model LLM client, and tool executor"
```

---

## Phase 4: Memory System

File-based persistent memory per tenant.

---

### Task 7: Memory manager

**Files:**
- Create: `packages/memory/package.json`
- Create: `packages/memory/tsconfig.json`
- Create: `packages/memory/src/index.ts`
- Create: `packages/memory/src/memory-manager.ts`
- Create: `packages/memory/src/session-store.ts`
- Create: `packages/memory/src/templates/SOUL.md`
- Test: `packages/memory/src/__tests__/memory-manager.test.ts`
- Test: `packages/memory/src/__tests__/session-store.test.ts`

**Step 1: Write failing test for MemoryManager**

`packages/memory/src/__tests__/memory-manager.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryManager } from "../memory-manager.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("MemoryManager", () => {
  let tempDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "babji-test-"));
    manager = new MemoryManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("initializes tenant memory with default files", async () => {
    await manager.initialize("tenant-1");
    const soul = await manager.readSoul("tenant-1");
    expect(soul).toContain("Babji");

    const memory = await manager.readMemory("tenant-1");
    expect(memory).toBe("");
  });

  it("appends facts to MEMORY.md", async () => {
    await manager.initialize("tenant-1");
    await manager.appendMemory("tenant-1", "User's name is Alice.");
    await manager.appendMemory("tenant-1", "She runs a bakery in Mumbai.");

    const memory = await manager.readMemory("tenant-1");
    expect(memory).toContain("Alice");
    expect(memory).toContain("bakery");
  });

  it("writes and reads daily log", async () => {
    await manager.initialize("tenant-1");
    await manager.writeDailyLog("tenant-1", "Had a conversation about email setup.");

    const log = await manager.readDailyLog("tenant-1");
    expect(log).toContain("email setup");
  });
});
```

**Step 2: Implement MemoryManager**

`packages/memory/src/memory-manager.ts`:
```typescript
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DEFAULT_SOUL = `# Babji

You are Babji, a friendly and capable AI business assistant.
You speak casually but professionally. You're helpful, proactive, and a bit playful.

## Personality
- Credits = "juice"
- Learning new skills = "checking with my teacher"
- Heartbeat checks = "just checking in"
- You remember everything about your client. You're their digital butler.
- When you can't do something, you're honest about it and offer to learn.
- When you need access to a service, you make it easy -- just send a link.
- Never be robotic. Never say "as an AI". You're Babji.

## Rules
- Keep responses concise -- this is WhatsApp/Telegram, not an essay
- Use short paragraphs, line breaks, and occasional emojis
- When taking actions, confirm what you did
- When you need authorization for a service, send the OAuth link
- Track credits: warn when running low on juice
- For unknown capabilities: offer to "check with my teacher"
`;

export class MemoryManager {
  constructor(private baseDir: string) {}

  private tenantDir(tenantId: string): string {
    return join(this.baseDir, tenantId);
  }

  async initialize(tenantId: string): Promise<void> {
    const dir = this.tenantDir(tenantId);
    await mkdir(join(dir, "sessions"), { recursive: true });
    await mkdir(join(dir, "memory"), { recursive: true });
    await mkdir(join(dir, "credentials"), { recursive: true });

    if (!existsSync(join(dir, "SOUL.md"))) {
      await writeFile(join(dir, "SOUL.md"), DEFAULT_SOUL, "utf-8");
    }
    if (!existsSync(join(dir, "MEMORY.md"))) {
      await writeFile(join(dir, "MEMORY.md"), "", "utf-8");
    }
    if (!existsSync(join(dir, "CONNECTIONS.md"))) {
      await writeFile(join(dir, "CONNECTIONS.md"), "# Connected Services\n\nNone yet.\n", "utf-8");
    }
    if (!existsSync(join(dir, "HEARTBEAT.md"))) {
      await writeFile(
        join(dir, "HEARTBEAT.md"),
        "# Heartbeat Instructions\n\n## General\n- Check for any pending follow-ups\n",
        "utf-8"
      );
    }
  }

  async readSoul(tenantId: string): Promise<string> {
    return readFile(join(this.tenantDir(tenantId), "SOUL.md"), "utf-8");
  }

  async readMemory(tenantId: string): Promise<string> {
    return readFile(join(this.tenantDir(tenantId), "MEMORY.md"), "utf-8");
  }

  async appendMemory(tenantId: string, fact: string): Promise<void> {
    const datestamp = new Date().toISOString().split("T")[0];
    await appendFile(
      join(this.tenantDir(tenantId), "MEMORY.md"),
      `\n- [${datestamp}] ${fact}`,
      "utf-8"
    );
  }

  async readHeartbeat(tenantId: string): Promise<string> {
    return readFile(join(this.tenantDir(tenantId), "HEARTBEAT.md"), "utf-8");
  }

  async writeDailyLog(tenantId: string, content: string): Promise<void> {
    const date = new Date().toISOString().split("T")[0];
    const logPath = join(this.tenantDir(tenantId), "memory", `${date}.md`);
    await appendFile(logPath, `\n${content}\n`, "utf-8");
  }

  async readDailyLog(tenantId: string, date?: string): Promise<string> {
    const d = date || new Date().toISOString().split("T")[0];
    const logPath = join(this.tenantDir(tenantId), "memory", `${d}.md`);
    try {
      return await readFile(logPath, "utf-8");
    } catch {
      return "";
    }
  }
}
```

**Step 3: Write failing test for SessionStore**

`packages/memory/src/__tests__/session-store.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore } from "../session-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("SessionStore", () => {
  let tempDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "babji-session-"));
    store = new SessionStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("appends and retrieves session messages", async () => {
    await store.append("tenant-1", "session-1", {
      role: "user",
      content: "Hello",
      timestamp: new Date(),
    });
    await store.append("tenant-1", "session-1", {
      role: "assistant",
      content: "Hey! I'm Babji!",
      timestamp: new Date(),
    });

    const messages = await store.getHistory("tenant-1", "session-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].content).toBe("Hey! I'm Babji!");
  });
});
```

**Step 4: Implement SessionStore**

`packages/memory/src/session-store.ts`:
```typescript
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SessionMessage } from "@babji/types";

export class SessionStore {
  constructor(private baseDir: string) {}

  private sessionPath(tenantId: string, sessionId: string): string {
    return join(this.baseDir, tenantId, "sessions", `${sessionId}.jsonl`);
  }

  async append(tenantId: string, sessionId: string, message: SessionMessage): Promise<void> {
    const dir = join(this.baseDir, tenantId, "sessions");
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify(message) + "\n";
    await appendFile(this.sessionPath(tenantId, sessionId), line, "utf-8");
  }

  async getHistory(tenantId: string, sessionId: string, limit = 50): Promise<SessionMessage[]> {
    try {
      const raw = await readFile(this.sessionPath(tenantId, sessionId), "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      return lines.slice(-limit).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }
}
```

`packages/memory/src/index.ts`:
```typescript
export { MemoryManager } from "./memory-manager.js";
export { SessionStore } from "./session-store.js";
```

`packages/memory/package.json`:
```json
{
  "name": "@babji/memory",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@babji/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/memory/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 5: Run tests**

Run: `pnpm install && cd packages/memory && pnpm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add file-based Memory manager and Session store"
```

---

## Phase 5: Credits System

Track and enforce the juice economy.

---

### Task 8: Credit ledger service

**Files:**
- Create: `packages/credits/package.json`
- Create: `packages/credits/tsconfig.json`
- Create: `packages/credits/src/index.ts`
- Create: `packages/credits/src/credit-ledger.ts`
- Test: `packages/credits/src/__tests__/credit-ledger.test.ts`

**Step 1: Write failing test for CreditLedger**

`packages/credits/src/__tests__/credit-ledger.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CreditLedger } from "../credit-ledger.js";

const mockDb = () => ({
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  query: {
    creditBalances: {
      findFirst: vi.fn(),
    },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
});

describe("CreditLedger", () => {
  it("checks if tenant has enough credits", async () => {
    const db = mockDb();
    db.query.creditBalances.findFirst.mockResolvedValue({
      tenantId: "t1",
      dailyFree: 3,
      prepaid: 10,
      proMonthly: 0,
      lastDailyReset: new Date(),
    });

    const ledger = new CreditLedger(db as any);
    const result = await ledger.hasCredits("t1", 1);
    expect(result).toBe(true);
  });

  it("returns false when no credits left", async () => {
    const db = mockDb();
    db.query.creditBalances.findFirst.mockResolvedValue({
      tenantId: "t1",
      dailyFree: 0,
      prepaid: 0,
      proMonthly: 0,
      lastDailyReset: new Date(),
    });

    const ledger = new CreditLedger(db as any);
    const result = await ledger.hasCredits("t1", 1);
    expect(result).toBe(false);
  });

  it("computes total balance correctly", async () => {
    const db = mockDb();
    db.query.creditBalances.findFirst.mockResolvedValue({
      tenantId: "t1",
      dailyFree: 3,
      prepaid: 50,
      proMonthly: 200,
      lastDailyReset: new Date(),
    });

    const ledger = new CreditLedger(db as any);
    const balance = await ledger.getBalance("t1");
    expect(balance.total).toBe(253);
  });
});
```

**Step 2: Implement CreditLedger**

`packages/credits/src/credit-ledger.ts`:
```typescript
import { eq } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import type { CreditBalance } from "@babji/types";

export class CreditLedger {
  constructor(private db: Database) {}

  async getBalance(tenantId: string): Promise<CreditBalance> {
    const row = await this.db.query.creditBalances.findFirst({
      where: eq(schema.creditBalances.tenantId, tenantId),
    });

    if (!row) {
      return { tenantId, dailyFree: 0, prepaid: 0, proMonthly: 0, total: 0 };
    }

    // Check if daily credits need resetting
    const balance = await this.maybeResetDaily(row);

    return {
      tenantId,
      dailyFree: balance.dailyFree,
      prepaid: balance.prepaid,
      proMonthly: balance.proMonthly,
      total: balance.dailyFree + balance.prepaid + balance.proMonthly,
    };
  }

  async hasCredits(tenantId: string, needed: number): Promise<boolean> {
    const balance = await this.getBalance(tenantId);
    return balance.total >= needed;
  }

  async deduct(tenantId: string, amount: number, description: string): Promise<boolean> {
    const balance = await this.getBalance(tenantId);
    if (balance.total < amount) return false;

    let remaining = amount;

    // Deduct from daily free first, then prepaid, then pro
    const deductDaily = Math.min(remaining, balance.dailyFree);
    remaining -= deductDaily;

    const deductPrepaid = Math.min(remaining, balance.prepaid);
    remaining -= deductPrepaid;

    const deductPro = Math.min(remaining, balance.proMonthly);

    await this.db
      .update(schema.creditBalances)
      .set({
        dailyFree: balance.dailyFree - deductDaily,
        prepaid: balance.prepaid - deductPrepaid,
        proMonthly: balance.proMonthly - deductPro,
      })
      .where(eq(schema.creditBalances.tenantId, tenantId));

    await this.db.insert(schema.creditTransactions).values({
      tenantId,
      type: "action_debit",
      amount: -amount,
      description,
    });

    return true;
  }

  async initializeForTenant(tenantId: string): Promise<void> {
    await this.db.insert(schema.creditBalances).values({
      tenantId,
      dailyFree: 5,
      prepaid: 0,
      proMonthly: 0,
    });
  }

  async addPrepaid(tenantId: string, amount: number): Promise<void> {
    const balance = await this.getBalance(tenantId);
    await this.db
      .update(schema.creditBalances)
      .set({ prepaid: balance.prepaid + amount })
      .where(eq(schema.creditBalances.tenantId, tenantId));

    await this.db.insert(schema.creditTransactions).values({
      tenantId,
      type: "prepaid_purchase",
      amount,
      description: `Purchased ${amount} prepaid credits`,
    });
  }

  private async maybeResetDaily(row: typeof schema.creditBalances.$inferSelect) {
    const now = new Date();
    const lastReset = new Date(row.lastDailyReset);
    const isSameDay =
      now.toDateString() === lastReset.toDateString();

    if (!isSameDay) {
      await this.db
        .update(schema.creditBalances)
        .set({ dailyFree: 5, lastDailyReset: now })
        .where(eq(schema.creditBalances.tenantId, row.tenantId));
      return { ...row, dailyFree: 5, lastDailyReset: now };
    }

    return row;
  }
}
```

`packages/credits/src/index.ts`:
```typescript
export { CreditLedger } from "./credit-ledger.js";
```

`packages/credits/package.json`:
```json
{
  "name": "@babji/credits",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@babji/types": "workspace:*",
    "@babji/db": "workspace:*",
    "drizzle-orm": "^0.38.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/credits/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Run tests**

Run: `pnpm install && cd packages/credits && pnpm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Credit ledger with daily free, prepaid, and pro balance management"
```

---

## Phase 6: Credential Encryption + OAuth Portal

Secure token storage and the web-based OAuth flow.

---

### Task 9: Credential encryption module

**Files:**
- Create: `packages/crypto/package.json`
- Create: `packages/crypto/tsconfig.json`
- Create: `packages/crypto/src/index.ts`
- Create: `packages/crypto/src/token-vault.ts`
- Test: `packages/crypto/src/__tests__/token-vault.test.ts`

**Step 1: Write failing test for TokenVault**

`packages/crypto/src/__tests__/token-vault.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TokenVault } from "../token-vault.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("TokenVault", () => {
  let tempDir: string;
  const encryptionKey = "0123456789abcdef0123456789abcdef"; // 32 hex chars = 16 bytes for testing

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "babji-vault-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("encrypts and decrypts a token", async () => {
    const vault = new TokenVault(tempDir, encryptionKey);
    const tokenData = {
      accessToken: "ya29.some-google-token",
      refreshToken: "1//some-refresh-token",
      expiresAt: Date.now() + 3600000,
    };

    await vault.store("tenant-1", "gmail", tokenData);
    const retrieved = await vault.retrieve("tenant-1", "gmail");
    expect(retrieved).toEqual(tokenData);
  });

  it("returns null for non-existent token", async () => {
    const vault = new TokenVault(tempDir, encryptionKey);
    const result = await vault.retrieve("tenant-1", "nonexistent");
    expect(result).toBeNull();
  });

  it("deletes a token", async () => {
    const vault = new TokenVault(tempDir, encryptionKey);
    await vault.store("tenant-1", "gmail", { accessToken: "test" });
    await vault.delete("tenant-1", "gmail");
    const result = await vault.retrieve("tenant-1", "gmail");
    expect(result).toBeNull();
  });
});
```

**Step 2: Implement TokenVault**

`packages/crypto/src/token-vault.ts`:
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export class TokenVault {
  private key: Buffer;

  constructor(
    private baseDir: string,
    encryptionKey: string
  ) {
    // Key must be 32 bytes for AES-256
    this.key = Buffer.from(encryptionKey.padEnd(64, "0").slice(0, 64), "hex");
  }

  private filePath(tenantId: string, provider: string): string {
    return join(this.baseDir, tenantId, "credentials", `${provider}.enc`);
  }

  async store(tenantId: string, provider: string, data: unknown): Promise<void> {
    const dir = join(this.baseDir, tenantId, "credentials");
    await mkdir(dir, { recursive: true });

    const plaintext = JSON.stringify(data);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    let encrypted = cipher.update(plaintext, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: iv (16 bytes) + tag (16 bytes) + encrypted data
    const combined = Buffer.concat([iv, tag, encrypted]);
    await writeFile(this.filePath(tenantId, provider), combined);
  }

  async retrieve(tenantId: string, provider: string): Promise<unknown | null> {
    try {
      const combined = await readFile(this.filePath(tenantId, provider));
      const iv = combined.subarray(0, IV_LENGTH);
      const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return JSON.parse(decrypted.toString("utf8"));
    } catch {
      return null;
    }
  }

  async delete(tenantId: string, provider: string): Promise<void> {
    try {
      await unlink(this.filePath(tenantId, provider));
    } catch {
      // Ignore if file doesn't exist
    }
  }
}
```

`packages/crypto/src/index.ts`:
```typescript
export { TokenVault } from "./token-vault.js";
```

`packages/crypto/package.json`:
```json
{
  "name": "@babji/crypto",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@babji/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/crypto/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Run tests**

Run: `pnpm install && cd packages/crypto && pnpm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add AES-256-GCM credential encryption with TokenVault"
```

---

### Task 10: OAuth portal (Next.js app)

**Files:**
- Create: `apps/oauth-portal/package.json`
- Create: `apps/oauth-portal/next.config.js`
- Create: `apps/oauth-portal/tsconfig.json`
- Create: `apps/oauth-portal/src/app/layout.tsx`
- Create: `apps/oauth-portal/src/app/page.tsx`
- Create: `apps/oauth-portal/src/app/connect/[provider]/page.tsx`
- Create: `apps/oauth-portal/src/app/api/callback/[provider]/route.ts`
- Create: `apps/oauth-portal/src/lib/providers.ts`

This task creates the OAuth portal at auth.babji.ai. Detailed implementation for each provider's OAuth flow (Google, Meta, LinkedIn, X) will be done when implementing those specific skills in Phase 8. This task sets up the routing and framework.

**Step 1: Scaffold the Next.js app with provider routing**

See files above. Implementation should:
- `GET /connect/[provider]?t={token}` — validates the connection token, shows consent page
- `GET /api/callback/[provider]` — handles OAuth callback, encrypts tokens, stores them
- `providers.ts` — maps provider names to OAuth config (client_id, scopes, auth URL, token URL)
- After success: render "Connected! Close this tab." and notify Gateway to message user

**Step 2: Install Next.js and build**

Run: `cd apps/oauth-portal && pnpm install && pnpm build`
Expected: Compiles

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: scaffold OAuth portal with provider-based routing"
```

---

## Phase 7: Heartbeat System

Proactive checks on a schedule.

---

### Task 11: Heartbeat scheduler

**Files:**
- Create: `packages/heartbeat/package.json`
- Create: `packages/heartbeat/tsconfig.json`
- Create: `packages/heartbeat/src/index.ts`
- Create: `packages/heartbeat/src/heartbeat-scheduler.ts`
- Test: `packages/heartbeat/src/__tests__/heartbeat-scheduler.test.ts`

**Step 1: Write failing test for HeartbeatScheduler**

`packages/heartbeat/src/__tests__/heartbeat-scheduler.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { HeartbeatScheduler } from "../heartbeat-scheduler.js";

describe("HeartbeatScheduler", () => {
  it("skips heartbeat outside active hours", async () => {
    const mockBrain = { process: vi.fn() };
    const mockMemory = {
      readHeartbeat: vi.fn().mockResolvedValue("Check emails"),
      readSoul: vi.fn().mockResolvedValue("You are Babji"),
      readMemory: vi.fn().mockResolvedValue(""),
    };

    const scheduler = new HeartbeatScheduler(mockBrain as any, mockMemory as any);

    const result = await scheduler.runHeartbeat({
      tenantId: "t1",
      intervalMinutes: 30,
      activeHoursStart: 9,
      activeHoursEnd: 17,
      timezone: "UTC",
      instructions: "Check emails",
    }, 3); // 3 AM - outside active hours

    expect(result).toBe("skipped");
    expect(mockBrain.process).not.toHaveBeenCalled();
  });

  it("runs heartbeat during active hours", async () => {
    const mockBrain = {
      process: vi.fn().mockResolvedValue({
        content: "HEARTBEAT_OK",
        toolCallsMade: [],
      }),
    };
    const mockMemory = {
      readHeartbeat: vi.fn().mockResolvedValue("Check emails"),
      readSoul: vi.fn().mockResolvedValue("You are Babji"),
      readMemory: vi.fn().mockResolvedValue(""),
    };

    const scheduler = new HeartbeatScheduler(mockBrain as any, mockMemory as any);

    const result = await scheduler.runHeartbeat({
      tenantId: "t1",
      intervalMinutes: 30,
      activeHoursStart: 9,
      activeHoursEnd: 17,
      timezone: "UTC",
      instructions: "Check emails",
    }, 12); // Noon - inside active hours

    expect(result).toBe("ok");
    expect(mockBrain.process).toHaveBeenCalled();
  });
});
```

**Step 2: Implement HeartbeatScheduler**

`packages/heartbeat/src/heartbeat-scheduler.ts`:
```typescript
import type { HeartbeatConfig, HeartbeatResult } from "@babji/types";
import type { Brain } from "@babji/agent";
import type { MemoryManager } from "@babji/memory";

export class HeartbeatScheduler {
  constructor(
    private brain: Brain,
    private memory: MemoryManager
  ) {}

  async runHeartbeat(
    config: HeartbeatConfig,
    currentHour?: number
  ): Promise<HeartbeatResult | "skipped"> {
    const hour = currentHour ?? new Date().getHours(); // Allow injection for testing

    if (hour < config.activeHoursStart || hour >= config.activeHoursEnd) {
      return "skipped";
    }

    const soul = await this.memory.readSoul(config.tenantId);
    const memoryContent = await this.memory.readMemory(config.tenantId);

    const systemPrompt = [
      soul,
      "\n## Heartbeat Check",
      "You are running a scheduled check. Review the instructions below and your connected services.",
      "If nothing needs the user's attention, respond with exactly: HEARTBEAT_OK",
      "If something needs attention, write a brief, friendly message to the user.",
      "\n## Instructions",
      config.instructions,
      "\n## Memory",
      memoryContent,
    ].join("\n");

    const result = await this.brain.process({
      systemPrompt,
      messages: [
        { role: "user", content: "[HEARTBEAT CHECK - automated, not a user message]" },
      ],
      maxTurns: 3,
    });

    if (result.content.includes("HEARTBEAT_OK")) {
      return "ok";
    }

    return "notification_sent";
  }
}
```

`packages/heartbeat/src/index.ts`:
```typescript
export { HeartbeatScheduler } from "./heartbeat-scheduler.js";
```

`packages/heartbeat/package.json`:
```json
{
  "name": "@babji/heartbeat",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@babji/types": "workspace:*",
    "@babji/agent": "workspace:*",
    "@babji/memory": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/heartbeat/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Run tests**

Run: `pnpm install && cd packages/heartbeat && pnpm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Heartbeat scheduler with active hours and HEARTBEAT_OK suppression"
```

---

## Phase 8: First Skill -- Gmail

Wire up a real integration end-to-end. This proves the entire pipeline works.

---

### Task 12: Gmail skill implementation

**Files:**
- Create: `packages/skills/package.json`
- Create: `packages/skills/tsconfig.json`
- Create: `packages/skills/src/index.ts`
- Create: `packages/skills/src/gmail/index.ts`
- Create: `packages/skills/src/gmail/definition.yaml`
- Create: `packages/skills/src/gmail/handler.ts`
- Test: `packages/skills/src/__tests__/gmail.test.ts`

**Step 1: Write the skill definition YAML**

`packages/skills/src/gmail/definition.yaml`:
```yaml
name: gmail
display_name: Gmail Management
description: Read, send, organize, and manage emails
requires_auth:
  provider: google
  scopes:
    - https://www.googleapis.com/auth/gmail.readonly
    - https://www.googleapis.com/auth/gmail.modify
    - https://www.googleapis.com/auth/gmail.labels
actions:
  - name: list_emails
    description: List recent emails with optional search query
    parameters:
      query:
        type: string
        description: Gmail search query (e.g., "is:unread", "from:boss@company.com")
      max_results:
        type: number
        default: 10
  - name: read_email
    description: Read the full content of a specific email
    parameters:
      message_id:
        type: string
        required: true
  - name: send_email
    description: Send an email
    parameters:
      to:
        type: string
        required: true
      subject:
        type: string
        required: true
      body:
        type: string
        required: true
  - name: block_sender
    description: Create a filter to block emails from a sender
    parameters:
      email:
        type: string
        required: true
  - name: unsubscribe
    description: Unsubscribe from a mailing list
    parameters:
      message_id:
        type: string
        required: true
credits_per_action: 1
```

**Step 2: Implement Gmail handler using Google APIs**

`packages/skills/src/gmail/handler.ts`:
```typescript
import { google } from "googleapis";
import type { SkillHandler } from "@babji/agent";

export class GmailHandler implements SkillHandler {
  private gmail;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.gmail = google.gmail({ version: "v1", auth });
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "list_emails":
        return this.listEmails(params.query as string, params.max_results as number);
      case "read_email":
        return this.readEmail(params.message_id as string);
      case "send_email":
        return this.sendEmail(
          params.to as string,
          params.subject as string,
          params.body as string
        );
      case "block_sender":
        return this.blockSender(params.email as string);
      default:
        throw new Error(`Unknown Gmail action: ${actionName}`);
    }
  }

  private async listEmails(query?: string, maxResults = 10) {
    const res = await this.gmail.users.messages.list({
      userId: "me",
      q: query || "",
      maxResults,
    });

    const messages = res.data.messages || [];
    const summaries = await Promise.all(
      messages.slice(0, maxResults).map(async (msg) => {
        const detail = await this.gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        const headers = detail.data.payload?.headers || [];
        return {
          id: msg.id,
          from: headers.find((h) => h.name === "From")?.value,
          subject: headers.find((h) => h.name === "Subject")?.value,
          date: headers.find((h) => h.name === "Date")?.value,
          snippet: detail.data.snippet,
        };
      })
    );

    return { emails: summaries, total: res.data.resultSizeEstimate };
  }

  private async readEmail(messageId: string) {
    const res = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const headers = res.data.payload?.headers || [];
    const body = this.extractBody(res.data.payload);

    return {
      id: messageId,
      from: headers.find((h) => h.name === "From")?.value,
      to: headers.find((h) => h.name === "To")?.value,
      subject: headers.find((h) => h.name === "Subject")?.value,
      date: headers.find((h) => h.name === "Date")?.value,
      body,
    };
  }

  private async sendEmail(to: string, subject: string, body: string) {
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString("base64url");

    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    return { sent: true, messageId: res.data.id };
  }

  private async blockSender(email: string) {
    await this.gmail.users.settings.filters.create({
      userId: "me",
      requestBody: {
        criteria: { from: email },
        action: { removeLabelIds: ["INBOX"], addLabelIds: ["TRASH"] },
      },
    });

    return { blocked: true, email };
  }

  private extractBody(payload: any): string {
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, "base64").toString("utf-8");
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          return Buffer.from(part.body.data, "base64").toString("utf-8");
        }
      }
      for (const part of payload.parts) {
        const nested = this.extractBody(part);
        if (nested) return nested;
      }
    }
    return "";
  }
}
```

`packages/skills/src/gmail/index.ts`:
```typescript
export { GmailHandler } from "./handler.js";
```

`packages/skills/src/index.ts`:
```typescript
export { GmailHandler } from "./gmail/index.js";
```

`packages/skills/package.json`:
```json
{
  "name": "@babji/skills",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@babji/types": "workspace:*",
    "@babji/agent": "workspace:*",
    "googleapis": "^144.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/skills/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Install, build, verify**

Run: `pnpm install && cd packages/skills && pnpm build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Gmail skill with list, read, send, and block actions"
```

---

## Phase 9: End-to-End Integration

Wire all components together so a WhatsApp message goes through the full pipeline.

---

### Task 13: Wire Gateway to Agent to Skills (integration)

**Files:**
- Modify: `packages/gateway/src/server.ts`
- Modify: `packages/gateway/src/index.ts`
- Create: `packages/gateway/src/message-handler.ts`

This task connects:
1. Gateway receives WhatsApp message
2. Resolves tenant
3. Checks credits
4. Loads memory + skills
5. Runs Brain (ReAct loop)
6. Sends response back via WhatsApp

`packages/gateway/src/message-handler.ts`:
```typescript
import type { BabjiMessage, OutboundMessage } from "@babji/types";
import { Brain } from "@babji/agent";
import { PromptBuilder } from "@babji/agent";
import { MemoryManager, SessionStore } from "@babji/memory";
import { CreditLedger } from "@babji/credits";
import { TokenVault } from "@babji/crypto";
import type { SkillDefinition } from "@babji/types";
import type { LlmClient, IToolExecutor } from "@babji/agent";
import { ToolExecutor } from "@babji/agent";
import type { Database } from "@babji/db";

interface MessageHandlerDeps {
  db: Database;
  memory: MemoryManager;
  sessions: SessionStore;
  credits: CreditLedger;
  vault: TokenVault;
  llm: LlmClient;
  availableSkills: SkillDefinition[];
}

export class MessageHandler {
  private brain: Brain;

  constructor(private deps: MessageHandlerDeps) {
    const toolExecutor = new ToolExecutor();
    this.brain = new Brain(deps.llm, toolExecutor);
  }

  async handle(message: BabjiMessage): Promise<OutboundMessage> {
    const { tenantId, channel, sender, text } = message;

    // Store incoming message in session
    const sessionId = `${channel}-${sender}`;
    await this.deps.sessions.append(tenantId, sessionId, {
      role: "user",
      content: text,
      timestamp: new Date(),
    });

    // Load context
    const soul = await this.deps.memory.readSoul(tenantId);
    const memoryContent = await this.deps.memory.readMemory(tenantId);
    const history = await this.deps.sessions.getHistory(tenantId, sessionId, 20);

    // Build prompt
    const systemPrompt = PromptBuilder.build({
      soul,
      memory: memoryContent,
      skills: this.deps.availableSkills,
      connections: [], // TODO: load from DB
    });

    // Run brain
    const result = await this.brain.process({
      systemPrompt,
      messages: history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      maxTurns: 10,
    });

    // Deduct credits if actions were taken
    if (result.toolCallsMade.length > 0) {
      await this.deps.credits.deduct(
        tenantId,
        1,
        `Action: ${result.toolCallsMade.map((t) => t.actionName).join(", ")}`
      );
    }

    // Store response in session
    await this.deps.sessions.append(tenantId, sessionId, {
      role: "assistant",
      content: result.content,
      timestamp: new Date(),
    });

    return {
      tenantId,
      channel,
      recipient: sender,
      text: result.content,
    };
  }
}
```

**Step 1: Implement the handler**

Write the file above.

**Step 2: Update Gateway index.ts to wire everything together**

Update `packages/gateway/src/index.ts` to:
- Initialize DB, Redis, Memory, Sessions, Credits, Vault, LLM
- Create MessageHandler
- Create WhatsApp + Telegram adapters
- Wire adapter.onMessage → MessageHandler.handle → adapter.sendMessage

**Step 3: Test end-to-end manually**

Run: `docker compose -f docker-compose.dev.yml up -d` (ensure Postgres + Redis running)
Run: `cd packages/gateway && ANTHROPIC_API_KEY=... pnpm dev`
Expected: Gateway starts, WhatsApp QR code appears in terminal. Scan with phone. Send "Hi" → Babji responds.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire end-to-end message pipeline (Gateway → Brain → Response)"
```

---

## Phase 10: Billing Integration (Stripe)

---

### Task 14: Stripe integration for payments

**Files:**
- Create: `packages/billing/package.json`
- Create: `packages/billing/tsconfig.json`
- Create: `packages/billing/src/index.ts`
- Create: `packages/billing/src/stripe-service.ts`
- Create: `packages/billing/src/webhook-handler.ts`

This task integrates Stripe for:
- Creating payment links for prepaid packs
- Managing Pro subscriptions
- Webhook handler for payment confirmation → credit grant

**Step 1: Implement Stripe service**

`packages/billing/src/stripe-service.ts`:
```typescript
import Stripe from "stripe";
import { CreditLedger } from "@babji/credits";

export class StripeService {
  private stripe: Stripe;

  constructor(
    secretKey: string,
    private credits: CreditLedger
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createPrepaidLink(tenantId: string, amount: 100 | 200): Promise<string> {
    const priceMap = {
      100: process.env.STRIPE_PRICE_PREPAID_100!,
      200: process.env.STRIPE_PRICE_PREPAID_200!,
    };

    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceMap[amount], quantity: 1 }],
      metadata: { tenantId, creditAmount: String(amount) },
      success_url: `${process.env.APP_URL}/payment/success`,
    });

    return session.url!;
  }

  async createProSubscriptionLink(tenantId: string): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_PRO_MONTHLY!, quantity: 1 }],
      metadata: { tenantId },
      success_url: `${process.env.APP_URL}/payment/success`,
    });

    return session.url!;
  }

  async handleWebhook(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenantId;
        const creditAmount = session.metadata?.creditAmount;

        if (tenantId && creditAmount) {
          await this.credits.addPrepaid(tenantId, Number(creditAmount));
        }
        break;
      }
      case "invoice.paid": {
        // Pro subscription renewal
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = (invoice as any).subscription_details?.metadata?.tenantId;
        if (tenantId) {
          await this.credits.addPrepaid(tenantId, 500); // Pro monthly grant
        }
        break;
      }
    }
  }
}
```

**Step 2: Build and commit**

```bash
git add -A
git commit -m "feat: add Stripe billing integration for prepaid and Pro subscription"
```

---

## Phase 11: Admin Dashboard

---

### Task 15: Admin dashboard scaffold (Next.js)

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/next.config.js`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/src/app/layout.tsx`
- Create: `apps/admin/src/app/page.tsx` (tenant overview)
- Create: `apps/admin/src/app/skill-requests/page.tsx`
- Create: `apps/admin/src/app/analytics/page.tsx`

This task scaffolds the admin dashboard ("The Teacher's Desk") with:
- Tenant list with status, plan, credits, last active
- Skill request queue with approve/reject actions
- Basic analytics (active tenants, credit usage)

**Step 1: Scaffold with Next.js + Tailwind + DB connection**

**Step 2: Implement tenant list page**

**Step 3: Implement skill request queue**

**Step 4: Build and commit**

```bash
git add -A
git commit -m "feat: scaffold Admin Dashboard with tenant overview and skill request queue"
```

---

## Phase 12: Tenant Onboarding Flow

---

### Task 16: New user onboarding via chat

**Files:**
- Create: `packages/gateway/src/onboarding.ts`
- Modify: `packages/gateway/src/message-handler.ts`

When an unknown phone number messages Babji:
1. Detect "onboarding:" prefix in tenantId
2. Run conversational onboarding (collect name, timezone)
3. Create tenant in DB
4. Initialize memory
5. Initialize credits (5 free daily)
6. Switch to normal message handling

**Step 1: Implement onboarding flow**

**Step 2: Test by sending message from unknown number**

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add conversational onboarding for new WhatsApp/Telegram users"
```

---

## Phase 13: Dockerization + Container Orchestration

---

### Task 17: Dockerize all services

**Files:**
- Create: `Dockerfile.gateway`
- Create: `Dockerfile.agent`
- Create: `Dockerfile.oauth-portal`
- Create: `Dockerfile.admin`
- Create: `docker-compose.yml` (production-like)

**Step 1: Write Dockerfiles for each service**

**Step 2: Write docker-compose.yml that runs the full stack**

```yaml
version: "3.8"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: babji
      POSTGRES_USER: babji
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine

  gateway:
    build:
      context: .
      dockerfile: Dockerfile.gateway
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://babji:${POSTGRES_PASSWORD}@postgres:5432/babji
      REDIS_URL: redis://redis:6379
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    depends_on:
      - postgres
      - redis

  oauth-portal:
    build:
      context: .
      dockerfile: Dockerfile.oauth-portal
    ports:
      - "3001:3000"
    environment:
      DATABASE_URL: postgres://babji:${POSTGRES_PASSWORD}@postgres:5432/babji

  admin:
    build:
      context: .
      dockerfile: Dockerfile.admin
    ports:
      - "3002:3000"
    environment:
      DATABASE_URL: postgres://babji:${POSTGRES_PASSWORD}@postgres:5432/babji

volumes:
  pgdata:
```

**Step 3: Build and test**

Run: `docker compose build && docker compose up`
Expected: All services start and are reachable

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: Dockerize all services with production-ready compose file"
```

---

## Phase 14: Remaining Skills (Calendar, Contacts, Ads, Social)

---

### Task 18: Google Calendar skill

Implement following the same pattern as Gmail (Task 12):
- `packages/skills/src/google-calendar/definition.yaml`
- `packages/skills/src/google-calendar/handler.ts`
- Actions: list_events, create_event, update_event, find_free_slots

### Task 19: Google Contacts skill

- `packages/skills/src/google-contacts/definition.yaml`
- `packages/skills/src/google-contacts/handler.ts`
- Actions: search_contacts, create_contact, update_contact

### Task 20: Google Ads skill

- `packages/skills/src/google-ads/definition.yaml`
- `packages/skills/src/google-ads/handler.ts`
- Actions: list_campaigns, get_campaign_report, update_budget

### Task 21: Meta Ads skill (Facebook/Instagram Ads)

- `packages/skills/src/meta-ads/definition.yaml`
- `packages/skills/src/meta-ads/handler.ts`

### Task 22: Social media skills (Instagram, Facebook Pages, LinkedIn, X)

- Each gets their own directory under `packages/skills/src/`
- Each follows the same SkillHandler interface pattern
- OAuth scopes configured per provider in the OAuth portal

Each skill commit follows the pattern:
```bash
git commit -m "feat: add [Skill Name] skill with [actions]"
```

---

## Phase 15: Skill Request System ("Check with my teacher")

---

### Task 23: Skill request flow

**Files:**
- Create: `packages/skills/src/skill-request-manager.ts`
- Modify: `packages/agent/src/brain.ts` (detect unknown skill requests)
- Modify: `apps/admin/src/app/skill-requests/page.tsx` (review UI)

When Brain detects it can't handle a request:
1. Babji asks user for permission to raise a request
2. Creates entry in `skill_requests` table
3. Admin dashboard shows the queue
4. When operator marks complete → Babji notifies tenant
5. Optional broadcast to other tenants who might benefit

**Commit:**
```bash
git commit -m "feat: add skill request flow with admin review queue and tenant notifications"
```

---

## Phase 16: Polish + Production Readiness

---

### Task 24: Error handling, rate limiting, and logging

- Add structured logging (pino) across all services
- Add rate limiting per tenant via Redis
- Add error boundaries in Brain (catch LLM failures, retry)
- Add health check endpoints for all services

### Task 25: Environment configuration and secrets management

- Create `.env.example` with all required variables
- Document setup process in README
- Add validation for required env vars at startup

### Task 26: End-to-end tests

- Create integration test that:
  1. Sends a mock WhatsApp message
  2. Verifies tenant creation
  3. Verifies Brain processes it
  4. Verifies response is sent back
  5. Verifies credit deduction

---

## Summary

| Phase | Tasks | What ships |
|---|---|---|
| 1. Foundation | 1-2 | Monorepo, types, database |
| 2. Gateway | 3-5 | Message ingestion from WhatsApp + Telegram |
| 3. Brain | 6 | ReAct loop, multi-model LLM |
| 4. Memory | 7 | Per-tenant file-based memory |
| 5. Credits | 8 | Juice economy tracking |
| 6. Crypto + OAuth | 9-10 | Secure tokens, OAuth portal |
| 7. Heartbeat | 11 | Proactive scheduled checks |
| 8. Gmail Skill | 12 | First real integration |
| 9. Integration | 13 | Full pipeline working end-to-end |
| 10. Billing | 14 | Stripe payments |
| 11. Admin | 15 | Operator dashboard |
| 12. Onboarding | 16 | New user flow |
| 13. Docker | 17 | Production deployment |
| 14. More Skills | 18-22 | Calendar, Contacts, Ads, Social |
| 15. Skill Requests | 23 | "Check with my teacher" flow |
| 16. Polish | 24-26 | Error handling, tests, docs |
