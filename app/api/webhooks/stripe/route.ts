import type Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import {
  findEscrowByPaymentIntent,
  markFundedAuthorized,
} from "@/lib/payments/escrow-service";
import { getStripe, getStripeWebhookSecret } from "@/lib/payments/stripe";
import { redisCheckRateLimit, redisGet, redisSet } from "@/lib/storage/redis";

const STRIPE_WEBHOOK_DEDUPE_TTL_SECONDS = 24 * 60 * 60;
const STRIPE_WEBHOOK_RATE_LIMIT_PER_SECOND = 10;

function clientIpFor(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function stripeAccountScope(event: Stripe.Event): string {
  return event.account || "platform";
}

function stripeEventDedupeKey(event: Stripe.Event): string {
  return `stripe:webhook:event:${stripeAccountScope(event)}:${event.id}`;
}

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = clientIpFor(req);
  const rateLimitBudget = await redisCheckRateLimit(
    `stripe-webhook:${ip}`,
    STRIPE_WEBHOOK_RATE_LIMIT_PER_SECOND,
  );

  if (rateLimitBudget < 0) {
    console.warn("[stripe-webhook] rate_limited", { ip });
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    console.warn("[stripe-webhook] missing_signature", { ip });
    return NextResponse.json({ error: "missing_signature" }, { status: 401 });
  }

  const rawBody = await req.text();
  const stripe = await getStripe();
  const webhookSecret = await getStripeWebhookSecret();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.warn("[stripe-webhook] invalid_signature", {
      ip,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const dedupeKey = stripeEventDedupeKey(event);
  const alreadyProcessed = await redisGet<{ processedAt: string }>(dedupeKey);
  if (alreadyProcessed) {
    console.info("[stripe-webhook] duplicate", {
      id: event.id,
      type: event.type,
      account: stripeAccountScope(event),
    });
    return NextResponse.json({ received: true, duplicate: true });
  }

  console.info("[stripe-webhook] received", {
    id: event.id,
    type: event.type,
    account: stripeAccountScope(event),
  });

  await processStripeWebhookEvent(event);
  await redisSet(
    dedupeKey,
    { processedAt: new Date().toISOString() },
    STRIPE_WEBHOOK_DEDUPE_TTL_SECONDS,
  );

  console.info("[stripe-webhook] processed", {
    id: event.id,
    type: event.type,
    account: stripeAccountScope(event),
  });

  return NextResponse.json({ received: true, duplicate: false });
}
