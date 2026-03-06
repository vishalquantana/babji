import { eq } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import type { CreditBalance } from "@babji/types";

export class CreditLedger {
  constructor(private db: Database) {}

  async getBalance(tenantId: string): Promise<CreditBalance> {
    const row = await this.db.query.creditBalances.findFirst({
      where: eq(schema.creditBalances.tenantId, tenantId),
    });

    if (!row) {
      return { tenantId, dailyFree: 0, prepaid: 0, proMonthly: 0, total: 0 };
    }

    const balance = await this.maybeResetDaily(row);

    return {
      tenantId,
      dailyFree: balance.dailyFree,
      prepaid: balance.prepaid,
      proMonthly: balance.proMonthly,
      total: balance.dailyFree + balance.prepaid + balance.proMonthly,
    };
  }

  async hasCredits(tenantId: string, needed: number): Promise<boolean> {
    const balance = await this.getBalance(tenantId);
    return balance.total >= needed;
  }

  async deduct(tenantId: string, amount: number, description: string): Promise<boolean> {
    const balance = await this.getBalance(tenantId);
    if (balance.total < amount) return false;

    let remaining = amount;
    const deductDaily = Math.min(remaining, balance.dailyFree);
    remaining -= deductDaily;
    const deductPrepaid = Math.min(remaining, balance.prepaid);
    remaining -= deductPrepaid;
    const deductPro = Math.min(remaining, balance.proMonthly);

    await this.db
      .update(schema.creditBalances)
      .set({
        dailyFree: balance.dailyFree - deductDaily,
        prepaid: balance.prepaid - deductPrepaid,
        proMonthly: balance.proMonthly - deductPro,
      })
      .where(eq(schema.creditBalances.tenantId, tenantId));

    await this.db.insert(schema.creditTransactions).values({
      tenantId,
      type: "action_debit",
      amount: -amount,
      description,
    });

    return true;
  }

  async initializeForTenant(tenantId: string): Promise<void> {
    await this.db.insert(schema.creditBalances).values({
      tenantId,
      dailyFree: 5,
      prepaid: 0,
      proMonthly: 0,
    });
  }

  async addPrepaid(tenantId: string, amount: number): Promise<void> {
    const balance = await this.getBalance(tenantId);
    await this.db
      .update(schema.creditBalances)
      .set({ prepaid: balance.prepaid + amount })
      .where(eq(schema.creditBalances.tenantId, tenantId));

    await this.db.insert(schema.creditTransactions).values({
      tenantId,
      type: "prepaid_purchase",
      amount,
      description: `Purchased ${amount} prepaid credits`,
    });
  }

  private async maybeResetDaily(row: typeof schema.creditBalances.$inferSelect) {
    const now = new Date();
    const lastReset = new Date(row.lastDailyReset);
    const isSameDay = now.toDateString() === lastReset.toDateString();

    if (!isSameDay) {
      await this.db
        .update(schema.creditBalances)
        .set({ dailyFree: 5, lastDailyReset: now })
        .where(eq(schema.creditBalances.tenantId, row.tenantId));
      return { ...row, dailyFree: 5, lastDailyReset: now };
    }

    return row;
  }
}
