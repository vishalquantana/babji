import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillRequestManager } from "../skill-request-manager.js";

const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();

const mockDb = () => ({
  query: {
    skillRequests: {
      findMany: vi.fn(),
    },
  },
  insert: mockInsert.mockReturnValue({
    values: mockValues.mockReturnValue({
      returning: mockReturning,
    }),
  }),
  update: mockUpdate.mockReturnValue({
    set: mockSet.mockReturnValue({
      where: mockWhere.mockResolvedValue(undefined),
    }),
  }),
});

describe("SkillRequestManager", () => {
  let db: ReturnType<typeof mockDb>;
  let manager: SkillRequestManager;

  beforeEach(() => {
    vi.clearAllMocks();
    db = mockDb();
    manager = new SkillRequestManager(db as any);
  });

  describe("create", () => {
    it("inserts a new skill request and returns the id", async () => {
      mockReturning.mockResolvedValue([{ id: "req-123" }]);

      const result = await manager.create("tenant-1", "invoice_generator", "User wants to generate PDF invoices");

      expect(result).toEqual({ id: "req-123" });
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        skillName: "invoice_generator",
        context: "User wants to generate PDF invoices",
      });
      expect(mockReturning).toHaveBeenCalled();
    });
  });

  describe("listPending", () => {
    it("returns all pending skill requests", async () => {
      const pendingRows = [
        {
          id: "req-1",
          tenantId: "t1",
          skillName: "crm_sync",
          context: "Needs CRM integration",
          status: "pending" as const,
          assignedTo: null,
          createdAt: new Date("2025-01-15"),
          resolvedAt: null,
        },
        {
          id: "req-2",
          tenantId: "t2",
          skillName: "sms_blast",
          context: "Wants to send bulk SMS",
          status: "pending" as const,
          assignedTo: null,
          createdAt: new Date("2025-01-16"),
          resolvedAt: null,
        },
      ];
      db.query.skillRequests.findMany.mockResolvedValue(pendingRows);

      const result = await manager.listPending();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "req-1",
        tenantId: "t1",
        skillName: "crm_sync",
        context: "Needs CRM integration",
        status: "pending",
        assignedTo: undefined,
        createdAt: new Date("2025-01-15"),
        resolvedAt: undefined,
      });
      expect(result[1].skillName).toBe("sms_blast");
      expect(db.query.skillRequests.findMany).toHaveBeenCalled();
    });

    it("returns empty array when no pending requests exist", async () => {
      db.query.skillRequests.findMany.mockResolvedValue([]);

      const result = await manager.listPending();

      expect(result).toEqual([]);
    });
  });

  describe("updateStatus", () => {
    it("sets status to in_progress with assignedTo", async () => {
      await manager.updateStatus("req-1", "in_progress", "admin@babji.ai");

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "in_progress",
          assignedTo: "admin@babji.ai",
        }),
      );
      // in_progress should NOT set resolvedAt
      const setArg = mockSet.mock.calls[0][0];
      expect(setArg).not.toHaveProperty("resolvedAt");
    });

    it("sets status to completed with resolvedAt timestamp", async () => {
      const before = new Date();
      await manager.updateStatus("req-1", "completed");
      const after = new Date();

      expect(mockSet).toHaveBeenCalled();
      const setArg = mockSet.mock.calls[0][0];
      expect(setArg.status).toBe("completed");
      expect(setArg.resolvedAt).toBeInstanceOf(Date);
      expect(setArg.resolvedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(setArg.resolvedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("sets status to rejected with resolvedAt timestamp", async () => {
      await manager.updateStatus("req-2", "rejected");

      const setArg = mockSet.mock.calls[0][0];
      expect(setArg.status).toBe("rejected");
      expect(setArg.resolvedAt).toBeInstanceOf(Date);
    });

    it("does not include assignedTo when not provided", async () => {
      await manager.updateStatus("req-1", "in_progress");

      const setArg = mockSet.mock.calls[0][0];
      expect(setArg).not.toHaveProperty("assignedTo");
    });
  });

  describe("getByTenant", () => {
    it("returns all skill requests for a given tenant", async () => {
      const tenantRows = [
        {
          id: "req-10",
          tenantId: "t1",
          skillName: "invoice_generator",
          context: "Needs invoicing",
          status: "pending" as const,
          assignedTo: null,
          createdAt: new Date("2025-01-10"),
          resolvedAt: null,
        },
        {
          id: "req-11",
          tenantId: "t1",
          skillName: "crm_sync",
          context: "Needs CRM",
          status: "completed" as const,
          assignedTo: "admin@babji.ai",
          createdAt: new Date("2025-01-05"),
          resolvedAt: new Date("2025-01-08"),
        },
      ];
      db.query.skillRequests.findMany.mockResolvedValue(tenantRows);

      const result = await manager.getByTenant("t1");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("req-10");
      expect(result[0].assignedTo).toBeUndefined();
      expect(result[1].id).toBe("req-11");
      expect(result[1].assignedTo).toBe("admin@babji.ai");
      expect(result[1].resolvedAt).toEqual(new Date("2025-01-08"));
      expect(db.query.skillRequests.findMany).toHaveBeenCalled();
    });

    it("returns empty array when tenant has no requests", async () => {
      db.query.skillRequests.findMany.mockResolvedValue([]);

      const result = await manager.getByTenant("t-unknown");

      expect(result).toEqual([]);
    });
  });
});
