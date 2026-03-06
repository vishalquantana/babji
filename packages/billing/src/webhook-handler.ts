import Stripe from "stripe";
import type { StripeService } from "./stripe-service.js";

export class WebhookHandler {
  private stripe: Stripe;

  constructor(
    secretKey: string,
    private webhookSecret: string,
    private service: StripeService,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async handleRequest(
    rawBody: string | Buffer,
    signature: string,
  ): Promise<void> {
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
    await this.service.handleWebhook(event);
  }
}
