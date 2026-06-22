import type Stripe from "stripe";
import {
  findEscrowByPaymentIntent,
  markFundedAuthorized,
} from "@/lib/payments/escrow-service";

/**
 * Process a Stripe webhook event and update escrow state accordingly.
 *
 * On `payment_intent.amount_capturable_updated` we transition the
 * linked escrow to `funded_authorized` so the release flow can proceed.
 */
export async function processStripeWebhookEvent(
  event: Stripe.Event,
): Promise<void> {
  if (event.type !== "payment_intent.amount_capturable_updated") {
    return;
  }

  const pi = event.data.object as Stripe.PaymentIntent;

  // Prefer explicit escrowId in metadata
  const escrowId = pi.metadata?.escrowId as string | undefined;
  if (escrowId) {
    await markFundedAuthorized(escrowId);
    return;
  }

  // Fallback: resolve escrow by payment intent ID
  const escrow = await findEscrowByPaymentIntent(pi.id);
  if (escrow) {
    await markFundedAuthorized(escrow.id);
  }
}
