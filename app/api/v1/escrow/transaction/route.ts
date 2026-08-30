import { getToken } from 'next-auth/jwt'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { resolveOracleEscrowFunding } from '@/lib/payments/oracle-quote-service'
import { oracleEscrowTransactionSchema } from '@/lib/payments/payment-validators'
import {
  getOracleQuoteSecret,
  OracleQuoteError,
} from '@/lib/payments/oracle-quote-service'

export const runtime = 'nodejs'

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(request: NextRequest) {
  const session = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  })
  if (!session) return errorResponse('UNAUTHORIZED', 'Authentication required', 401)

  const parsed = oracleEscrowTransactionSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsed.success) {
    return errorResponse('VALIDATION_ERROR', 'Invalid escrow funding request', 400)
  }

  const bounty = await prisma.bounty.findUnique({
    where: { id: parsed.data.bountyId },
    select: { id: true, budget: true },
  })
  if (!bounty) return errorResponse('NOT_FOUND', 'Bounty not found', 404)

  const configuredAsset = process.env.XLM_TOKEN_CONTRACT_ADDRESS
  if (!configuredAsset || parsed.data.quote.assetContract !== configuredAsset) {
    return errorResponse('QUOTE_MISMATCH', 'Settlement asset does not match server policy', 422)
  }

  try {
    const expectedUsdAmountMicro = (BigInt(bounty.budget) * 1_000_000n).toString()
    const funding = resolveOracleEscrowFunding({
      quote: parsed.data.quote,
      quoteSigningSecret: getOracleQuoteSecret(),
      bountyId: bounty.id,
      usdAmountMicro: expectedUsdAmountMicro,
      clientMinXlmOutStroops: parsed.data.clientMinXlmOutStroops,
    })

    const settlementUrl = process.env.ESCROW_SETTLEMENT_URL
    if (!settlementUrl) {
      return errorResponse(
        'SERVICE_UNAVAILABLE',
        'Escrow settlement service is not configured',
        503,
      )
    }
    const upstream = await fetch(settlementUrl, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'content-type': 'application/json',
        ...(process.env.ESCROW_SETTLEMENT_TOKEN
          ? { authorization: `Bearer ${process.env.ESCROW_SETTLEMENT_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        bountyId: bounty.id,
        operation: 'deposit',
        payerAddress: parsed.data.payerAddress,
        payeeAddress: parsed.data.payeeAddress,
        tokenAddress: funding.assetContract,
        amount: funding.amountStroops,
        minXlmOutStroops: funding.amountStroops,
        oracleQuoteId: funding.quoteId,
      }),
    })
    const responseBody = await upstream.text()
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quote validation failed'
    const code = error instanceof OracleQuoteError ? error.code : 'SERVICE_UNAVAILABLE'
    return errorResponse(code, message, code === 'SERVICE_UNAVAILABLE' ? 503 : 422)
  }
}
