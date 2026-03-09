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
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    // Update status to completed
    const [updated] = await db
      .update(schema.skillRequests)
      .set({ status: "completed", resolvedAt: new Date() })
      .where(eq(schema.skillRequests.id, requestId))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Skill request not found" },
        { status: 404 },
      );
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
