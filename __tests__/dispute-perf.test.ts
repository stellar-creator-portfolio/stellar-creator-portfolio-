import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetDisputeStore,
  testPrisma,
} from './helpers/dispute-test-setup';
import type { DisputeCategory } from '@/lib/services/dispute-service';

vi.mock('@/lib/prisma', () => ({
  prisma: testPrisma,
}));

vi.mock('@/lib/db/transaction-manager', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/db/transaction-manager')>();
  return {
    ...orig,
    executeTransaction: async <T>(fn: (tx: any) => Promise<T>) => fn(testPrisma),
  };
});

vi.mock('@/lib/escrow/escrow-transaction-handler', () => ({
  releaseEscrowFunds: vi.fn().mockResolvedValue({ success: true }),
  refundEscrow: vi.fn().mockResolvedValue({ success: true }),
}));

import { testPrisma as prisma } from './helpers/dispute-test-setup';

describe('dispute performance (DB-backed)', () => {
  beforeEach(() => {
    resetDisputeStore();
  });

  it('handles many concurrent dispute filings', async () => {
    const n = 40;
    const base = 'Title long enough for all dispute validation rules here ';

    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        prisma.dispute.create({
          data: {
            title: `${base}${i}`,
            description: 'd'.repeat(40),
            category: 'other' as DisputeCategory,
            escrowId: `ord-${i}`,
            creatorId: `cp-${i}`,
            clientId: `u-${i}`,
            filedByUserId: `u-${i}`,
            escrowAmountCents: i % 5 === 0 ? 100 : 0,
            status: 'filed',
            preventionTags: [],
          },
        }),
      ),
    );

    const all = await prisma.dispute.findMany();
    expect(all.length).toBeGreaterThanOrEqual(n);
  });
});
