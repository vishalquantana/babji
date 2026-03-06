import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import { StripeService } from "../stripe-service.js";
import type { StripeConfig } from "../stripe-service.js";

const mockCredits = {
  addPrepaid: vi.fn().mockResolvedValue(undefined),
  hasCredits: vi.fn().mockResolvedValue(true),
  getBalance: vi.fn(),
  deduct: vi.fn(),
  initializeForTenant: vi.fn(),
};

const mockConfig: StripeConfig = {
  pricePrepaid100: "price_100",
  pricePrepaid200: "price_200",
  priceProMonthly: "price_pro",
  appUrl: "https://app.babji.dev",
};

function makeService(): StripeService {
  return new StripeService("sk_test_fake", mockCredits as any, mockConfig);
}

function makeCheckoutEvent(
  metadata: Record<string, string> | null,
): Stripe.Event {
  return {
    id: "evt_test_1",
    type: "checkout.session.completed",
    data: {
      object: {
        metadata: metadata,
      } as unknown as Stripe.Checkout.Session,
    },
  } as unknown as Stripe.Event;
}

function makeInvoiceEvent(tenantId: string | null): Stripe.Event {
  return {
    id: "evt_test_2",
    type: "invoice.paid",
    data: {
      object: {
        subscription_details: tenantId
          ? { metadata: { tenantId } }
          : { metadata: {} },
      } as unknown as Stripe.Invoice,
    },
  } as unknown as Stripe.Event;
}

describe("StripeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleWebhook", () => {
    it("adds prepaid credits on checkout.session.completed", async () => {
      const service = makeService();
      const event = makeCheckoutEvent({
        tenantId: "tenant-abc",
        creditAmount: "100",
      });

      await service.handleWebhook(event);

      expect(mockCredits.addPrepaid).toHaveBeenCalledOnce();
      expect(mockCredits.addPrepaid).toHaveBeenCalledWith("tenant-abc", 100);
    });

    it("adds 500 credits on invoice.paid for Pro subscription", async () => {
      const service = makeService();
      const event = makeInvoiceEvent("tenant-pro");

      await service.handleWebhook(event);

      expect(mockCredits.addPrepaid).toHaveBeenCalledOnce();
      expect(mockCredits.addPrepaid).toHaveBeenCalledWith("tenant-pro", 500);
    });

    it("does nothing for unknown event types", async () => {
      const service = makeService();
      const event = {
        id: "evt_test_3",
        type: "customer.created",
        data: { object: {} },
      } as unknown as Stripe.Event;

      await service.handleWebhook(event);

      expect(mockCredits.addPrepaid).not.toHaveBeenCalled();
    });

    it("does not call addPrepaid when checkout metadata is missing", async () => {
      const service = makeService();
      const event = makeCheckoutEvent({});

      await service.handleWebhook(event);

      expect(mockCredits.addPrepaid).not.toHaveBeenCalled();
    });

    it("does not call addPrepaid when checkout metadata has no creditAmount", async () => {
      const service = makeService();
      const event = makeCheckoutEvent({ tenantId: "tenant-abc" });

      await service.handleWebhook(event);

      expect(mockCredits.addPrepaid).not.toHaveBeenCalled();
    });

    it("does not call addPrepaid when invoice has no tenantId in subscription metadata", async () => {
      const service = makeService();
      const event = makeInvoiceEvent(null);

      await service.handleWebhook(event);

      expect(mockCredits.addPrepaid).not.toHaveBeenCalled();
    });
  });
});
