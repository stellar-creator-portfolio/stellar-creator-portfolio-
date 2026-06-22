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
import { prisma } from '@/lib/prisma'

const BOUNTY_ID = 'b-test-webhook'
const CREATOR_ID = 'creator-webhook'
const CLIENT_ID = 'u1'

describe('processStripeWebhookEvent', () => {
  beforeEach(async () => {
    await __resetEscrowStoreForTests()
    // Ensure a bounty exists for createEscrow
    await prisma.bounty.upsert({
      where: { id: BOUNTY_ID },
      update: {},
      create: {
        id: BOUNTY_ID,
        creatorId: CREATOR_ID,
        title: 'Test Bounty for Webhook',
        description: 'Auto-created by webhook tests',
        budget: 1000,
        deadline: new Date('2027-01-01'),
      },
    })
  })

  it('marks escrow funded on amount_capturable_updated via metadata escrowId', async () => {
    const e = await createEscrow({
      bountyId: BOUNTY_ID,
      clientUserId: CLIENT_ID,
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

  it('resolves escrow by payment intent id when no metadata escrowId', async () => {
    const e = await createEscrow({
      bountyId: BOUNTY_ID,
      clientUserId: CLIENT_ID,
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
