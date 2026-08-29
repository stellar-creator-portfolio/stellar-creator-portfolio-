import { getToken } from 'next-auth/jwt'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import {
  createLockedOracleQuote,
  fetchContractValuation,
  getOracleQuoteSecret,
  OracleQuoteError,
} from '@/lib/payments/oracle-quote-service'

export const runtime = 'nodejs'

const requestSchema = z.object({
  bountyId: z.string().min(1).max(128),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(request: NextRequest) {
  const session = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  })
  if (!session) return errorResponse('UNAUTHORIZED', 'Authentication required', 401)

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('VALIDATION_ERROR', 'A valid bountyId is required', 400)
  }

  const bounty = await prisma.bounty.findUnique({
    where: { id: parsed.data.bountyId },
    select: { id: true, budget: true },
  })
  if (!bounty) return errorResponse('NOT_FOUND', 'Bounty not found', 404)

  const assetContract = process.env.XLM_TOKEN_CONTRACT_ADDRESS
  if (!assetContract) {
    return errorResponse(
      'SERVICE_UNAVAILABLE',
      'Settlement asset contract is not configured',
      503,
    )
  }

  try {
    const usdAmountMicro = (BigInt(bounty.budget) * 1_000_000n).toString()
    const valuation = await fetchContractValuation(usdAmountMicro)
    if (valuation.usdAmountMicro !== usdAmountMicro) {
      throw new OracleQuoteError(
        'QUOTE_MISMATCH',
        'Contract valuation does not match the bounty amount',
      )
    }
    const quote = createLockedOracleQuote({
      bountyId: bounty.id,
      assetContract,
      valuation,
      secret: getOracleQuoteSecret(),
    })
    return NextResponse.json({ data: quote }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Oracle unavailable'
    const code = error instanceof OracleQuoteError ? error.code : 'ORACLE_UNAVAILABLE'
    return errorResponse(code, message, 503)
  }
}
