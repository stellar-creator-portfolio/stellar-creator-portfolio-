/**
 * Bounty escrow state machine (Stripe PaymentIntents with `capture_method: manual`).
 * Funds are authorized then captured on release, or cancelled/refunded.
 *
 * Persisted to PostgreSQL via Prisma with optimistic-locking (version field)
 * to prevent race conditions on concurrent state transitions.
 */

import { prisma } from "@/lib/prisma";
import type { Escrow } from "@prisma/client";

/** Thrown when an optimistic-locking version check fails (concurrent modification). */
export class EscrowConflictError extends Error {
  public readonly escrowId: string;
  public readonly expectedVersion: number;

  constructor(escrowId: string, expectedVersion: number) {
    super(
      `Escrow ${escrowId} version ${expectedVersion} was modified concurrently`,
    );
    this.name = "EscrowConflictError";
    this.escrowId = escrowId;
    this.expectedVersion = expectedVersion;
  }
}

export type EscrowStatus =
  | "pending_funding"
  | "funded_authorized"
  | "released"
  | "refunded"
  | "failed";

// Map Prisma Escrow rows to the public shape
export interface EscrowRecord {
  id: string;
  bountyId: string;
  clientUserId: string;
  freelancerUserId?: string | null;
  amountCents: number;
  currency: string;
  platformFeeCents: number;
  paymentIntentId?: string | null;
  status: EscrowStatus;
  receiptUrl?: string | null;
  failureMessage?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

function toRecord(row: Escrow): EscrowRecord {
  return {
    id: row.id,
    bountyId: row.bountyId,
    clientUserId: row.clientId,
    freelancerUserId: row.freelancerUserId,
    amountCents: row.amount,
    currency: row.currency,
    platformFeeCents: row.platformFeeCents,
    paymentIntentId: row.paymentIntentId,
    status: row.status as EscrowStatus,
    receiptUrl: row.receiptUrl,
    failureMessage: row.failureMessage,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Default platform fee: 10% of bounty amount (basis points style via integer math). */
export function computePlatformFeeCents(
  amountCents: number,
  feeBps: number = 1000,
): number {
  if (amountCents <= 0) return 0;
  return Math.round((amountCents * feeBps) / 10000);
}

export function computeFreelancerPayoutCents(
  amountCents: number,
  platformFeeCents: number,
): number {
  return Math.max(0, amountCents - platformFeeCents);
}

export async function createEscrow(params: {
  bountyId: string;
  clientUserId: string;
  amountCents: number;
  currency?: string;
  feeBps?: number;
}): Promise<EscrowRecord> {
  const currency = (params.currency ?? "usd").toLowerCase();
  const platformFeeCents = computePlatformFeeCents(
    params.amountCents,
    params.feeBps ?? 1000,
  );

  // Resolve the bounty's creator (freelancer who will receive payout on release).
  // creatorId = freelancer; clientId = funder — they are distinct roles.
  const bounty = await prisma.bounty.findUnique({
    where: { id: params.bountyId },
  });
  if (!bounty) throw new Error(`Bounty ${params.bountyId} not found`);

  const row = await prisma.escrow.create({
    data: {
      bountyId: params.bountyId,
      creatorId: bounty.creatorId,
      clientId: params.clientUserId,
      amount: params.amountCents,
      currency,
      platformFeeCents,
      status: "pending_funding",
    },
  });

  return toRecord(row);
}

export async function getEscrow(
  id: string,
): Promise<EscrowRecord | null> {
  const row = await prisma.escrow.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

export async function attachPaymentIntent(
  escrowId: string,
  paymentIntentId: string,
): Promise<EscrowRecord | null> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.escrow.findUnique({
      where: { id: escrowId },
    });
    if (!existing) return null;

    const row = await tx.escrow.update({
      where: { id: escrowId, version: existing.version },
      data: {
        paymentIntentId,
        version: { increment: 1 },
      },
    });

    return toRecord(row);
  });
}

export async function findEscrowByPaymentIntent(
  paymentIntentId: string,
): Promise<EscrowRecord | null> {
  const row = await prisma.escrow.findFirst({
    where: { paymentIntentId },
  });
  return row ? toRecord(row) : null;
}

/**
 * Atomically transition escrow status using optimistic locking.
 * Throws EscrowConflictError if the record was modified concurrently (version mismatch).
 */
async function transitionStatus(
  escrowId: string,
  status: EscrowStatus,
  extras?: {
    receiptUrl?: string;
    failureMessage?: string;
    releasedAt?: Date;
    refundedAt?: Date;
  },
): Promise<EscrowRecord | null> {
  const existing = await prisma.escrow.findUnique({
    where: { id: escrowId },
  });
  if (!existing) return null;

  try {
    const row = await prisma.escrow.update({
      where: { id: escrowId, version: existing.version },
      data: {
        status,
        receiptUrl: extras?.receiptUrl ?? undefined,
        failureMessage: extras?.failureMessage ?? undefined,
        releasedAt: extras?.releasedAt ?? undefined,
        refundedAt: extras?.refundedAt ?? undefined,
        version: { increment: 1 },
      },
    });
    return toRecord(row);
  } catch (err: any) {
    // Prisma throws P2025 when version check fails (record not found by composite where)
    if (err?.code === "P2025") {
      throw new EscrowConflictError(escrowId, existing.version);
    }
    throw err;
  }
}

export async function markFundedAuthorized(
  escrowId: string,
  receiptUrl?: string,
): Promise<EscrowRecord | null> {
  return transitionStatus(escrowId, "funded_authorized", { receiptUrl });
}

export async function markReleased(
  escrowId: string,
  receiptUrl?: string,
): Promise<EscrowRecord | null> {
  return transitionStatus(escrowId, "released", {
    receiptUrl,
    releasedAt: new Date(),
  });
}

export async function markRefunded(
  escrowId: string,
): Promise<EscrowRecord | null> {
  return transitionStatus(escrowId, "refunded", { refundedAt: new Date() });
}

export async function markFailed(
  escrowId: string,
  message?: string,
): Promise<EscrowRecord | null> {
  return transitionStatus(escrowId, "failed", { failureMessage: message });
}

export async function listEscrowsForUser(
  userId: string,
): Promise<EscrowRecord[]> {
  const rows = await prisma.escrow.findMany({
    where: {
      OR: [{ clientId: userId }, { freelancerUserId: userId }],
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toRecord);
}

/** Wipes all escrow rows. Only for test teardown. */
export async function __resetEscrowStoreForTests(): Promise<void> {
  await prisma.escrow.deleteMany();
}
