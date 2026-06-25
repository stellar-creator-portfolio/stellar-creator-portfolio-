import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma'

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
  const { nullifier, proof, publicSignals, creatorId } = body

  if (!nullifier || !proof || !publicSignals || !creatorId) {
    return NextResponse.json(
      { error: 'nullifier, proof, publicSignals, and creatorId are required' },
      { status: 400 },
    )
  }

  try {
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
    })
  } catch (err) {
    console.error('[verify-proof] DB error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
