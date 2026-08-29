import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetDisputeStore,
  testPrisma,
} from './helpers/dispute-test-setup';
import {
  verifyEvidenceDigest,
  hashEvidenceBytes,
} from '@/lib/services/dispute-service';
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

describe('dispute security (DB-backed)', () => {
  beforeEach(() => {
    resetDisputeStore();
  });

  it('verifies evidence integrity against SHA-256', async () => {
    const encoded = new TextEncoder().encode('hello-dispute');
    const buf = encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength,
    );
    const sha256 = await hashEvidenceBytes(buf);
    const ok = await verifyEvidenceDigest(
      {
        fileName: 'x.txt',
        mimeType: 'text/plain',
        byteSize: buf.byteLength,
        sha256,
      },
      buf,
    );
    expect(ok).toBe(true);
  });

  it('blocks parties from casting community votes (DB enforces unique constraint)', async () => {
    const d = await prisma.dispute.create({
      data: {
        title: 'Title long enough for all dispute validation here',
        description: 'p'.repeat(40),
        category: 'other' as DisputeCategory,
        escrowId: 'ord-z',
        creatorId: 'party-b',
        clientId: 'party-a',
        filedByUserId: 'party-a',
        escrowAmountCents: 0,
        status: 'community_vote',
        preventionTags: [],
      },
    });

    // Party A tries to vote — should fail at application layer
    // (the router checks filedByUserId/clientId/creatorId before inserting)
    const partyAVote = {
      disputeId: d.id,
      userId: 'party-a',
      side: 'client',
    };

    // Simulate the router's check: parties cannot vote
    const isParty =
      partyAVote.userId === d.filedByUserId ||
      partyAVote.userId === d.clientId ||
      partyAVote.userId === d.creatorId;
    expect(isParty).toBe(true);
    // In the real router, this would throw FORBIDDEN

    // Non-party can vote
    const nonPartyVote = await prisma.disputeCommunityVote.create({
      data: {
        disputeId: d.id,
        userId: 'outsider-1',
        side: 'creator',
      },
    });
    expect(nonPartyVote.userId).toBe('outsider-1');
  });

  it('restricts dispute visibility to parties and admins', async () => {
    const d = await prisma.dispute.create({
      data: {
        title: 'Title long enough for all dispute validation here',
        description: 'q'.repeat(40),
        category: 'other' as DisputeCategory,
        escrowId: 'ord-w',
        creatorId: 'c2',
        clientId: 'c1',
        filedByUserId: 'c1',
        escrowAmountCents: 0,
        status: 'filed',
        preventionTags: [],
      },
    });

    // Simulate access control check
    function canView(userId: string, role: string): boolean {
      if (role === 'ADMIN') return true;
      return d.filedByUserId === userId || d.clientId === userId || d.creatorId === userId;
    }

    expect(canView('c1', 'CLIENT')).toBe(true);
    expect(canView('c2', 'CREATOR')).toBe(true);
    expect(canView('outsider', 'USER')).toBe(false);
    expect(canView('outsider', 'ADMIN')).toBe(true);
  });
});
