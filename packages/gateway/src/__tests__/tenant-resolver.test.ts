import { describe, it, expect, vi } from "vitest";
import { TenantResolver } from "../tenant-resolver.js";

describe("TenantResolver", () => {
  it("resolves tenant by phone number", async () => {
    const mockDb = {
      query: {
        tenants: {
          findFirst: vi.fn().mockResolvedValue({
            id: "tenant-1",
            name: "Test User",
            phone: "+1234567890",
          }),
        },
      },
    };
    const resolver = new TenantResolver(mockDb as any);
    const tenant = await resolver.resolveByPhone("+1234567890");
    expect(tenant?.id).toBe("tenant-1");
  });

  it("returns null for unknown phone", async () => {
    const mockDb = {
      query: {
        tenants: {
          findFirst: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
    const resolver = new TenantResolver(mockDb as any);
    const tenant = await resolver.resolveByPhone("+9999999999");
    expect(tenant).toBeNull();
  });
});
