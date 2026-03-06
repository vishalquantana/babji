import Stripe from "stripe";
import type { CreditLedger } from "@babji/credits";

export interface StripeConfig {
  pricePrepaid100: string;
  pricePrepaid200: string;
  priceProMonthly: string;
  appUrl: string;
}

export class StripeService {
  private stripe: Stripe;

  constructor(
    secretKey: string,
    private credits: CreditLedger,
    private config: StripeConfig,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createPrepaidLink(
    tenantId: string,
    amount: 100 | 200,
  ): Promise<string> {
    const priceMap: Record<100 | 200, string> = {
      100: this.config.pricePrepaid100,
      200: this.config.pricePrepaid200,
    };

    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceMap[amount], quantity: 1 }],
      metadata: { tenantId, creditAmount: String(amount) },
      success_url: `${this.config.appUrl}/payment/success`,
    });

    return session.url!;
  }

  async createProSubscriptionLink(tenantId: string): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: this.config.priceProMonthly, quantity: 1 }],
      metadata: { tenantId },
      success_url: `${this.config.appUrl}/payment/success`,
    });

    return session.url!;
  }

  async handleWebhook(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenantId;
        const creditAmount = session.metadata?.creditAmount;

        if (tenantId && creditAmount) {
          await this.credits.addPrepaid(tenantId, Number(creditAmount));
        }
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = (invoice.subscription_details as any)?.metadata
          ?.tenantId;
        if (tenantId) {
          await this.credits.addPrepaid(tenantId, 500); // Pro monthly grant
        }
        break;
      }
    }
  }
}
