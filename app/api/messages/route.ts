import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import {
  redisMessageStore,
  redisMessageList,
  redisMessagePublish,
  redisMessageGetById,
  redisMessageDelete,
  redisCheckRateLimit,
  type StoredMessage,
  type MessagePage,
} from '@/lib/storage/redis'
import { prisma } from '@/lib/prisma'

// ── Runtime ──────────────────────────────────────────────────────────────────
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Auth helpers ─────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'dev-secret-change-me'

type AuthPayload = {
  userId: string
  role: string
}

function authenticate(request: NextRequest): AuthPayload | { error: string; status: number } {
  const header = request.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) {
    return { error: 'Missing or malformed Authorization header', status: 401 }
  }

  const token = header.slice(7)
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    return { userId: decoded.id || decoded.sub || decoded.userId, role: decoded.role || 'USER' }
  } catch {
    return { error: 'Invalid or expired token', status: 401 }
  }
}

function isAuth(auth: ReturnType<typeof authenticate>): auth is AuthPayload {
  return 'userId' in auth && typeof auth.userId === 'string'
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = authenticate(request)
  if (!isAuth(auth)) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const threadId = searchParams.get('threadId')
  if (!threadId) {
    return NextResponse.json({ error: 'threadId query parameter is required' }, { status: 400 })
  }

  const cursor = searchParams.get('cursor')
  const limitParam = searchParams.get('limit')
  const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 200)
  const q = searchParams.get('q')?.toLowerCase().trim()

  const page: MessagePage = await redisMessageList(threadId, cursor, limit)

  let messages = page.messages
  if (q) {
    messages = messages.filter((m) => {
      const plainText = (m.metadata as Record<string, unknown> | undefined)?.['plainText']
      return typeof plainText === 'string' && plainText.toLowerCase().includes(q)
    })
  }

  return NextResponse.json({
    messages,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  })
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = authenticate(request)
  if (!isAuth(auth)) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json()
  const { action } = body

  // ── Moderate action (ADMIN only) ──────────────────────────────────────────────
  if (action === 'moderate') {
    if (auth.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden: ADMIN role required' }, { status: 403 })
    }

    const { messageId, moderateAction, reason } = body
    if (!messageId || !moderateAction) {
      return NextResponse.json({ error: 'messageId and moderateAction required' }, { status: 400 })
    }

    const msg = await redisMessageGetById(messageId)

    if (moderateAction === 'delete' && msg) {
      await redisMessageDelete(messageId, msg.threadId)
    }

    await redisMessagePublish({
      type: 'moderated',
      messageId,
      action: moderateAction,
      moderatorId: auth.userId,
      reason: reason || '',
      threadId: msg?.threadId || '',
    })

    if (msg) {
      await prisma.auditLog.create({
        data: {
          userId: auth.userId,
          resource: 'message',
          action: `moderate:${moderateAction}`,
          resourceId: messageId,
          payload: { messageThreadId: msg.threadId, reason },
          httpMethod: 'POST',
          requestPath: '/api/messages',
          status: 'SUCCESS',
        },
      }).catch((err) => console.warn('[AuditLog] write failed:', err))
    }

    return NextResponse.json({ ok: true })
  }

  // ── Rate limiting ────────────────────────────────────────────────────────────
  const remaining = await redisCheckRateLimit(auth.userId, 30)
  if (remaining < 0) {
    return NextResponse.json({ error: 'Rate limit exceeded (30/s)' }, { status: 429 })
  }

  // ── Send message ─────────────────────────────────────────────────────────────
  const message: StoredMessage = {
    id: body.id || crypto.randomUUID(),
    threadId: body.threadId || 'general',
    senderId: auth.userId,
    recipientId: body.recipientId || 'all',
    ciphertext: body.ciphertext,
    iv: body.iv,
    createdAt: new Date().toISOString(),
    attachment: body.attachment || null,
    status: 'sent',
    readBy: [auth.userId],
    metadata: body.metadata || {},
  }

  const stored = await redisMessageStore(message)
  if (!stored) {
    console.warn('[Messages] Redis unavailable — message not persisted')
  }

  await redisMessagePublish({ type: 'message', data: message })

  return NextResponse.json({ ok: true, message })
}
