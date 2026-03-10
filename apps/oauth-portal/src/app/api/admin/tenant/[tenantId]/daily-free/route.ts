import { NextRequest, NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { eq } from "drizzle-orm";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tenantId } = await params;
  const body = await request.json();
  const value = body.dailyFreeOverride;

  if (value !== null) {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
      return NextResponse.json(
        { error: "dailyFreeOverride must be a non-negative integer or null" },
        { status: 400 },
      );
    }
  }

  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    await db
      .update(schema.creditBalances)
      .set({ dailyFreeOverride: value === null ? null : Number(value) })
      .where(eq(schema.creditBalances.tenantId, tenantId));

    return NextResponse.json({ tenantId, dailyFreeOverride: value });
  } finally {
    await close();
  }
}
