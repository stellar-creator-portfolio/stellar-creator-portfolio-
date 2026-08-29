import { WebSocketServer, WebSocket } from 'ws'
import { createServer, IncomingMessage } from 'http'
import jwt from 'jsonwebtoken'

// ── Config ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.MSG_WS_PORT ?? '3002', 10)
const HOST = process.env.MSG_WS_HOST ?? 'localhost'
const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'dev-secret-change-me'
const REDIS_URL = process.env.REDIS_URL

interface ConnState {
  userId: string
  role: string
  threadId: string
  ws: WebSocket
}

const threads = new Map<string, Set<ConnState>>()
const connections = new Map<WebSocket, ConnState>()

// Lazy-loaded Redis helpers (optional dependency)
let redis: typeof import('../lib/storage/redis') | null = null

async function getRedis() {
  if (redis) return redis
  if (!REDIS_URL) return null
  try {
    redis = await import('../lib/storage/redis.js')
    return redis
  } catch {
    try {
      redis = await import('../lib/storage/redis')
      return redis
    } catch {
      console.warn('[messaging-ws] Redis module not available — running in degraded mode')
      return null
    }
  }
}

// ── JWT auth ─────────────────────────────────────────────────────────────────
function authenticate(req: IncomingMessage): { userId: string; role: string } | null {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)
  const token = url.searchParams.get('token') || req.headers['authorization']?.replace(/^Bearer\s+/i, '')
  if (!token) return null

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    return { userId: decoded.id || decoded.sub || decoded.userId, role: decoded.role || 'USER' }
  } catch {
    return null
  }
}

// ── Broadcast ────────────────────────────────────────────────────────────────
function broadcastToThread(threadId: string, data: unknown, excludeUserId?: string) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  const set = threads.get(threadId)
  if (!set) return

  for (const conn of set) {
    if (conn.userId === excludeUserId) continue
    if (conn.ws.readyState === WebSocket.OPEN) {
      try {
        conn.ws.send(payload)
      } catch {
        conn.ws.terminate()
        set.delete(conn)
        connections.delete(conn.ws)
      }
    }
  }

  if (set.size === 0) threads.delete(threadId)
}

// ── Server ───────────────────────────────────────────────────────────────────
const server = createServer()
const wss = new WebSocketServer({ server })

wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
  const auth = authenticate(req)
  if (!auth) {
    ws.close(4001, 'Authentication failed')
    return
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)
  const threadId = url.searchParams.get('threadId') || 'general'
  const redisApi = await getRedis()

  const state: ConnState = { userId: auth.userId, role: auth.role, threadId, ws }
  connections.set(ws, state)

  let set = threads.get(threadId)
  if (!set) {
    set = new Set()
    threads.set(threadId, set)
  }
  set.add(state)

  // Send thread history on connect
  if (redisApi) {
    redisApi.redisMessageList(threadId, null, 200).then((page) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'history', data: page.messages }))
      }
    })
  } else {
    ws.send(JSON.stringify({ type: 'history', data: [] }))
  }

  ws.on('message', async (raw) => {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw.toString())
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid payload' }))
      return
    }

    const { type } = parsed

    if (type === 'message') {
      if (redisApi) {
        const remaining = await redisApi.redisCheckRateLimit(auth.userId, 30)
        if (remaining < 0) {
          ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded (30/s)' }))
          return
        }
      }

      const message = {
        id: (parsed.id as string) || crypto.randomUUID(),
        threadId,
        senderId: auth.userId,
        recipientId: (parsed.recipientId as string) || 'all',
        ciphertext: parsed.ciphertext as string,
        iv: parsed.iv as string,
        createdAt: new Date().toISOString(),
        attachment: (parsed.attachment as Record<string, unknown>) || null,
        status: 'sent',
        readBy: [auth.userId],
        metadata: (parsed.metadata as Record<string, unknown>) || {},
      }

      if (redisApi) {
        redisApi.redisMessageStore(message).catch(() => {})
        redisApi.redisMessagePublish({ type: 'message', data: message }).catch(() => {})
      }

      broadcastToThread(threadId, { type: 'message', data: message })
    } else if (type === 'typing') {
      broadcastToThread(threadId, { type: 'typing', userId: auth.userId, threadId })
    } else if (type === 'read-receipt') {
      const { messageId } = parsed
      if (messageId && redisApi) {
        redisApi.redisMessageAddReadBy(messageId as string, auth.userId).catch(() => {})
      }
      broadcastToThread(threadId, { type: 'read-receipt', messageId, userId: auth.userId })
    } else if (type === 'moderate') {
      if (auth.role !== 'ADMIN') {
        ws.send(JSON.stringify({ type: 'error', message: 'Forbidden' }))
        return
      }

      const messageId = parsed.messageId as string
      const moderateAction = parsed.moderateAction as string
      const reason = (parsed.reason as string) || ''

      if (redisApi) {
        const msg = await redisApi.redisMessageGetById(messageId)
        if (moderateAction === 'delete' && msg) {
          await redisApi.redisMessageDelete(messageId, msg.threadId)
        }
        await redisApi.redisMessagePublish({
          type: 'moderated',
          messageId,
          action: moderateAction,
          moderatorId: auth.userId,
          reason,
          threadId: msg?.threadId || threadId,
        })
      }

      broadcastToThread(threadId, { type: 'moderated', messageId, action: moderateAction, moderatorId: auth.userId, reason })
    } else if (type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
    }
  })

  ws.on('close', () => {
    connections.delete(ws)
    const s = threads.get(threadId)
    if (s) {
      s.delete(state)
      if (s.size === 0) threads.delete(threadId)
    }
  })

  ws.on('error', () => {
    connections.delete(ws)
    const s = threads.get(threadId)
    if (s) {
      s.delete(state)
      if (s.size === 0) threads.delete(threadId)
    }
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[messaging-ws] WebSocket server running on ws://${HOST}:${PORT}`)
})

function shutdown() {
  console.log('[messaging-ws] Shutting down')
  wss.close(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
