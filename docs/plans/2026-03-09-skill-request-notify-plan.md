# Skill Request "Complete & Notify" Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When an admin marks a skill request as completed, proactively notify the user via Telegram. Also inject a fallback reminder into the next conversation if the user missed the notification.

**Architecture:** Admin dashboard gets a "Complete & Notify" button per skill request. Clicking it calls an OAuth portal API route, which updates the DB status and POSTs to the gateway's new `/api/notify-skill-ready` endpoint. The gateway sends a Brain-crafted conversational message to the user via Telegram. As a fallback, PromptBuilder checks for completed-but-unnotified requests and injects them into the system prompt.

**Tech Stack:** Next.js API routes (OAuth portal), Fastify (gateway), Drizzle ORM, Telegram (grammy)

---

### Task 1: Add `notifiedAt` column to `skill_requests` table

We need to track whether the user has been notified about a completed skill request. This distinguishes "completed and notified" from "completed but notification pending."

**Files:**
- Modify: `packages/db/src/schema.ts:88-105`

**Step 1: Add the column**

In `packages/db/src/schema.ts`, add `notifiedAt` to the `skillRequests` table definition, after `resolvedAt`:

```typescript
notifiedAt: timestamp("notified_at"),
```

**Step 2: Run a migration on the production database**

Since there's no formal migration runner, run the ALTER TABLE directly:

```bash
ssh root@65.20.76.199 'docker exec -i babji-postgres psql -U babji -d babji -c "ALTER TABLE skill_requests ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP;"'
```

Expected: `ALTER TABLE`

**Step 3: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add notifiedAt column to skill_requests for notification tracking"
```

---

### Task 2: Add gateway endpoint `POST /api/notify-skill-ready`

This endpoint receives a skill request ID, looks up the tenant and skill, runs the notification through Brain for a conversational message, and sends it via Telegram.

**Files:**
- Modify: `packages/gateway/src/server.ts`

**Step 1: Add the endpoint**

In `packages/gateway/src/server.ts`, after the existing `/api/connect-complete` endpoint (after line 150), add:

```typescript
// Called by the admin dashboard when a skill request is completed
app.post("/api/notify-skill-ready", async (request, reply) => {
  const { skillRequestId } = request.body as { skillRequestId: string };

  if (!skillRequestId) {
    return reply.status(400).send({ error: "Missing skillRequestId" });
  }
  if (!db || !handler || !adapters) {
    return reply.status(503).send({ error: "Gateway not ready" });
  }

  // Look up the skill request
  const skillRequest = await db.query.skillRequests.findFirst({
    where: eq(schema.skillRequests.id, skillRequestId),
  });
  if (!skillRequest) {
    return reply.status(404).send({ error: "Skill request not found" });
  }

  // Look up the tenant to get their Telegram ID
  const tenant = await db.query.tenants.findFirst({
    where: eq(schema.tenants.id, skillRequest.tenantId),
  });
  if (!tenant || !tenant.telegramUserId) {
    return reply.status(400).send({ error: "Tenant has no Telegram ID" });
  }

  // Find the Telegram adapter
  const adapter = adapters.find((a) => a.name === "telegram");
  if (!adapter) {
    return reply.status(503).send({ error: "Telegram adapter not available" });
  }

  // Fire and forget — send notification through Brain
  setImmediate(async () => {
    try {
      const syntheticMessage = {
        id: randomUUID(),
        tenantId: skillRequest.tenantId,
        channel: "telegram" as const,
        sender: tenant.telegramUserId!,
        text: `[SYSTEM] A skill the user previously requested is now ready. Skill: "${skillRequest.skillName}". Their original request was: "${skillRequest.context}". Let them know this capability is now available, remind them what they asked for, and offer to help them try it out. Be brief and conversational.`,
        timestamp: new Date(),
      };

      const response = await handler.handle(syntheticMessage);
      await adapter.sendMessage(response);

      // Mark as notified
      await db.update(schema.skillRequests)
        .set({ notifiedAt: new Date() })
        .where(eq(schema.skillRequests.id, skillRequestId));

      logger.info({ skillRequestId, tenantId: skillRequest.tenantId }, "Skill-ready notification sent");
    } catch (err) {
      logger.error({ err, skillRequestId }, "Skill-ready notification failed");
    }
  });

  return { ok: true };
});
```

Note: The `eq` and `schema` imports already exist at the top of `server.ts`. `randomUUID` is also already imported.

**Step 2: Commit**

```bash
git add packages/gateway/src/server.ts
git commit -m "feat(gateway): add /api/notify-skill-ready endpoint for proactive skill notifications"
```

---

### Task 3: Add admin API route to complete & notify a skill request

The OAuth portal needs a POST endpoint that the dashboard button calls. It updates the skill request status to "completed" and calls the gateway's notify endpoint.

**Files:**
- Create: `apps/oauth-portal/src/app/api/admin/skill-requests/[requestId]/complete/route.ts`

**Step 1: Create the API route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { eq } from "drizzle-orm";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { requestId } = await params;
  const databaseUrl = process.env.DATABASE_URL || "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    // Update status to completed
    const [updated] = await db
      .update(schema.skillRequests)
      .set({ status: "completed", resolvedAt: new Date() })
      .where(eq(schema.skillRequests.id, requestId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Skill request not found" }, { status: 404 });
    }

    // Notify the user via gateway
    const gatewayUrl = process.env.GATEWAY_URL || "http://127.0.0.1:3000";
    try {
      await fetch(`${gatewayUrl}/api/notify-skill-ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillRequestId: requestId }),
      });
    } catch (err) {
      // Gateway notification is best-effort — don't fail the status update
      console.error("Failed to notify gateway:", err);
    }

    return NextResponse.json({ ok: true, status: updated.status });
  } finally {
    await close();
  }
}
```

**Step 2: Commit**

```bash
git add apps/oauth-portal/src/app/api/admin/skill-requests/
git commit -m "feat(oauth-portal): add admin API route to complete skill request and trigger notification"
```

---

### Task 4: Add "Complete & Notify" button to admin dashboard

Add a clickable button on each pending/in_progress skill request row in the admin dashboard.

**Files:**
- Modify: `apps/oauth-portal/src/app/admin/dashboard/client.tsx:191-230`

**Step 1: Add state for loading/completed status**

Add state tracking inside `DashboardClient`:

```typescript
const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
```

**Step 2: Add the handler function**

```typescript
async function handleCompleteSkillRequest(requestId: string) {
  setCompletingIds((prev) => new Set(prev).add(requestId));
  try {
    const res = await fetch(`/api/admin/skill-requests/${requestId}/complete`, { method: "POST" });
    if (!res.ok) throw new Error("Failed");
    // Update local state to reflect completion
    setData((prev) => prev ? {
      ...prev,
      skillRequests: prev.skillRequests.map((sr) =>
        sr.id === requestId ? { ...sr, status: "completed" } : sr
      ),
    } : prev);
  } catch {
    alert("Failed to complete skill request");
  } finally {
    setCompletingIds((prev) => {
      const next = new Set(prev);
      next.delete(requestId);
      return next;
    });
  }
}
```

**Step 3: Add an "Actions" column header and button**

In the skill requests table header, add after the "Requested" `<th>`:

```html
<th>Actions</th>
```

In each row, add after the `timeAgo` `<td>`:

```typescript
<td>
  {(sr.status === "pending" || sr.status === "in_progress") && (
    <button
      onClick={() => handleCompleteSkillRequest(sr.id)}
      disabled={completingIds.has(sr.id)}
      style={{
        padding: "4px 12px",
        borderRadius: 6,
        border: "none",
        backgroundColor: completingIds.has(sr.id) ? "#9ca3af" : "#10b981",
        color: "white",
        fontSize: 12,
        fontWeight: 600,
        cursor: completingIds.has(sr.id) ? "default" : "pointer",
      }}
    >
      {completingIds.has(sr.id) ? "Sending..." : "Complete & Notify"}
    </button>
  )}
</td>
```

**Step 4: Commit**

```bash
git add apps/oauth-portal/src/app/admin/dashboard/client.tsx
git commit -m "feat(oauth-portal): add Complete & Notify button to admin skill requests table"
```

---

### Task 5: Add next-conversation fallback in PromptBuilder

If the user missed the proactive notification (or it failed), inject a reminder into their next conversation's system prompt.

**Files:**
- Modify: `packages/agent/src/prompt-builder.ts:3-10,13-99`

**Step 1: Add `completedSkillRequests` to PromptContext**

```typescript
interface PromptContext {
  soul: string;
  memory: string;
  skills: SkillDefinition[];
  connections: string[];
  userName?: string;
  timezone?: string;
  completedSkillRequests?: Array<{ skillName: string; context: string }>;
}
```

**Step 2: Add the section in `build()`**

After the disconnected skills section (after line 76, before the task management rules):

```typescript
if (ctx.completedSkillRequests && ctx.completedSkillRequests.length > 0) {
  parts.push("");
  parts.push("## Recently fulfilled skill requests");
  parts.push("The following capabilities were recently added based on this client's requests. Mention this naturally at the start of the conversation -- let them know the feature is ready and offer to help them try it:");
  for (const req of ctx.completedSkillRequests) {
    parts.push(`- "${req.skillName}": They originally asked for: ${req.context}`);
  }
}
```

**Step 3: Wire it up in message-handler.ts**

In `packages/gateway/src/message-handler.ts`, where the system prompt is built (around line 425-432), query for completed-but-unnotified skill requests and pass them to `PromptBuilder.build()`:

```typescript
// Check for completed skill requests that haven't been notified
const completedRequests = await this.deps.db.select()
  .from(schema.skillRequests)
  .where(
    and(
      eq(schema.skillRequests.tenantId, tenantId),
      eq(schema.skillRequests.status, "completed"),
      isNull(schema.skillRequests.notifiedAt),
    )
  );

const completedSkillRequests = completedRequests.map((r) => ({
  skillName: r.skillName,
  context: r.context,
}));
```

Pass `completedSkillRequests` into the `PromptBuilder.build()` call. After the Brain responds, mark them as notified:

```typescript
// After Brain response, mark completed requests as notified
if (completedRequests.length > 0) {
  for (const req of completedRequests) {
    await this.deps.db.update(schema.skillRequests)
      .set({ notifiedAt: new Date() })
      .where(eq(schema.skillRequests.id, req.id));
  }
}
```

Import `isNull` from `drizzle-orm` at the top of the file.

**Step 4: Commit**

```bash
git add packages/agent/src/prompt-builder.ts packages/gateway/src/message-handler.ts
git commit -m "feat(agent): add next-conversation fallback for completed skill request notifications"
```

---

### Task 6: Build, deploy, and test

**Step 1: Build all packages**

```bash
pnpm --filter @babji/agent build && pnpm --filter @babji/gateway build
```

**Step 2: Build OAuth portal**

```bash
ssh root@65.20.76.199 'cd /opt/babji && pnpm --filter oauth-portal build'
```

(After rsync)

**Step 3: Run the migration**

```bash
ssh root@65.20.76.199 'docker exec -i babji-postgres psql -U babji -d babji -c "ALTER TABLE skill_requests ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP;"'
```

**Step 4: Rsync and restart**

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

ssh root@65.20.76.199 'cd /opt/babji && pnpm install'

# Restart gateway
ssh root@65.20.76.199 'fuser -k 3000/tcp 2>/dev/null; sleep 1; nohup /opt/babji/start-gateway.sh > /var/log/babji-gateway.log 2>&1 &'

# Rebuild + restart OAuth portal
ssh root@65.20.76.199 'cd /opt/babji && pnpm --filter oauth-portal build && kill $(pgrep -f "next-server") 2>/dev/null; sleep 1; nohup /opt/babji/start-oauth-portal.sh > /var/log/babji-oauth.log 2>&1 &'
```

**Step 5: Verify gateway**

```bash
ssh root@65.20.76.199 'sleep 2 && tail -10 /var/log/babji-gateway.log'
```

**Step 6: Test the flow**

1. Open admin dashboard at `babji.quantana.top/admin`
2. Find a pending skill request (or create one by messaging Babji with an unsupported request)
3. Click "Complete & Notify"
4. Verify the user receives a Telegram message about the new capability

**Step 7: Update CHANGELOG.md**

Add entry for the skill request notification feature.

**Step 8: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add changelog entry for skill request notification feature"
```
