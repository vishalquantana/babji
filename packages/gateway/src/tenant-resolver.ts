import { eq } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";

export class TenantResolver {
  constructor(private db: Database) {}

  async resolveByPhone(phone: string) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(schema.tenants.phone, phone),
    });
    return tenant ?? null;
  }

  async resolveByTelegramId(telegramUserId: string) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(schema.tenants.telegramUserId, telegramUserId),
    });
    return tenant ?? null;
  }
}
