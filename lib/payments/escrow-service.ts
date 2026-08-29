/**
 * Bounty escrow state machine (Stripe PaymentIntents with `capture_method: manual`).
 * Funds are authorized then captured on release, or cancelled/refunded.
 * In-memory store suitable for demo; persist to DB for production.
 */

export type EscrowStatus =
  | 'pending_funding'
  | 'funded_authorized'
  | 'released'
  | 'refunded'
  | 'failed'
  | 'disputed'
  | 'split_released'

export interface EscrowRecord {
  id: string
  bountyId: string
  clientUserId: string
  freelancerUserId?: string
  amountCents: number
  currency: string
  /** Platform fee in minor units (e.g. cents). */
  platformFeeCents: number
  paymentIntentId?: string
  status: EscrowStatus
  receiptUrl?: string
  failureMessage?: string
  createdAt: string
  updatedAt: string
  /** Dispute freeze metadata (dual-ledger integrity) */
  disputedAt?: string
  disputeReason?: string
  appealDeadline?: string
  stripeBlocked?: boolean
  disputedPaymentIntentId?: string
  /** Fiat-pegged settlement (from upstream) */
  usdAmountCents?: number | null
  lockedPriceMicroUsd?: number | null
  usedFallbackPrice?: boolean | null
  settlementTxHashes?: string[]
  settlementRecoveryNote?: string | null
  version?: number
  releasedAt?: string
  refundedAt?: string
}

type Store = {
  escrows: Map<string, EscrowRecord>
  byPaymentIntent: Map<string, string>
}

function getStore(): Store {
  const g = globalThis as unknown as { __escrowStore?: Store }
  if (!g.__escrowStore) {
    g.__escrowStore = {
      escrows: new Map(),
      byPaymentIntent: new Map(),
    }
  }
  return g.__escrowStore
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Default platform fee: 10% of bounty amount (basis points style via integer math). */
export function computePlatformFeeCents(amountCents: number, feeBps: number = 1000): number {
  if (amountCents <= 0) return 0
  return Math.round((amountCents * feeBps) / 10000)
}

export function computeFreelancerPayoutCents(amountCents: number, platformFeeCents: number): number {
  return Math.max(0, amountCents - platformFeeCents)
}

export class EscrowConflictError extends Error {
  public readonly escrowId: string;
  public readonly expectedVersion: number;
  constructor(escrowId: string, expectedVersion: number) {
    super(`Escrow ${escrowId} version ${expectedVersion} was modified concurrently`);
    this.name = 'EscrowConflictError';
    this.escrowId = escrowId;
    this.expectedVersion = expectedVersion;
  }
}

export function createEscrow(params: {
  bountyId: string
  clientUserId: string
  amountCents: number
  currency?: string
  feeBps?: number
  usdAmountCents?: number
  lockedPriceMicroUsd?: number
  usedFallbackPrice?: boolean
  settlementTxHashes?: string[]
  minXlmOut?: number
}): EscrowRecord {
  const currency = (params.currency ?? 'usd').toLowerCase()
  const platformFeeCents = computePlatformFeeCents(params.amountCents, params.feeBps ?? 1000)
  const id = crypto.randomUUID()
  const ts = nowIso()
  const record: EscrowRecord = {
    id,
    bountyId: params.bountyId,
    clientUserId: params.clientUserId,
    amountCents: params.amountCents,
    currency,
    platformFeeCents,
    status: 'pending_funding',
    createdAt: ts,
    updatedAt: ts,
    usdAmountCents: params.usdAmountCents ?? null,
    lockedPriceMicroUsd: params.lockedPriceMicroUsd ?? null,
    usedFallbackPrice: params.usedFallbackPrice ?? null,
    settlementTxHashes: params.settlementTxHashes ?? [],
    version: 1,
  }
  getStore().escrows.set(id, record)
  return record
}

export function getEscrow(id: string): EscrowRecord | undefined {
  return getStore().escrows.get(id)
}

export function attachPaymentIntent(escrowId: string, paymentIntentId: string): EscrowRecord | null {
  const store = getStore()
  const e = store.escrows.get(escrowId)
  if (!e) return null
  e.paymentIntentId = paymentIntentId
  e.updatedAt = nowIso()
  store.byPaymentIntent.set(paymentIntentId, escrowId)
  return e
}

export function findEscrowByPaymentIntent(paymentIntentId: string): EscrowRecord | undefined {
  const id = getStore().byPaymentIntent.get(paymentIntentId)
  if (!id) return undefined
  return getStore().escrows.get(id)
}

export function markFundedAuthorized(escrowId: string, receiptUrl?: string): EscrowRecord | null {
  const e = getStore().escrows.get(escrowId)
  if (!e) return null
  // Block if disputed - payout integrity: cannot fund when under dispute
  if (e.status === 'disputed') {
    e.failureMessage = 'Escrow is disputed - capture blocked'
    return null
  }
  e.status = 'funded_authorized'
  e.receiptUrl = receiptUrl ?? e.receiptUrl
  e.updatedAt = nowIso()
  return e
}

export function markReleased(escrowId: string, receiptUrl?: string): EscrowRecord | null {
  const e = getStore().escrows.get(escrowId)
  if (!e) return null
  // Payout-integrity: block release while disputed (both ledgers frozen)
  if (e.status === 'disputed') {
    throw new Error('Escrow is disputed - release blocked until resolution and appeal window expires')
  }
  if (e.stripeBlocked) {
    throw new Error('Stripe capture blocked - escrow under dispute')
  }
  e.status = 'released'
  e.receiptUrl = receiptUrl ?? e.receiptUrl
  e.updatedAt = nowIso()
  return e
}

export function markRefunded(escrowId: string): EscrowRecord | null {
  const e = getStore().escrows.get(escrowId)
  if (!e) return null
  if (e.status === 'disputed') {
    throw new Error('Escrow is disputed - refund blocked until resolution')
  }
  e.status = 'refunded'
  e.updatedAt = nowIso()
  return e
}

/** Freeze escrow for dispute - blocks both Stripe capture and on-chain release */
export function markDisputed(escrowId: string, reason?: string): EscrowRecord | null {
  const e = getStore().escrows.get(escrowId)
  if (!e) return null
  if (e.status === 'disputed') return e
  if (e.status === 'released' || e.status === 'refunded' || e.status === 'failed') {
    throw new Error(`Cannot dispute escrow in status ${e.status}`)
  }
  e.status = 'disputed'
  e.disputedAt = nowIso()
  e.disputeReason = reason
  e.stripeBlocked = true
  e.disputedPaymentIntentId = e.paymentIntentId
  e.updatedAt = nowIso()
  return e
}

export function isDisputed(escrowId: string): boolean {
  return getStore().escrows.get(escrowId)?.status === 'disputed'
}

/** Check if Stripe capture should be blocked for a PaymentIntent */
export function isStripeCaptureBlocked(paymentIntentId: string): boolean {
  const escrow = findEscrowByPaymentIntent(paymentIntentId)
  if (!escrow) return false
  return escrow.status === 'disputed' || !!escrow.stripeBlocked
}

/** Check if capture is allowed (not disputed) */
export function canCapturePaymentIntent(paymentIntentId: string): boolean {
  return !isStripeCaptureBlocked(paymentIntentId)
}

/** Cancel blocked PaymentIntent when dispute is filed (Stripe hold path) */
export function cancelDisputedPaymentIntent(paymentIntentId: string): boolean {
  const escrow = findEscrowByPaymentIntent(paymentIntentId)
  if (!escrow) return false
  if (escrow.status !== 'disputed') return false
  escrow.stripeBlocked = true
  escrow.updatedAt = nowIso()
  return true
}

/** Saga: settle disputed escrow with outcome - handles split atomically */
export function settleDisputedEscrow(
  escrowId: string,
  outcome: 'favor_client' | 'favor_creator' | 'split' | 'dismissed',
  split?: { clientCents: number; creatorCents: number }
): EscrowRecord | null {
  const e = getStore().escrows.get(escrowId)
  if (!e) return null
  if (e.status !== 'disputed') throw new Error('Escrow is not disputed - cannot settle')
  // Check appeal window if set
  if (e.appealDeadline && new Date(e.appealDeadline).getTime() > Date.now()) {
    throw new Error('Appeal window not expired - cannot settle')
  }
  if (outcome === 'favor_client') {
    e.status = 'refunded'
    e.stripeBlocked = false
  } else if (outcome === 'favor_creator') {
    e.status = 'released'
    e.stripeBlocked = false
  } else if (outcome === 'split') {
    if (!split) throw new Error('Split amounts required')
    if (split.clientCents + split.creatorCents !== e.amountCents) {
      throw new Error('Split amounts must equal escrow amount')
    }
    e.status = 'split_released'
    e.stripeBlocked = false
    // In production this would do two Stripe transfers / two Soroban transfers atomically
  } else if (outcome === 'dismissed') {
    e.status = 'funded_authorized'
    e.stripeBlocked = false
  }
  e.updatedAt = nowIso()
  if (outcome !== 'dismissed') {
    e.releasedAt = nowIso() as unknown as string // for compatibility, not in type but store
  }
  return e
}

/** Set appeal window deadline (on-chain timelock mirror) */
export function setAppealDeadline(escrowId: string, deadlineIso: string): EscrowRecord | null {
  const e = getStore().escrows.get(escrowId)
  if (!e) return null
  e.appealDeadline = deadlineIso
  e.updatedAt = nowIso()
  return e
}

export function isAppealWindowActive(escrowId: string): boolean {
  const e = getStore().escrows.get(escrowId)
  if (!e?.appealDeadline) return false
  return new Date(e.appealDeadline).getTime() > Date.now()
}

export function markFailed(escrowId: string, message?: string): EscrowRecord | null {
  const e = getStore().escrows.get(escrowId)
  if (!e) return null
  e.status = 'failed'
  e.failureMessage = message
  e.updatedAt = nowIso()
  return e
}

export function listEscrowsForUser(userId: string): EscrowRecord[] {
  return Array.from(getStore().escrows.values())
    .filter((e) => e.clientUserId === userId || e.freelancerUserId === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function __resetEscrowStoreForTests(): void {
  const g = globalThis as unknown as { __escrowStore?: Store }
  g.__escrowStore = {
    escrows: new Map(),
    byPaymentIntent: new Map(),
  }
}
