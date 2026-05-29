import Stripe from 'stripe';
import { getSecret } from '@/backend/services/kms';

/**
 * Server-side Stripe client.  The secret key is resolved through the KMS
 * abstraction so it is fetched from AWS Secrets Manager in production and
 * from environment variables in local/CI environments.
 *
 * Card data never touches this server — use Stripe.js / Elements or Checkout
 * on the client (PCI DSS scope reduction).
 */
let stripeSingleton: Stripe | null = null;

export async function getStripe(): Promise<Stripe> {
  if (stripeSingleton) return stripeSingleton;
  const key = await getSecret('STRIPE_SECRET_KEY');
  stripeSingleton = new Stripe(key);
  return stripeSingleton;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim() || process.env.KMS_PROVIDER === 'aws');
}

export async function getStripePublishableKey(): Promise<string> {
  const k = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!k?.trim()) {
    throw new Error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured');
  }
  return k;
}

export async function getStripeWebhookSecret(): Promise<string> {
  return getSecret('STRIPE_WEBHOOK_SECRET');
}
