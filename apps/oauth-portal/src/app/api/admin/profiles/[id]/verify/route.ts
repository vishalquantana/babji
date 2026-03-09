import { NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { eq } from "drizzle-orm";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    await db
      .update(schema.profileDirectory)
      .set({
        status: "verified",
        verifiedBy: "admin",
        verifiedAt: new Date(),
      })
      .where(eq(schema.profileDirectory.id, id));

    return NextResponse.json({ ok: true });
  } finally {
    await close();
  }
}
