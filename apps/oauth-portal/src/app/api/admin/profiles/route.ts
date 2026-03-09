import { NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { desc, eq } from "drizzle-orm";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");

  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    let profiles;
    if (statusFilter) {
      profiles = await db
        .select()
        .from(schema.profileDirectory)
        .where(eq(schema.profileDirectory.status, statusFilter as "pending" | "verified" | "corrected" | "failed"))
        .orderBy(desc(schema.profileDirectory.createdAt));
    } else {
      profiles = await db
        .select()
        .from(schema.profileDirectory)
        .orderBy(desc(schema.profileDirectory.createdAt));
    }

    return NextResponse.json({ profiles });
  } finally {
    await close();
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { id: string; linkedinUrl: string };
  if (!body.id || !body.linkedinUrl) {
    return NextResponse.json(
      { error: "Missing id or linkedinUrl" },
      { status: 400 },
    );
  }

  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    await db
      .update(schema.profileDirectory)
      .set({ linkedinUrl: body.linkedinUrl })
      .where(eq(schema.profileDirectory.id, body.id));

    return NextResponse.json({ ok: true });
  } finally {
    await close();
  }
}
