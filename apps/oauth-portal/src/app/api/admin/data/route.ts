import { NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { desc, sql } from "drizzle-orm";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [tenants, connections, skillRequests, recentAudit, profiles, usageRows, appConfig] = await Promise.all([
      db.select().from(schema.tenants).orderBy(desc(schema.tenants.lastActiveAt)),
      db.select().from(schema.serviceConnections).orderBy(desc(schema.serviceConnections.createdAt)),
      db.select().from(schema.skillRequests).orderBy(desc(schema.skillRequests.createdAt)),
      db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.createdAt)).limit(50),
      db.select().from(schema.profileDirectory).orderBy(desc(schema.profileDirectory.createdAt)),
      db.execute(sql`
        SELECT
          t.name AS tenant_name,
          t.id AS tenant_id,
          COUNT(*) FILTER (WHERE a.action = 'message_processed') AS messages,
          COALESCE(SUM((a.metadata->>'totalTokens')::int) FILTER (WHERE a.action IN ('message_processed', 'background_job')), 0) AS total_tokens,
          COALESCE(SUM((a.metadata->>'inputTokens')::int) FILTER (WHERE a.action IN ('message_processed', 'background_job')), 0) AS input_tokens,
          COALESCE(SUM((a.metadata->>'outputTokens')::int) FILTER (WHERE a.action IN ('message_processed', 'background_job')), 0) AS output_tokens,
          COALESCE(SUM((a.metadata->>'toolCallCount')::int) FILTER (WHERE a.action = 'message_processed'), 0) AS tool_calls,
          COUNT(*) FILTER (WHERE a.action = 'external_api_call') AS external_api_calls,
          COUNT(*) FILTER (WHERE a.action = 'background_job') AS bg_jobs,
          COALESCE(SUM(a.credit_cost), 0) AS total_credits
        FROM audit_log a
        JOIN tenants t ON t.id = a.tenant_id
        WHERE a.created_at >= ${since7d}
        GROUP BY t.id, t.name
        ORDER BY total_tokens DESC
      `),
      db.query.appConfig.findFirst(),
    ]);

    return NextResponse.json({
      tenants,
      connections,
      skillRequests,
      recentAudit,
      profiles,
      usageSummary: usageRows,
      defaultDailyFreeCredits: appConfig?.defaultDailyFreeCredits ?? 100,
    });
  } finally {
    await close();
  }
}
