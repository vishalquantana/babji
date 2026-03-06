import { describe, it, expect, vi, beforeEach } from "vitest";
import { CreditLedger } from "../credit-ledger.js";

const mockDb = () => ({
  query: {
    creditBalances: {
      findFirst: vi.fn(),
    },
  },
  insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }),
});

describe("CreditLedger", () => {
  it("checks if tenant has enough credits", async () => {
    const db = mockDb();
    db.query.creditBalances.findFirst.mockResolvedValue({
      tenantId: "t1",
      dailyFree: 3,
      prepaid: 10,
      proMonthly: 0,
      lastDailyReset: new Date(),
    });

    const ledger = new CreditLedger(db as any);
    const result = await ledger.hasCredits("t1", 1);
    expect(result).toBe(true);
  });

  it("returns false when no credits left", async () => {
    const db = mockDb();
    db.query.creditBalances.findFirst.mockResolvedValue({
      tenantId: "t1",
      dailyFree: 0,
      prepaid: 0,
      proMonthly: 0,
      lastDailyReset: new Date(),
    });

    const ledger = new CreditLedger(db as any);
    const result = await ledger.hasCredits("t1", 1);
    expect(result).toBe(false);
  });

  it("computes total balance correctly", async () => {
    const db = mockDb();
    db.query.creditBalances.findFirst.mockResolvedValue({
      tenantId: "t1",
      dailyFree: 3,
      prepaid: 50,
      proMonthly: 200,
      lastDailyReset: new Date(),
    });

    const ledger = new CreditLedger(db as any);
    const balance = await ledger.getBalance("t1");
    expect(balance.total).toBe(253);
  });
});
