import { NextRequest, NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { eq, isNull } from "drizzle-orm";
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
    const config = await db.query.appConfig.findFirst();
    return NextResponse.json({
      defaultDailyFreeCredits: config?.defaultDailyFreeCredits ?? 100,
    });
  } finally {
    await close();
  }
}

export async function PUT(request: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const value = Number(body.defaultDailyFreeCredits);
  if (!Number.isInteger(value) || value < 0) {
    return NextResponse.json(
      { error: "defaultDailyFreeCredits must be a non-negative integer" },
      { status: 400 },
    );
  }

  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    const existing = await db.query.appConfig.findFirst();
    if (existing) {
      await db
        .update(schema.appConfig)
        .set({ defaultDailyFreeCredits: value, updatedAt: new Date() })
        .where(eq(schema.appConfig.id, 1));
    } else {
      await db
        .insert(schema.appConfig)
        .values({ id: 1, defaultDailyFreeCredits: value });
    }
    // Update dailyFree for all tenants WITHOUT a per-tenant override
    await db
      .update(schema.creditBalances)
      .set({ dailyFree: value, lastDailyReset: new Date() })
      .where(isNull(schema.creditBalances.dailyFreeOverride));

    return NextResponse.json({ defaultDailyFreeCredits: value });
  } finally {
    await close();
  }
}
