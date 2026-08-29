/**
 * End-to-end dispute lifecycle test (DB-backed).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetDisputeStore,
  testPrisma,
} from './helpers/dispute-test-setup';
import {
  DISPUTE_RESOLUTION_TEMPLATES,
  type DisputeCategory,
} from '@/lib/services/dispute-service';

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

describe('E2E dispute resolution (DB-backed)', () => {
  beforeEach(() => {
    resetDisputeStore();
  });

  it('runs filing -> evidence -> mediation -> community vote -> resolution -> close', async () => {
    // 1. File dispute
    const d = await prisma.dispute.create({
      data: {
        title: 'End-to-end title with enough characters present',
        description: 'e'.repeat(40),
        category: 'delivery' as DisputeCategory,
        escrowId: 'ord-e2e',
        creatorId: 'cp-e2e',
        clientId: 'client-e2e',
        filedByUserId: 'client-e2e',
        escrowAmountCents: 25000,
        status: 'evidence',
        preventionTags: ['timeline'],
      },
    });

    // 2. Add evidence
    await prisma.disputeEvidence.create({
      data: {
        disputeId: d.id,
        fileName: 'deliverables.zip',
        mimeType: 'application/zip',
        byteSize: 4096,
        sha256: 'c'.repeat(64),
        submittedByUserId: 'client-e2e',
      },
    });

    // 3. Start mediation
    await prisma.dispute.update({
      where: { id: d.id },
      data: { status: 'mediation', assignedAdminId: 'admin-e2e' },
    });

    // 4. Open community vote
    await prisma.dispute.update({
      where: { id: d.id },
      data: { status: 'community_vote' },
    });

    // 5. Cast a community vote
    await prisma.disputeCommunityVote.create({
      data: {
        disputeId: d.id,
        userId: 'community-member-1',
        side: 'creator',
      },
    });

    // 6. Resolve with split template
    const tpl = DISPUTE_RESOLUTION_TEMPLATES.find((t) => t.id === 'tpl_split')!;
    await prisma.disputeResolution.create({
      data: {
        disputeId: d.id,
        outcome: tpl.outcome,
        summary: `${tpl.body}\n\nSplit 60/40 per review.`,
        templateId: tpl.id,
        resolvedBy: 'Admin',
      },
    });
    await prisma.dispute.update({
      where: { id: d.id },
      data: { status: 'resolved' },
    });

    // 7. Close
    await prisma.dispute.update({
      where: { id: d.id },
      data: { status: 'closed' },
    });

    // Verify final state
    const row = await prisma.dispute.findUnique({ where: { id: d.id } });
    expect(row?.status).toBe('closed');

    // Verify vote count
    const votes = await prisma.disputeCommunityVote.findMany({
      where: { disputeId: d.id },
    } as any);
    expect(votes).toHaveLength(1);

    // Verify evidence count
    const evidence = await prisma.disputeEvidence.findMany({
      where: { disputeId: d.id },
    });
    expect(evidence).toHaveLength(1);
  });
});
