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

describe('escrow-service', () => {
  beforeEach(async () => {
    await __resetEscrowStoreForTests()
  })

  it('computes platform fee at 10% by default', () => {
    expect(computePlatformFeeCents(10_000)).toBe(1000)
    expect(computePlatformFeeCents(100)).toBe(10)
  })

  it('computes freelancer payout after fee', () => {
    expect(computeFreelancerPayoutCents(10_000, 1000)).toBe(9000)
  })

  it('creates escrow in pending_funding', async () => {
    const e = await createEscrow({
      bountyId: 'b-1',
      clientUserId: 'user-1',
      amountCents: 5000,
    })
    expect(e.status).toBe('pending_funding')
    expect(e.platformFeeCents).toBe(500)
  })

  it('transitions funded -> released', async () => {
    const e = await createEscrow({
      bountyId: 'b-1',
      clientUserId: 'user-1',
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
      bountyId: 'b-1',
      clientUserId: 'user-1',
      amountCents: 2000,
    })
    await markRefunded(e.id)
    expect((await getEscrow(e.id))?.status).toBe('refunded')
  })

  it('only one concurrent markReleased succeeds (optimistic locking)', async () => {
    const e = await createEscrow({
      bountyId: 'b-1',
      clientUserId: 'user-1',
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
