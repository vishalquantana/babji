import { NextRequest, NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { eq, desc } from "drizzle-orm";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tenantId } = await params;
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    const tenant = await db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const [
      connections,
      skillRequests,
      jobs,
      audit,
      todos,
      creditBalance,
      creditTransactions,
    ] = await Promise.all([
      db
        .select()
        .from(schema.serviceConnections)
        .where(eq(schema.serviceConnections.tenantId, tenantId))
        .orderBy(desc(schema.serviceConnections.createdAt)),
      db
        .select()
        .from(schema.skillRequests)
        .where(eq(schema.skillRequests.tenantId, tenantId))
        .orderBy(desc(schema.skillRequests.createdAt)),
      db
        .select()
        .from(schema.scheduledJobs)
        .where(eq(schema.scheduledJobs.tenantId, tenantId))
        .orderBy(desc(schema.scheduledJobs.createdAt)),
      db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.tenantId, tenantId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(100),
      db
        .select()
        .from(schema.todos)
        .where(eq(schema.todos.tenantId, tenantId))
        .orderBy(desc(schema.todos.createdAt)),
      db.query.creditBalances.findFirst({
        where: eq(schema.creditBalances.tenantId, tenantId),
      }),
      db
        .select()
        .from(schema.creditTransactions)
        .where(eq(schema.creditTransactions.tenantId, tenantId))
        .orderBy(desc(schema.creditTransactions.createdAt))
        .limit(50),
    ]);

    return NextResponse.json({
      tenant,
      connections,
      skillRequests,
      jobs,
      audit,
      todos,
      creditBalance: creditBalance || null,
      creditTransactions,
    });
  } finally {
    await close();
  }
}
