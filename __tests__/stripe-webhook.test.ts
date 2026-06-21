import { describe, it, expect, beforeEach } from 'vitest'
import type Stripe from 'stripe'
import { processStripeWebhookEvent } from '@/app/api/webhooks/stripe/route'
import {
  __resetEscrowStoreForTests,
  createEscrow,
  attachPaymentIntent,
  getEscrow,
  findEscrowByPaymentIntent,
} from '@/lib/payments/escrow-service'

describe('processStripeWebhookEvent', () => {
  beforeEach(async () => {
    await __resetEscrowStoreForTests()
  })

  it('marks escrow funded on amount_capturable_updated', async () => {
    const e = await createEscrow({
      bountyId: 'b-1',
      clientUserId: 'u1',
      amountCents: 1000,
    })
    await attachPaymentIntent(e.id, 'pi_abc')

    const pi = {
      id: 'pi_abc',
      object: 'payment_intent',
      status: 'requires_capture',
      metadata: { escrowId: e.id },
      latest_charge: null,
    } as unknown as Stripe.PaymentIntent

    const event = {
      id: 'evt_1',
      object: 'event',
      type: 'payment_intent.amount_capturable_updated',
      data: { object: pi },
    } as Stripe.Event

    await processStripeWebhookEvent(event)
    expect((await getEscrow(e.id))?.status).toBe('funded_authorized')
  })

  it('resolves escrow by payment intent id', async () => {
    const e = await createEscrow({
      bountyId: 'b-1',
      clientUserId: 'u1',
      amountCents: 1000,
    })
    await attachPaymentIntent(e.id, 'pi_xyz')

    const pi = {
      id: 'pi_xyz',
      object: 'payment_intent',
      status: 'requires_capture',
      metadata: {},
      latest_charge: null,
    } as unknown as Stripe.PaymentIntent

    await processStripeWebhookEvent({
      type: 'payment_intent.amount_capturable_updated',
      data: { object: pi },
    } as Stripe.Event)

    expect((await findEscrowByPaymentIntent('pi_xyz'))?.status).toBe('funded_authorized')
  })
})
