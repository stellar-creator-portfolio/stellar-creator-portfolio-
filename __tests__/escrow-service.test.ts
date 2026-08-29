import { describe, it, expect, beforeEach, vi } from 'vitest'

type BountyRow = {
  id: string
  creatorId: string
  title: string
  description: string
  budget: number
  deadline: Date
}

type EscrowRow = {
  id: string
  bountyId: string
  creatorId: string
  clientId: string
  freelancerUserId: string | null
  amount: number
  currency: string
  platformFeeCents: number
  paymentIntentId: string | null
  status: string
  receiptUrl: string | null
  failureMessage: string | null
  usdAmountCents: number | null
  lockedPriceMicroUsd: number | null
  usedFallbackPrice: boolean | null
  settlementTxHashes: string[]
  settlementRecoveryNote: string | null
  version: number
  createdAt: Date
  updatedAt: Date
  releasedAt: Date | null
  refundedAt: Date | null
}

const { bountyStore, escrowStore } = vi.hoisted(() => ({
  bountyStore: new Map<string, BountyRow>(),
  escrowStore: new Map<string, EscrowRow>(),
}))

function cloneEscrow(row: EscrowRow): EscrowRow {
  return {
    ...row,
    settlementTxHashes: [...row.settlementTxHashes],
  }
}

vi.mock('@/lib/prisma', () => {
  const prisma = {
    bounty: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = bountyStore.get(where.id)
        const row = existing ? { ...existing, ...update } : { ...create }
        bountyStore.set(where.id, row)
        return row
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return bountyStore.get(where.id) ?? null
      }),
    },
    escrow: {
      create: vi.fn(async ({ data }: any) => {
        const now = new Date()
        const row: EscrowRow = {
          id: `escrow_${escrowStore.size + 1}`,
          bountyId: data.bountyId,
          creatorId: data.creatorId,
          clientId: data.clientId,
          freelancerUserId: data.freelancerUserId ?? null,
          amount: data.amount,
          currency: data.currency ?? 'usd',
          platformFeeCents: data.platformFeeCents ?? 0,
          paymentIntentId: data.paymentIntentId ?? null,
          status: data.status ?? 'active',
          receiptUrl: data.receiptUrl ?? null,
          failureMessage: data.failureMessage ?? null,
          usdAmountCents: data.usdAmountCents ?? null,
          lockedPriceMicroUsd: data.lockedPriceMicroUsd ?? null,
          usedFallbackPrice: data.usedFallbackPrice ?? null,
          settlementTxHashes: data.settlementTxHashes ?? [],
          settlementRecoveryNote: data.settlementRecoveryNote ?? null,
          version: 1,
          createdAt: now,
          updatedAt: now,
          releasedAt: null,
          refundedAt: null,
        }
        escrowStore.set(row.id, row)
        return cloneEscrow(row)
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const row = escrowStore.get(where.id)
        return row ? cloneEscrow(row) : null
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        for (const row of escrowStore.values()) {
          if (where.paymentIntentId && row.paymentIntentId === where.paymentIntentId) {
            return cloneEscrow(row)
          }
        }
        return null
      }),
      findMany: vi.fn(async () => {
        return [...escrowStore.values()].map(cloneEscrow)
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = escrowStore.get(where.id)
        if (!row || (where.version !== undefined && row.version !== where.version)) {
          const error: any = new Error('Record not found')
          error.code = 'P2025'
          throw error
        }

        const next: EscrowRow = {
          ...row,
          ...data,
          version: data.version?.increment ? row.version + data.version.increment : row.version,
          updatedAt: new Date(),
        }
        delete (next as any).version.increment
        escrowStore.set(row.id, next)
        return cloneEscrow(next)
      }),
      deleteMany: vi.fn(async () => {
        escrowStore.clear()
      }),
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  }

  return { prisma }
})

import {
  EscrowConflictError,
  __resetEscrowStoreForTests,
  computeFreelancerPayoutCents,
  computePlatformFeeCents,
  createEscrow,
  attachPaymentIntent,
  markFundedAuthorized,
  markReleased,
  markRefunded,
  getEscrow,
} from '@/lib/payments/escrow-service'
import { prisma } from '@/lib/prisma'

const BOUNTY_ID = 'b-test-escrow'
const CREATOR_ID = 'creator-test'
const CLIENT_ID = 'user-1'

describe('escrow-service', () => {
  beforeEach(async () => {
    await __resetEscrowStoreForTests()
    bountyStore.clear()
    await prisma.bounty.upsert({
      where: { id: BOUNTY_ID },
      update: {},
      create: {
        id: BOUNTY_ID,
        creatorId: CREATOR_ID,
        title: 'Test Bounty for Escrow',
        description: 'Auto-created by escrow tests',
        budget: 5000,
        deadline: new Date('2027-01-01'),
      },
    })
  })

  it('computes platform fee at 10% by default', () => {
    expect(computePlatformFeeCents(10_000)).toBe(1000)
    expect(computePlatformFeeCents(100)).toBe(10)
  })

  it('computes freelancer payout after fee', () => {
    expect(computeFreelancerPayoutCents(10_000, 1000)).toBe(9000)
  })

  it('creates escrow in pending_funding with correct creatorId/clientId', async () => {
    const e = await createEscrow({
      bountyId: BOUNTY_ID,
      clientUserId: CLIENT_ID,
      amountCents: 5000,
    })

    expect(e.status).toBe('pending_funding')
    expect(e.platformFeeCents).toBe(500)
    expect(e.bountyId).toBe(BOUNTY_ID)
    expect(e.clientUserId).toBe(CLIENT_ID)
  })

  it('throws when bounty not found', async () => {
    await expect(
      createEscrow({ bountyId: 'nonexistent', clientUserId: 'u1', amountCents: 1000 }),
    ).rejects.toThrow('Bounty nonexistent not found')
  })

  it('records fiat-pegged settlement metadata when USD funding is requested', async () => {
    const executor = vi.fn(async () => ({
      lockedPriceMicroUsd: 120_000,
      usedFallbackPrice: false,
      xlmAmount: 416,
      txHashes: ['swap_hash', 'deposit_hash'],
    }))

    const e = await createEscrow({
      bountyId: BOUNTY_ID,
      clientUserId: CLIENT_ID,
      amountCents: 50_000,
      usdAmountCents: 50_000,
      minXlmOut: 395,
      fiatSettlementExecutor: executor,
    })

    expect(executor).toHaveBeenCalledWith({
      escrowId: e.id,
      bountyId: BOUNTY_ID,
      clientUserId: CLIENT_ID,
      usdAmountCents: 50_000,
      minXlmOut: 395,
    })
    expect(e.lockedPriceMicroUsd).toBe(120_000)
    expect(e.usedFallbackPrice).toBe(false)
    expect(e.settlementTxHashes).toEqual(['swap_hash', 'deposit_hash'])
  })

  it('transitions funded -> released', async () => {
    const e = await createEscrow({
      bountyId: BOUNTY_ID,
      clientUserId: CLIENT_ID,
      amountCents: 2000,
    })
    await attachPaymentIntent(e.id, 'pi_test')
    await markFundedAuthorized(e.id)
    expect((await getEscrow(e.id))?.status).toBe('funded_authorized')
    await markReleased(e.id, 'https://pay.stripe.com/receipt')
    expect((await getEscrow(e.id))?.status).toBe('released')
    expect((await getEscrow(e.id))?.receiptUrl).toBe('https://pay.stripe.com/receipt')
  })

  it('supports refund path', async () => {
    const e = await createEscrow({
      bountyId: BOUNTY_ID,
      clientUserId: CLIENT_ID,
      amountCents: 2000,
    })
    await markRefunded(e.id)
    expect((await getEscrow(e.id))?.status).toBe('refunded')
  })

  it('only one concurrent markReleased succeeds (optimistic locking)', async () => {
    const e = await createEscrow({
      bountyId: BOUNTY_ID,
      clientUserId: CLIENT_ID,
      amountCents: 5000,
    })
    await attachPaymentIntent(e.id, 'pi_concurrent')
    await markFundedAuthorized(e.id)

    const [r1, r2] = await Promise.allSettled([
      markReleased(e.id, 'receipt-a'),
      markReleased(e.id, 'receipt-b'),
    ])

    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled')
    const rejected = [r1, r2].filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(EscrowConflictError)

    const final = await getEscrow(e.id)
    expect(final?.status).toBe('released')
    expect(final?.version).toBe(4)
  })
})
