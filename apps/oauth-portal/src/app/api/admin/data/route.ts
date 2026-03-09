import { NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { desc } from "drizzle-orm";
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
    const [tenants, connections, skillRequests, recentAudit, profiles] = await Promise.all([
      db.select().from(schema.tenants).orderBy(desc(schema.tenants.lastActiveAt)),
      db.select().from(schema.serviceConnections).orderBy(desc(schema.serviceConnections.createdAt)),
      db.select().from(schema.skillRequests).orderBy(desc(schema.skillRequests.createdAt)),
      db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.createdAt)).limit(50),
      db.select().from(schema.profileDirectory).orderBy(desc(schema.profileDirectory.createdAt)),
    ]);

    return NextResponse.json({ tenants, connections, skillRequests, recentAudit, profiles });
  } finally {
    await close();
  }
}
