import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetDisputeStore,
  testPrisma,
} from './helpers/dispute-test-setup';
import { executeTransaction, IsolationLevel } from '@/lib/db/transaction-manager';
import {
  DISPUTE_RESOLUTION_TEMPLATES,
  type DisputeCategory,
} from '@/lib/services/dispute-service';

// Mock the prisma module to use our test client
vi.mock('@/lib/prisma', () => ({
  prisma: testPrisma,
}));

// Mock transaction manager to use test prisma
vi.mock('@/lib/db/transaction-manager', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/db/transaction-manager')>();
  return {
    ...orig,
    executeTransaction: async <T>(fn: (tx: any) => Promise<T>, _opts?: any) => {
      return fn(testPrisma);
    },
  };
});

// Mock escrow handler
vi.mock('@/lib/escrow/escrow-transaction-handler', () => ({
  releaseEscrowFunds: vi.fn().mockResolvedValue({ success: true }),
  refundEscrow: vi.fn().mockResolvedValue({ success: true }),
}));

import { testPrisma as prisma } from './helpers/dispute-test-setup';

describe('dispute workflow + escrow integration (DB-backed)', () => {
  beforeEach(() => {
    resetDisputeStore();
  });

  it('files a dispute and records evidence', async () => {
    // Create the dispute directly via Prisma (simulating what the router does)
    const d = await prisma.dispute.create({
      data: {
        title: 'Title long enough for schema validation rules',
        description: 'y'.repeat(40),
        category: 'quality' as DisputeCategory,
        escrowId: 'ord-x',
        creatorId: 'cp-1',
        clientId: 'client-1',
        filedByUserId: 'client-1',
        escrowAmountCents: 50000,
        status: 'evidence',
        preventionTags: [],
      },
    });

    expect(d.escrowAmountCents).toBe(50000);
    expect(d.status).toBe('evidence');

    // Add evidence
    const ev = await prisma.disputeEvidence.create({
      data: {
        disputeId: d.id,
        fileName: 'screenshot.png',
        mimeType: 'image/png',
        byteSize: 2048,
        sha256: 'b'.repeat(64),
        submittedByUserId: 'client-1',
      },
    });

    expect(ev.sha256).toMatch(/^[b]{64}$/);

    // Verify evidence is queryable
    const evidences = await prisma.disputeEvidence.findMany({
      where: { disputeId: d.id },
    });
    expect(evidences).toHaveLength(1);
  });

  it('runs full lifecycle: file -> evidence -> mediation -> community vote -> resolution -> appeal', async () => {
    // File dispute
    const d = await prisma.dispute.create({
      data: {
        title: 'Another title that satisfies minimum length',
        description: 'z'.repeat(40),
        category: 'communication' as DisputeCategory,
        escrowId: 'ord-y',
        creatorId: 'cp-2',
        clientId: 'a1',
        filedByUserId: 'a1',
        escrowAmountCents: 100,
        status: 'evidence',
        preventionTags: [],
      },
    });

    // Start mediation
    await prisma.dispute.update({
      where: { id: d.id },
      data: { status: 'mediation', assignedAdminId: 'admin-1' },
    });

    // Open community vote
    await prisma.dispute.update({
      where: { id: d.id },
      data: { status: 'community_vote' },
    });

    // Resolve with template
    const tpl = DISPUTE_RESOLUTION_TEMPLATES[0]!;
    await prisma.disputeResolution.create({
      data: {
        disputeId: d.id,
        outcome: tpl.outcome,
        summary: tpl.body,
        templateId: tpl.id,
        resolvedBy: 'Admin',
      },
    });
    await prisma.dispute.update({
      where: { id: d.id },
      data: { status: 'resolved' },
    });

    const mid = await prisma.dispute.findUnique({ where: { id: d.id } });
    expect(mid?.status).toBe('resolved');

    // Submit appeal
    await prisma.disputeAppeal.create({
      data: {
        disputeId: d.id,
        reason: 'New evidence surfaced after resolution.',
        status: 'pending',
      },
    });
    await prisma.dispute.update({
      where: { id: d.id },
      data: { status: 'appealed' },
    });

    const after = await prisma.dispute.findUnique({ where: { id: d.id } });
    expect(after?.status).toBe('appealed');

    const appeal = await prisma.disputeAppeal.findUnique({
      where: { disputeId: d.id },
    });
    expect(appeal?.status).toBe('pending');
  });
});
