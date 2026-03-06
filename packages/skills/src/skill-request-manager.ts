import { eq } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import type { SkillRequest } from "@babji/types";

export class SkillRequestManager {
  constructor(private db: Database) {}

  async create(
    tenantId: string,
    skillName: string,
    context: string,
  ): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(schema.skillRequests)
      .values({ tenantId, skillName, context })
      .returning({ id: schema.skillRequests.id });
    return { id: row.id };
  }

  async listPending(): Promise<SkillRequest[]> {
    const rows = await this.db.query.skillRequests.findMany({
      where: eq(schema.skillRequests.status, "pending"),
    });
    return rows.map(toSkillRequest);
  }

  async updateStatus(
    requestId: string,
    status: "in_progress" | "completed" | "rejected",
    assignedTo?: string,
  ): Promise<void> {
    const isResolved = status === "completed" || status === "rejected";
    await this.db
      .update(schema.skillRequests)
      .set({
        status,
        ...(assignedTo !== undefined ? { assignedTo } : {}),
        ...(isResolved ? { resolvedAt: new Date() } : {}),
      })
      .where(eq(schema.skillRequests.id, requestId));
  }

  async getByTenant(tenantId: string): Promise<SkillRequest[]> {
    const rows = await this.db.query.skillRequests.findMany({
      where: eq(schema.skillRequests.tenantId, tenantId),
    });
    return rows.map(toSkillRequest);
  }
}

function toSkillRequest(
  row: typeof schema.skillRequests.$inferSelect,
): SkillRequest {
  return {
    id: row.id,
    tenantId: row.tenantId,
    skillName: row.skillName,
    context: row.context,
    status: row.status,
    assignedTo: row.assignedTo ?? undefined,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? undefined,
  };
}
