import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma'
import { verifyProofLocally } from '@/lib/zk-review-proof'

export const runtime = 'nodejs'

const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'dev-secret-change-me'

export async function POST(request: NextRequest) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let userId: string
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET) as any
    userId = decoded.id || decoded.sub || decoded.userId
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const body = await request.json()
  const { nullifier, proof, publicSignals, creatorId, reviewerId, expiresAt, rating } = body

  if (!nullifier || !proof || !publicSignals || !creatorId) {
    return NextResponse.json(
      { error: 'nullifier, proof, publicSignals, and creatorId are required' },
      { status: 400 },
    )
  }

  try {
    const valid = await verifyProofLocally({ proof, publicSignals, nullifier })
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid proof', code: 'INVALID_PROOF' },
        { status: 400 },
      )
    }

    if (reviewerId && reviewerId !== userId) {
      return NextResponse.json(
        { error: 'reviewerId mismatch', code: 'REVIEWER_MISMATCH' },
        { status: 403 },
      )
    }

    if (
      publicSignals.length >= 3 &&
      Number(publicSignals[2]) < Math.floor(Date.now() / 1000)
    ) {
      return NextResponse.json(
        { error: 'Credential has expired', code: 'CREDENTIAL_EXPIRED' },
        { status: 403 },
      )
    }

    const existing = await prisma.review.findFirst({
      where: { nullifier },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Nullifier already used', code: 'NULLIFIER_USED' },
        { status: 409 },
      )
    }

    return NextResponse.json({
      ok: true,
      nullifier,
      creatorId,
      userId,
      expiresAt: publicSignals.length >= 3 ? publicSignals[2] : null,
      rating: publicSignals.length >= 4 ? publicSignals[3] : null,
    })
  } catch (err) {
    console.error('[verify-proof] DB error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
