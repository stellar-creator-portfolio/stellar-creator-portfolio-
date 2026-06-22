import { describe, it, expect, beforeEach } from 'vitest'
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
    // Ensure a bounty exists so createEscrow can resolve creatorId
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
    // creatorId comes from bounty, NOT from clientUserId
    expect(e.clientUserId).toBe(CREATOR_ID)
  })

  it('throws when bounty not found', async () => {
    await expect(
      createEscrow({ bountyId: 'nonexistent', clientUserId: 'u1', amountCents: 1000 }),
    ).rejects.toThrow('Bounty nonexistent not found')
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

    // Fire two concurrent markReleased calls — only one should succeed
    const [r1, r2] = await Promise.allSettled([
      markReleased(e.id, 'receipt-a'),
      markReleased(e.id, 'receipt-b'),
    ])

    // One fulfilled, one rejected with EscrowConflictError
    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled')
    const rejected = [r1, r2].filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(EscrowConflictError)

    // Final state is released with version bumped exactly once
    const final = await getEscrow(e.id)
    expect(final?.status).toBe('released')
    expect(final?.version).toBe(4) // 1 init, 2 attachPI, 3 funded, 4 released
  })
})
