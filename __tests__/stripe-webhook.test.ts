import { describe, it, expect, beforeEach, vi } from 'vitest'
import type Stripe from 'stripe'
import crypto from 'node:crypto'
import { POST, processStripeWebhookEvent } from '@/app/api/webhooks/stripe/route'
import {
  __resetEscrowStoreForTests,
  createEscrow,
  attachPaymentIntent,
  getEscrow,
  findEscrowByPaymentIntent,
} from '@/lib/payments/escrow-service'

vi.mock('@/lib/payments/escrow-service', () => {
  type TestEscrow = {
    id: string
    bountyId: string
    clientUserId: string
    amountCents: number
    status: string
    paymentIntentId?: string
  }

  let nextId = 1
  const escrows = new Map<string, TestEscrow>()

  return {
    __resetEscrowStoreForTests: vi.fn(async () => {
      nextId = 1
      escrows.clear()
    }),
    createEscrow: vi.fn(async (input: Omit<TestEscrow, 'id' | 'status'>) => {
      const escrow: TestEscrow = {
        id: `escrow_${nextId++}`,
        status: 'pending',
        ...input,
      }
      escrows.set(escrow.id, escrow)
      return escrow
    }),
    attachPaymentIntent: vi.fn(async (id: string, paymentIntentId: string) => {
      const escrow = escrows.get(id)
      if (escrow) {
        escrow.paymentIntentId = paymentIntentId
      }
    }),
    getEscrow: vi.fn(async (id: string) => escrows.get(id) ?? null),
    findEscrowByPaymentIntent: vi.fn(async (paymentIntentId: string) =>
      Array.from(escrows.values()).find((escrow) => escrow.paymentIntentId === paymentIntentId) ?? null,
    ),
    markFundedAuthorized: vi.fn(async (id: string) => {
      const escrow = escrows.get(id)
      if (escrow) {
        escrow.status = 'funded_authorized'
      }
    }),
  }
})

vi.mock('@/lib/storage/redis', () => {
  const store = new Map<string, unknown>()
  const counters = new Map<string, number>()

  return {
    redisGet: vi.fn(async (key: string) => store.get(key) ?? null),
    redisSet: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    redisCheckRateLimit: vi.fn(async (key: string, maxPerSecond = 30) => {
      const next = (counters.get(key) ?? 0) + 1
      counters.set(key, next)
      return next <= maxPerSecond ? maxPerSecond - next : -1
    }),
    __resetRedisMock: () => {
      store.clear()
      counters.clear()
    },
  }
})

vi.mock('@/lib/payments/stripe', async () => {
  const Stripe = (await import('stripe')).default
  let client: Stripe | null = null

  return {
    getStripe: async () => {
      client ??= new Stripe('sk_test_webhook')
      return client
    },
    getStripeWebhookSecret: async () => process.env.STRIPE_WEBHOOK_SECRET,
  }
})

const BOUNTY_ID = 'b-test-webhook'
const CREATOR_ID = 'creator-webhook'
const CLIENT_ID = 'u1'
const WEBHOOK_SECRET = 'whsec_test_secret'

function signedStripeRequest(event: Stripe.Event, secret = WEBHOOK_SECRET): Request {
  const payload = JSON.stringify(event)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')

  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'stripe-signature': `t=${timestamp},v1=${signature}`,
      'x-forwarded-for': '203.0.113.10',
    },
    body: payload,
  })
}

describe('processStripeWebhookEvent', () => {
  beforeEach(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    const redis = await import('@/lib/storage/redis')
    ;(redis as unknown as { __resetRedisMock: () => void }).__resetRedisMock()
    await __resetEscrowStoreForTests()
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

  it('POST verifies a valid Stripe signature before processing the event', async () => {
    const e = await createEscrow({
      bountyId: BOUNTY_ID,
      clientUserId: CLIENT_ID,
      amountCents: 1000,
    })
    await attachPaymentIntent(e.id, 'pi_signed')

    const event = {
      id: 'evt_valid_signature',
      object: 'event',
      type: 'payment_intent.amount_capturable_updated',
      data: {
        object: {
          id: 'pi_signed',
          object: 'payment_intent',
          status: 'requires_capture',
          metadata: { escrowId: e.id },
          latest_charge: null,
        },
      },
    } as Stripe.Event

    const res = await POST(signedStripeRequest(event) as never)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ received: true, duplicate: false })
    expect((await getEscrow(e.id))?.status).toBe('funded_authorized')
  })

  it('POST rejects forged Stripe signatures without changing escrow state', async () => {
    const e = await createEscrow({
      bountyId: BOUNTY_ID,
      clientUserId: CLIENT_ID,
      amountCents: 1000,
    })
    await attachPaymentIntent(e.id, 'pi_forged')

    const event = {
      id: 'evt_forged_signature',
      object: 'event',
      type: 'payment_intent.amount_capturable_updated',
      data: {
        object: {
          id: 'pi_forged',
          object: 'payment_intent',
          status: 'requires_capture',
          metadata: { escrowId: e.id },
          latest_charge: null,
        },
      },
    } as Stripe.Event

    const res = await POST(signedStripeRequest(event, 'whsec_wrong') as never)

    expect(res.status).toBe(401)
    expect((await getEscrow(e.id))?.status).not.toBe('funded_authorized')
  })

  it('POST treats duplicate event IDs as already received without reprocessing', async () => {
    const e = await createEscrow({
      bountyId: BOUNTY_ID,
      clientUserId: CLIENT_ID,
      amountCents: 1000,
    })
    await attachPaymentIntent(e.id, 'pi_duplicate')

    const event = {
      id: 'evt_duplicate',
      object: 'event',
      type: 'payment_intent.amount_capturable_updated',
      data: {
        object: {
          id: 'pi_duplicate',
          object: 'payment_intent',
          status: 'requires_capture',
          metadata: { escrowId: e.id },
          latest_charge: null,
        },
      },
    } as Stripe.Event

    expect((await POST(signedStripeRequest(event) as never)).status).toBe(200)
    const second = await POST(signedStripeRequest(event) as never)

    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({ received: true, duplicate: true })
  })

  it('POST rate-limits Stripe webhook bursts by client IP', async () => {
    const event = {
      id: 'evt_rate_limited',
      object: 'event',
      type: 'customer.created',
      data: { object: { id: 'cus_1', object: 'customer' } },
    } as Stripe.Event

    const responses = []
    for (let i = 0; i < 11; i += 1) {
      responses.push(await POST(signedStripeRequest({ ...event, id: `evt_rate_limited_${i}` }) as never))
    }

    expect(responses.slice(0, 10).every((res) => res.status === 200)).toBe(true)
    expect(responses[10].status).toBe(429)
  })
})
