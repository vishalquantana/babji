import { NextResponse } from "next/server";
import { createDb } from "@babji/db";
import { sql } from "drizzle-orm";
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
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const yesterdayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();

    const [dailyResult, hourlyResult, todayResult, yesterdayResult] = await Promise.all([
      db.execute(sql`
        SELECT
          DATE(created_at) AS day,
          COUNT(*) AS messages,
          COALESCE(SUM((metadata->>'totalTokens')::int), 0) AS tokens
        FROM audit_log
        WHERE created_at >= ${sevenDaysAgo}
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
      `),
      db.execute(sql`
        SELECT
          DATE_TRUNC('hour', created_at) AS hour,
          COUNT(*) AS messages,
          COALESCE(SUM((metadata->>'totalTokens')::int), 0) AS tokens
        FROM audit_log
        WHERE created_at >= ${todayMidnight}
        GROUP BY DATE_TRUNC('hour', created_at)
        ORDER BY DATE_TRUNC('hour', created_at)
      `),
      db.execute(sql`
        SELECT
          COUNT(*) AS messages,
          COALESCE(SUM((metadata->>'totalTokens')::int), 0) AS tokens
        FROM audit_log
        WHERE created_at >= ${todayMidnight}
      `),
      db.execute(sql`
        SELECT
          COUNT(*) AS messages,
          COALESCE(SUM((metadata->>'totalTokens')::int), 0) AS tokens
        FROM audit_log
        WHERE created_at >= ${yesterdayMidnight}
          AND created_at < ${todayMidnight}
      `),
    ]);

    const daily = (dailyResult as any).rows || dailyResult;
    const hourly = (hourlyResult as any).rows || hourlyResult;
    const todayRows = (todayResult as any).rows || todayResult;
    const yesterdayRows = (yesterdayResult as any).rows || yesterdayResult;

    const todayRow = Array.isArray(todayRows) ? todayRows[0] : todayRows;
    const yesterdayRow = Array.isArray(yesterdayRows) ? yesterdayRows[0] : yesterdayRows;

    return NextResponse.json({
      daily,
      hourly,
      today: {
        messages: Number(todayRow?.messages ?? 0),
        tokens: Number(todayRow?.tokens ?? 0),
      },
      yesterday: {
        messages: Number(yesterdayRow?.messages ?? 0),
        tokens: Number(yesterdayRow?.tokens ?? 0),
      },
    });
  } finally {
    await close();
  }
}
