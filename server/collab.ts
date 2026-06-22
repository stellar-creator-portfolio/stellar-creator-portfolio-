/**
 * Standalone Yjs WebSocket collaboration server.
 * Run with: node --loader ts-node/esm server/collab.ts
 * Or in production: node server/collab.js
 *
 * Listens on WS_PORT (default 1234) and handles Yjs CRDT sync
 * for all document rooms identified by the URL path.
 *
 * Security:
 *  - Validates a signed JWT (Authorization: Bearer <token> or ?token=<token>) in upgrade.
 *  - Restricts access to authorized rooms specified in permittedDocIds claim.
 *  - Enforces max room size via COLLAB_MAX_PARTICIPANTS.
 *
 * Resilience:
 *  - Periodically flushes Y.Doc snapshots to Redis (non-blocking).
 *  - Restores last state from Redis on room creation.
 *  - Flushes all snapshots to Redis on SIGTERM / SIGINT before exit.
 *
 * Observability:
 *  - Exposes /health HTTP endpoint showing active rooms and connection statistics.
 *
 * Rate Limiting:
 *  - Limits connections to 100 WebSocket messages per second.
 */
import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import jwt from 'jsonwebtoken'
import * as Y from 'yjs'
// @ts-ignore
import { setupWSConnection, setPersistence, docs } from 'y-websocket/bin/utils'
import { getRedisClient, KEYS } from '../lib/storage/redis.js'

// Configuration
const PORT = parseInt(process.env.WS_PORT ?? '1234', 10)
const HOST = process.env.WS_HOST ?? 'localhost'

/** How often to send a ping frame (ms). */
const HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.WS_HEARTBEAT_INTERVAL_MS ?? '30000',
  10,
)

/** How long to wait for a pong before terminating the socket (ms). */
const PONG_DEADLINE_MS = parseInt(
  process.env.WS_PONG_DEADLINE_MS ?? '10000',
  10,
)

/** Close sockets that have been idle (no message) for this long (ms). */
const IDLE_TIMEOUT_MS = parseInt(
  process.env.WS_IDLE_TIMEOUT_MS ?? '300000', // 5 min
  10,
)

/** How many updates between saving snapshots to Redis. */
const COLLAB_SNAPSHOT_INTERVAL = parseInt(
  process.env.COLLAB_SNAPSHOT_INTERVAL ?? '10',
  10,
)

/** Max number of concurrent participants in a room. */
const COLLAB_MAX_PARTICIPANTS = parseInt(
  process.env.COLLAB_MAX_PARTICIPANTS ?? '10',
  10,
)

/** NextAuth / JWT signing secret. */
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'your-nextauth-secret'

// Connection state
interface ConnState {
  /** True while we are waiting for a pong reply. */
  awaitingPong: boolean
  /** Timer that fires if pong is not received in time. */
  pongDeadlineTimer: ReturnType<typeof setTimeout> | null
  /** Timer that fires when the connection has been idle too long. */
  idleTimer: ReturnType<typeof setTimeout> | null
  /** Timestamp of the last received message (any type). */
  lastActivity: number
  /** Rate limiting state */
  msgCount: number
  windowStart: number
}

interface RoomInfo {
  participants: Set<string>
  lastActivity: Date
}

/** Live connection registry – used for metrics and forced GC. */
const connections = new Map<WebSocket, ConnState>()

/** Room registry mapping room/docName -> metadata. */
const roomRegistry = new Map<string, RoomInfo>()

// Redis Persistence Configuration
const redis = getRedisClient()

async function saveSnapshot(docName: string, ydoc: Y.Doc): Promise<void> {
  if (!redis) return
  try {
    const key = KEYS.collab(docName)
    const state = Y.encodeStateAsUpdate(ydoc)
    await redis.set(key, Buffer.from(state))
  } catch (err) {
    console.error(`[collab] Failed to save snapshot for ${docName} to Redis:`, err)
  }
}

async function flushAllSnapshots(): Promise<void> {
  if (!redis || docs.size === 0) return
  console.info(`[collab] Flushing ${docs.size} active documents to Redis...`)
  const promises: Promise<void>[] = []
  for (const [docName, ydoc] of docs) {
    promises.push(
      saveSnapshot(docName, ydoc).catch((err) => {
        console.error(`[collab] Error flushing snapshot for ${docName}:`, err)
      })
    )
  }
  await Promise.all(promises)
}

// Bind custom Yjs persistence layer
setPersistence({
  bindState: async (docName: string, ydoc: Y.Doc) => {
    if (redis) {
      try {
        const key = KEYS.collab(docName)
        const buffer = await redis.getBuffer(key)
        if (buffer) {
          Y.applyUpdate(ydoc, new Uint8Array(buffer))
          console.info(`[collab] Restored document state for room '${docName}' (${buffer.length} bytes)`)
        }
      } catch (err) {
        console.error(`[collab] Failed to restore document state for '${docName}':`, err)
      }
    }

    let updateCount = 0
    ydoc.on('update', (update) => {
      updateCount++
      if (updateCount >= COLLAB_SNAPSHOT_INTERVAL) {
        updateCount = 0
        // Non-blocking snapshot save to Redis
        saveSnapshot(docName, ydoc).catch((err) => {
          console.error(`[collab] Non-blocking snapshot write failed for ${docName}:`, err)
        })
      }
    })
  },
  writeState: async (docName: string, ydoc: Y.Doc) => {
    await saveSnapshot(docName, ydoc)
  },
})

// Helpers

function clearTimers(state: ConnState): void {
  if (state.pongDeadlineTimer !== null) {
    clearTimeout(state.pongDeadlineTimer)
    state.pongDeadlineTimer = null
  }
  if (state.idleTimer !== null) {
    clearTimeout(state.idleTimer)
    state.idleTimer = null
  }
}

function resetIdleTimer(ws: WebSocket, state: ConnState): void {
  if (state.idleTimer !== null) clearTimeout(state.idleTimer)
  state.lastActivity = Date.now()
  state.idleTimer = setTimeout(() => {
    console.warn(
      `[collab] Terminating idle connection (no activity for ${IDLE_TIMEOUT_MS}ms)`,
    )
    ws.terminate()
  }, IDLE_TIMEOUT_MS)
}

function terminateAndCleanup(ws: WebSocket, docName?: string, userId?: string): void {
  const state = connections.get(ws)
  if (state) {
    clearTimers(state)
    connections.delete(ws)
  }
  if (docName && userId) {
    const room = roomRegistry.get(docName)
    if (room) {
      room.participants.delete(userId)
      if (room.participants.size === 0) {
        roomRegistry.delete(docName)
      }
    }
  }
  ws.terminate()
}

function extractToken(req: IncomingMessage): string | null {
  // 1. Authorization header: Bearer <token>
  const authHeader = req.headers.authorization
  if (authHeader) {
    const parts = authHeader.split(' ')
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1]
    }
  }

  // 2. Query param: ?token=<token> or ?auth=<token>
  const urlObj = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  const tokenParam = urlObj.searchParams.get('token') ?? urlObj.searchParams.get('auth')
  if (tokenParam) {
    return tokenParam
  }

  // 3. Sec-WebSocket-Protocol header fallback: Bearer_<token>
  const protocolHeader = req.headers['sec-websocket-protocol']
  if (protocolHeader) {
    const protocols = Array.isArray(protocolHeader) ? protocolHeader : protocolHeader.split(',')
    for (const protocol of protocols) {
      const trimmed = protocol.trim()
      if (trimmed.startsWith('Bearer_')) {
        return trimmed.slice(7)
      }
    }
  }

  return null
}

function getHealthStats() {
  const rooms: Record<string, { participantCount: number; lastActivity: string }> = {}
  let totalConnections = 0
  for (const [docName, room] of roomRegistry) {
    rooms[docName] = {
      participantCount: room.participants.size,
      lastActivity: room.lastActivity.toISOString(),
    }
    totalConnections += room.participants.size
  }
  return {
    status: 'healthy',
    activeRooms: roomRegistry.size,
    totalConnections,
    rooms,
  }
}

// HTTP Server Setup (exposes /health and handles upgrades)
export const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(getHealthStats()))
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
})

export const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const urlObj = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  const docName = urlObj.pathname.replace(/^\//, '') || 'default'

  // Exclude healthcheck url from socket upgrade path
  if (urlObj.pathname === '/health') {
    return
  }

  // 1. Extract Token
  const token = extractToken(req)
  if (!token) {
    console.warn(`[collab] Rejecting upgrade to ${docName} - missing token`)
    socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUnauthorized')
    socket.destroy()
    return
  }

  // 2. Validate JWT and Auth
  try {
    const decoded = jwt.verify(token, AUTH_SECRET) as any
    const userId = decoded.userId ?? decoded.id ?? decoded.sub
    const permittedDocIds = decoded.permittedDocIds ?? decoded.docIds ?? decoded.allowedDocs

    if (!userId) {
      throw new Error('No user identity claim found in token')
    }

    const isAuthorized = permittedDocIds === '*' ||
      (Array.isArray(permittedDocIds) && permittedDocIds.includes(docName))

    if (!isAuthorized) {
      console.warn(`[collab] Rejecting upgrade - user ${userId} unauthorized for room ${docName}`)
      socket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nForbidden')
      socket.destroy()
      return
    }

    // Pass identity data to connection handler
    ;(req as any).userId = userId
    ;(req as any).docName = docName

    wss.handleUpgrade(req, socket, head, (ws: any) => {
      wss.emit('connection', ws, req)
    })
  } catch (err: any) {
    console.warn(`[collab] Rejecting upgrade - invalid token: ${err.message}`)
    socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUnauthorized')
    socket.destroy()
  }
})

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const docName = (req as any).docName ?? 'default'
  const userId = (req as any).userId ?? 'anonymous'

  // Check maximum room size before registering connection (Close Frame 4008 Policy Violation)
  const existingDoc = docs.get(docName)
  if (existingDoc && existingDoc.conns.size >= COLLAB_MAX_PARTICIPANTS) {
    console.warn(`[collab] Room ${docName} has reached max limit (${existingDoc.conns.size}/${COLLAB_MAX_PARTICIPANTS}). Rejecting.`)
    ws.close(4008, 'Policy Violation')
    return
  }

  // Initialise connection state
  const state: ConnState = {
    awaitingPong: false,
    pongDeadlineTimer: null,
    idleTimer: null,
    lastActivity: Date.now(),
    msgCount: 0,
    windowStart: Date.now(),
  }
  connections.set(ws, state)

  // Start idle timer immediately
  resetIdleTimer(ws, state)

  // Register in room registry
  let room = roomRegistry.get(docName)
  if (!room) {
    room = {
      participants: new Set<string>(),
      lastActivity: new Date(),
    }
    roomRegistry.set(docName, room)
  }
  room.participants.add(userId)
  room.lastActivity = new Date()

  // Pong handler
  ws.on('pong', () => {
    const s = connections.get(ws)
    if (!s) return
    s.awaitingPong = false
    if (s.pongDeadlineTimer !== null) {
      clearTimeout(s.pongDeadlineTimer)
      s.pongDeadlineTimer = null
    }
    resetIdleTimer(ws, s)
  })

  // Message handler – reset idle timer and rate limit
  ws.on('message', () => {
    const s = connections.get(ws)
    if (!s) return
    resetIdleTimer(ws, s)

    // Rate limiter: 100 ops/sec per connection
    const now = Date.now()
    if (now - s.windowStart >= 1000) {
      s.msgCount = 0
      s.windowStart = now
    }
    s.msgCount++
    if (s.msgCount > 100) {
      console.warn(`[collab] User ${userId} exceeded rate limit (100 ops/sec). Closing.`)
      ws.close(1008, 'Rate limit exceeded')
      ws.terminate()
      return
    }

    const r = roomRegistry.get(docName)
    if (r) {
      r.lastActivity = new Date()
    }
  })

  // Cleanup on close / error
  ws.on('close', () => {
    terminateAndCleanup(ws, docName, userId)
  })

  ws.on('error', (err: Error) => {
    console.error(`[collab] Socket error for ${userId} in ${docName}:`, err.message)
    terminateAndCleanup(ws, docName, userId)
  })

  // Delegate CRDT sync to y-websocket
  setupWSConnection(ws, req, { docName })
})

// Heartbeat loop
const heartbeatInterval = setInterval(() => {
  for (const [ws, state] of connections) {
    if (ws.readyState !== WebSocket.OPEN) {
      const docName = (ws as any).docName
      const userId = (ws as any).userId
      terminateAndCleanup(ws, docName, userId)
      continue
    }

    if (state.awaitingPong) {
      // Previous ping was never answered – zombie connection
      console.warn('[collab] Terminating zombie connection (missed pong)')
      const docName = (ws as any).docName
      const userId = (ws as any).userId
      terminateAndCleanup(ws, docName, userId)
      continue
    }

    // Send ping and arm the deadline timer
    state.awaitingPong = true
    state.pongDeadlineTimer = setTimeout(() => {
      console.warn(
        `[collab] Pong deadline exceeded (${PONG_DEADLINE_MS}ms) – terminating`,
      )
      const docName = (ws as any).docName
      const userId = (ws as any).userId
      terminateAndCleanup(ws, docName, userId)
    }, PONG_DEADLINE_MS)

    ws.ping()
  }
}, HEARTBEAT_INTERVAL_MS)

// Prevent the interval from keeping the process alive after server close
heartbeatInterval.unref()

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.info(`[collab] Received ${signal} – shutting down gracefully`)
  clearInterval(heartbeatInterval)

  // Flush all active document states to Redis synchronously-ish
  try {
    await flushAllSnapshots()
  } catch (err) {
    console.error('[collab] Error flushing snapshots on shutdown:', err)
  }

  // Terminate all open connections so their closures are released
  for (const [ws, state] of connections) {
    clearTimers(state)
    ws.terminate()
  }
  connections.clear()
  roomRegistry.clear()

  server.close(() => {
    console.info('[collab] Server closed')
    process.exit(0)
  })

  // Force-exit if close takes too long
  setTimeout(() => process.exit(1), 5000).unref()
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((err) => console.error(err))
})
process.on('SIGINT', () => {
  shutdown('SIGINT').catch((err) => console.error(err))
})

// Listen
server.listen(PORT, HOST, () => {
  console.log(
    `[collab] Yjs WebSocket server running on http://${HOST}:${PORT}` +
      ` | heartbeat=${HEARTBEAT_INTERVAL_MS}ms` +
      ` | pong_deadline=${PONG_DEADLINE_MS}ms` +
      ` | idle_timeout=${IDLE_TIMEOUT_MS}ms` +
      ` | snapshot_interval=${COLLAB_SNAPSHOT_INTERVAL}` +
      ` | max_participants=${COLLAB_MAX_PARTICIPANTS}`
  )
})
