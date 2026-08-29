import { randomUUID } from 'crypto'
import Stripe from 'stripe'
import { describe, it, expect, beforeEach, vi } from 'vitest'

process.env.STRIPE_SECRET_KEY = 'sk_test_webhook_secret'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_webhook_secret'

type MockEscrowRecord = {
  id: string
  paymentIntentId: string | null
  status: 'pending_funding' | 'funded_authorized'
  version: number
}

const { idempotencyKeys, rateLimitHits, escrowStore } = vi.hoisted(() => {
  return {
    idempotencyKeys: new Map<string, string>(),
    rateLimitHits: new Map<string, number[]>(),
    escrowStore: new Map<string, MockEscrowRecord>(),
  }
})

vi.mock('@/lib/storage/redis', () => ({
  redisDel: vi.fn(async (key: string) => {
    idempotencyKeys.delete(key)
  }),
  redisSet: vi.fn(async (key: string, value: unknown) => {
    idempotencyKeys.set(key, JSON.stringify(value))
  }),
  redisSetIfAbsent: vi.fn(async (key: string) => {
    if (idempotencyKeys.has(key)) {
      return false
    }
    idempotencyKeys.set(key, 'processing')
    return true
  }),
  redisSlidingWindowRateLimit: vi.fn(async (key: string, limit: number, windowSeconds: number) => {
    const now = Date.now()
    const hits = rateLimitHits.get(key) ?? []
    const freshHits = hits.filter((timestamp) => now - timestamp < windowSeconds * 1000)
    freshHits.push(now)
    rateLimitHits.set(key, freshHits)

    return {
      allowed: freshHits.length <= limit,
      count: freshHits.length,
      remaining: Math.max(limit - freshHits.length, 0),
      resetAt: now + windowSeconds * 1000,
    }
  }),
}))

vi.mock('@/lib/payments/escrow-service', () => ({
  __resetEscrowStoreForTests: vi.fn(async () => {
    escrowStore.clear()
  }),
  createEscrow: vi.fn(async () => {
    const id = `escrow_${randomUUID()}`
    const record: MockEscrowRecord = {
      id,
      paymentIntentId: null,
      status: 'pending_funding',
      version: 0,
    }
    escrowStore.set(id, record)
    return record
  }),
  attachPaymentIntent: vi.fn(async (escrowId: string, paymentIntentId: string) => {
    const record = escrowStore.get(escrowId)
    if (!record) {
      return null
    }

    record.paymentIntentId = paymentIntentId
    record.version += 1
    return record
  }),
  getEscrow: vi.fn(async (id: string) => {
    return escrowStore.get(id) ?? null
  }),
  findEscrowByPaymentIntent: vi.fn(async (paymentIntentId: string) => {
    for (const record of escrowStore.values()) {
      if (record.paymentIntentId === paymentIntentId) {
        return record
      }
    }

    return null
  }),
  markFundedAuthorized: vi.fn(async (escrowId: string) => {
    const record = escrowStore.get(escrowId)
    if (!record) {
      return null
    }

    record.status = 'funded_authorized'
    record.version += 1
    return record
  }),
}))

import {
  POST,
  processStripeWebhookEvent,
} from '@/app/api/webhooks/stripe/route'
import {
  __resetEscrowStoreForTests,
  attachPaymentIntent,
  createEscrow,
  findEscrowByPaymentIntent,
  getEscrow,
} from '@/lib/payments/escrow-service'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

const CLIENT_ID = 'u1'
const DEFAULT_IP = '203.0.113.10'

function makeEvent(params: {
  id: string
  paymentIntentId: string
  escrowId?: string
  account?: string
  type?: string
}) {
  const event = {
    id: params.id,
    object: 'event',
    account: params.account ?? 'acct_test_123',
    type: params.type ?? 'payment_intent.amount_capturable_updated',
    data: {
      object: {
        id: params.paymentIntentId,
        object: 'payment_intent',
        status: 'requires_capture',
        metadata: params.escrowId ? { escrowId: params.escrowId } : {},
        latest_charge: null,
      },
    },
  } as Stripe.Event

  const payload = JSON.stringify(event)
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET as string,
  })

  return { payload, signature, event }
}

function makeForgedSignature(payload: string) {
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: 'whsec_forged_secret',
  })
}

function makeRequest(payload: string, signature: string, ip: string = DEFAULT_IP) {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
      'x-forwarded-for': ip,
    },
    body: payload,
  })
}

describe('processStripeWebhookEvent', () => {
  beforeEach(async () => {
    idempotencyKeys.clear()
    rateLimitHits.clear()
    await __resetEscrowStoreForTests()
  })

  it('marks escrow funded on amount_capturable_updated via metadata escrowId', async () => {
    const escrow = await createEscrow({
      bountyId: 'b-test-webhook',
      clientUserId: CLIENT_ID,
      amountCents: 1000,
    })
    await attachPaymentIntent(escrow.id, 'pi_abc')

    const event = makeEvent({
      id: 'evt_1',
      paymentIntentId: 'pi_abc',
      escrowId: escrow.id,
    }).event

    await processStripeWebhookEvent(event)

    expect((await getEscrow(escrow.id))?.status).toBe('funded_authorized')
  })

  it('resolves escrow by payment intent id when no metadata escrowId is present', async () => {
    const escrow = await createEscrow({
      bountyId: 'b-test-webhook',
      clientUserId: CLIENT_ID,
      amountCents: 1000,
    })
    await attachPaymentIntent(escrow.id, 'pi_xyz')

    await processStripeWebhookEvent(
      makeEvent({
        id: 'evt_2',
        paymentIntentId: 'pi_xyz',
      }).event,
    )

    expect((await findEscrowByPaymentIntent('pi_xyz'))?.status).toBe(
      'funded_authorized',
    )
  })
})

describe('POST /api/webhooks/stripe', () => {
  beforeEach(async () => {
    idempotencyKeys.clear()
    rateLimitHits.clear()
    await __resetEscrowStoreForTests()
  })

  it('accepts a valid signature and transitions escrow state', async () => {
    const escrow = await createEscrow({
      bountyId: 'b-test-webhook',
      clientUserId: CLIENT_ID,
      amountCents: 1000,
    })
    await attachPaymentIntent(escrow.id, 'pi_valid')

    const { payload, signature } = makeEvent({
      id: 'evt_valid',
      paymentIntentId: 'pi_valid',
      escrowId: escrow.id,
    })

    const response = await POST(makeRequest(payload, signature) as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ received: true })
    expect((await getEscrow(escrow.id))?.status).toBe('funded_authorized')
  })

  it('rejects a forged signature without changing escrow state', async () => {
    const escrow = await createEscrow({
      bountyId: 'b-test-webhook',
      clientUserId: CLIENT_ID,
      amountCents: 1000,
    })
    await attachPaymentIntent(escrow.id, 'pi_forged')

    const { payload, signature } = makeEvent({
      id: 'evt_forged',
      paymentIntentId: 'pi_forged',
      escrowId: escrow.id,
    })
    const forgedSignature = makeForgedSignature(payload)

    const response = await POST(makeRequest(payload, forgedSignature) as any)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Invalid Stripe signature' })
    expect((await getEscrow(escrow.id))?.status).toBe('pending_funding')

    // Sanity check that the genuine signature would have been valid.
    expect(signature).not.toBe(forgedSignature)
  })

  it('treats a replayed event as a duplicate and does not transition twice', async () => {
    const escrow = await createEscrow({
      bountyId: 'b-test-webhook',
      clientUserId: CLIENT_ID,
      amountCents: 1000,
    })
    await attachPaymentIntent(escrow.id, 'pi_duplicate')

    const { payload, signature } = makeEvent({
      id: 'evt_duplicate',
      paymentIntentId: 'pi_duplicate',
      escrowId: escrow.id,
    })

    const firstResponse = await POST(makeRequest(payload, signature) as any)
    const versionAfterFirst = (await getEscrow(escrow.id))?.version

    const duplicateResponse = await POST(makeRequest(payload, signature) as any)
    const duplicateBody = await duplicateResponse.json()
    const versionAfterDuplicate = (await getEscrow(escrow.id))?.version

    expect(firstResponse.status).toBe(200)
    expect(await firstResponse.json()).toEqual({ received: true })
    expect(duplicateResponse.status).toBe(200)
    expect(duplicateBody).toEqual({ received: true, duplicate: true })
    expect(versionAfterDuplicate).toBe(versionAfterFirst)
    expect((await getEscrow(escrow.id))?.status).toBe('funded_authorized')
  })

  it('rate limits more than 10 requests per second per IP', async () => {
    const responses = []

    for (let index = 0; index < 11; index += 1) {
      const { payload, signature } = makeEvent({
        id: `evt_rate_${index}`,
        paymentIntentId: `pi_rate_${index}`,
        type: 'charge.succeeded',
      })

      responses.push(await POST(makeRequest(payload, signature) as any))
    }

    const lastResponse = responses[responses.length - 1]

    expect(lastResponse.status).toBe(429)
    expect(await lastResponse.json()).toEqual({ error: 'Rate limit exceeded' })
  })
})
