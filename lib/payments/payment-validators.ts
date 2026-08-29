import { z } from 'zod'

export const bountyEscrowPaymentSchema = z.object({
  type: z.literal('bounty_escrow'),
  bountyId: z.string().min(1).max(128),
  amountCents: z.number().int().positive().max(99_999_999),
  currency: z.string().length(3).optional().default('usd'),
})

export const subscriptionCheckoutSchema = z.object({
  type: z.literal('subscription'),
  priceId: z.string().min(1).max(128),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
})

export const escrowReleaseSchema = z.object({
  type: z.literal('escrow_release'),
  escrowId: z.string().uuid(),
})

export const escrowRefundSchema = z.object({
  type: z.literal('escrow_refund'),
  escrowId: z.string().uuid(),
})

const positiveIntegerString = z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n)

export const lockedOracleQuoteSchema = z.object({
  version: z.literal(1),
  quoteId: z.string().uuid(),
  bountyId: z.string().min(1).max(128),
  assetContract: z.string().min(1).max(128),
  usdAmountMicro: positiveIntegerString,
  priceMicroUsd: positiveIntegerString,
  minXlmOutStroops: positiveIntegerString,
  sources: z.number().int().positive(),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  signature: z.string().regex(/^[0-9a-f]{64}$/i),
})

/** Funding payload accepted by the server-side settlement boundary. */
export const oracleEscrowTransactionSchema = z.object({
  bountyId: z.string().min(1).max(128),
  operation: z.literal('deposit'),
  payerAddress: z.string().min(1).max(128),
  payeeAddress: z.string().min(1).max(128),
  clientMinXlmOutStroops: positiveIntegerString,
  quote: lockedOracleQuoteSchema,
})

export const paymentPostBodySchema = z.discriminatedUnion('type', [
  bountyEscrowPaymentSchema,
  subscriptionCheckoutSchema,
  escrowReleaseSchema,
  escrowRefundSchema,
])

export type PaymentPostBody = z.infer<typeof paymentPostBodySchema>
export type OracleEscrowTransaction = z.infer<typeof oracleEscrowTransactionSchema>
