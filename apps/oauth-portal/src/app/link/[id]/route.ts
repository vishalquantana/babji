import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { createDb } from "@babji/db";
import { schema } from "@babji/db";
import { eq } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    const link = await db.query.shortLinks.findFirst({
      where: eq(schema.shortLinks.id, id),
    });

    if (!link) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    redirect(link.url);
  } finally {
    await close();
  }
}
