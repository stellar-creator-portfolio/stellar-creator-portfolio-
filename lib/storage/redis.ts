/**
 * Redis client — singleton with graceful fallback.
 *
 * If REDIS_URL is not set (or Redis is unreachable), every cache operation
 * silently no-ops so the app keeps working without Redis in dev/test.
 */

import Redis from 'ioredis'

// ── TTLs (seconds) ────────────────────────────────────────────────────────────
export const TTL = {
  SHORT:  60,          // 1 min  — volatile data (bounties list, user profiles)
  MEDIUM: 5 * 60,     // 5 min  — semi-stable (creators list, paginated results)
  LONG:   30 * 60,    // 30 min — stable data (analytics aggregates)
} as const

// ── Key namespaces ────────────────────────────────────────────────────────────
export const KEYS = {
  creators:  (suffix: string) => `creators:${suffix}`,
  bounties:  (suffix: string) => `bounties:${suffix}`,
  users:     (suffix: string) => `users:${suffix}`,
  user:      (id: string)     => `user:${id}`,
  rateLimit: (key: string)    => `rl:${key}`,
  collab:    (docName: string) => `collab:${docName}`,
} as const

// ── Singleton ─────────────────────────────────────────────────────────────────
let client: Redis | null = null

function getClient(): Redis | null {
  if (client) return client

  const url = process.env.REDIS_URL
  if (!url) {
    // No Redis configured — fall back to in-memory cache in lib/db.ts
    return null
  }

  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
      connectTimeout: 5000,
    })

    client.on('error', (err) => {
      // Log but don't crash — the app degrades gracefully
      console.warn('[Redis] connection error:', err.message)
    })

    client.on('connect', () => {
      console.info('[Redis] connected')
    })

    return client
  } catch (err) {
    console.warn('[Redis] failed to initialise client:', err)
    return null
  }
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Get a cached value. Returns null on miss or when Redis is unavailable.
 */
export async function redisGet<T>(key: string): Promise<T | null> {
  const redis = getClient()
  if (!redis) return null

  try {
    const raw = await redis.get(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * Set a value with an optional TTL (seconds). Silently no-ops if Redis is down.
 */
export async function redisSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = TTL.MEDIUM,
): Promise<void> {
  const redis = getClient()
  if (!redis) return

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // ignore — cache miss is acceptable
  }
}

/**
 * Delete one or more keys. Supports glob patterns via SCAN + DEL.
 */
export async function redisDel(pattern: string): Promise<void> {
  const redis = getClient()
  if (!redis) return

  try {
    if (pattern.includes('*')) {
      // Scan-based deletion to avoid KEYS blocking the server
      let cursor = '0'
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
        cursor = nextCursor
        if (keys.length > 0) {
          await redis.del(...keys)
        }
      } while (cursor !== '0')
    } else {
      await redis.del(pattern)
    }
  } catch {
    // ignore
  }
}

/**
 * Increment a counter and set TTL on first write.
 * Returns the new count, or null if Redis is unavailable.
 */
export async function redisIncr(key: string, ttlSeconds: number): Promise<number | null> {
  const redis = getClient()
  if (!redis) return null

  try {
    const count = await redis.incr(key)
    if (count === 1) {
      // First increment — set the expiry
      await redis.expire(key, ttlSeconds)
    }
    return count
  } catch {
    return null
  }
}

/**
 * Get the TTL remaining on a key (seconds). Returns null if unavailable.
 */
export async function redisTTL(key: string): Promise<number | null> {
  const redis = getClient()
  if (!redis) return null

  try {
    return await redis.ttl(key)
  } catch {
    return null
  }
}

// ── Message helpers ────────────────────────────────────────────────────────────

const MSG_TTL = 30 * 24 * 60 * 60 // 30 days

export const MESSAGE_KEYS = {
  hash:      (id: string)            => `msg:${id}`,
  timeline:  (threadId: string)      => `msgs:${threadId}:timeline`,
  channel:   'messages:new',
  rateLimit: (userId: string)        => `rl:msg:${userId}`,
} as const

export type StoredMessage = {
  id: string
  threadId: string
  senderId: string
  recipientId: string
  ciphertext: string
  iv: string
  createdAt: string
  attachment?: Record<string, unknown> | null
  status: string
  readBy: string[]
  metadata?: Record<string, unknown>
}

/** Store a message hash + append to thread timeline. Returns false if Redis is unavailable. */
export async function redisMessageStore(msg: StoredMessage): Promise<boolean> {
  const redis = getClient()
  if (!redis) return false

  const score = new Date(msg.createdAt).getTime()
  const hashKey = MESSAGE_KEYS.hash(msg.id)
  const timelineKey = MESSAGE_KEYS.timeline(msg.threadId)

  try {
    const multi = redis.multi()
    multi.hset(hashKey, msg as unknown as Record<string, unknown>)
    multi.zadd(timelineKey, score, msg.id)
    multi.expire(hashKey, MSG_TTL)
    multi.expire(timelineKey, MSG_TTL)
    await multi.exec()
    return true
  } catch (err) {
    console.warn('[Redis] messageStore failed:', err)
    return false
  }
}

/** Fetch a single message by id. */
export async function redisMessageGetById(id: string): Promise<StoredMessage | null> {
  const redis = getClient()
  if (!redis) return null

  try {
    const raw = await redis.hgetall(MESSAGE_KEYS.hash(id))
    if (!raw || Object.keys(raw).length === 0) return null
    return raw as unknown as StoredMessage
  } catch {
    return null
  }
}

export type MessagePage = {
  messages: StoredMessage[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * Cursor-based pagination over a thread timeline.
 * `cursor` is an opaque base64-encoded timestamp.
 */
export async function redisMessageList(
  threadId: string,
  cursor?: string | null,
  limit: number = 50,
): Promise<MessagePage> {
  const redis = getClient()
  if (!redis) return { messages: [], nextCursor: null, hasMore: false }

  const capped = Math.min(limit, 200)
  const timelineKey = MESSAGE_KEYS.timeline(threadId)

  try {
    let minScore: number
    if (cursor) {
      try {
        minScore = parseInt(Buffer.from(cursor, 'base64').toString('utf-8'), 10)
      } catch {
        minScore = Date.now()
      }
    } else {
      minScore = 0
    }

    // Fetch one extra to detect hasMore
    const ids = await redis.zrangebyscore(timelineKey, minScore + 1, '+inf', 'LIMIT', 0, capped + 1)
    const hasMore = ids.length > capped
    const batchIds = ids.slice(0, capped)

    if (batchIds.length === 0) {
      return { messages: [], nextCursor: null, hasMore: false }
    }

    const pipeline = redis.pipeline()
    for (const id of batchIds) {
      pipeline.hgetall(MESSAGE_KEYS.hash(id))
    }
    const results = await pipeline.exec()

    const messages: StoredMessage[] = []
    for (const [err, raw] of results || []) {
      if (!err && raw && typeof raw === 'object' && Object.keys(raw as Record<string, unknown>).length > 0) {
        messages.push(raw as unknown as StoredMessage)
      }
    }

    const lastId = batchIds[batchIds.length - 1]
    const lastMsg = messages.find((m) => m.id === lastId)
    const nextCursor = hasMore && lastMsg
      ? Buffer.from(new Date(lastMsg.createdAt).getTime().toString()).toString('base64')
      : null

    return { messages, nextCursor, hasMore }
  } catch (err) {
    console.warn('[Redis] messageList failed:', err)
    return { messages: [], nextCursor: null, hasMore: false }
  }
}

/** Publish a message event to the Redis pub/sub channel. */
export async function redisMessagePublish(event: Record<string, unknown>): Promise<void> {
  const redis = getClient()
  if (!redis) return

  try {
    await redis.publish(MESSAGE_KEYS.channel, JSON.stringify(event))
  } catch (err) {
    console.warn('[Redis] publish failed:', err)
  }
}

/** Delete a message from Redis (hash + timeline). */
export async function redisMessageDelete(id: string, threadId: string): Promise<boolean> {
  const redis = getClient()
  if (!redis) return false

  try {
    const multi = redis.multi()
    multi.del(MESSAGE_KEYS.hash(id))
    multi.zrem(MESSAGE_KEYS.timeline(threadId), id)
    await multi.exec()
    return true
  } catch {
    return false
  }
}

/** Update readBy on a message. */
export async function redisMessageAddReadBy(id: string, userId: string): Promise<void> {
  const redis = getClient()
  if (!redis) return

  try {
    const key = MESSAGE_KEYS.hash(id)
    await redis.hincrby(key, 'readBy', 0) // ensure field exists
    // hset with JSON serialized readBy array
    const msg = await redis.hgetall(key)
    if (msg && Object.keys(msg).length > 0) {
      const stored = msg as unknown as StoredMessage
      const updated = Array.from(new Set([...(stored.readBy || []), userId]))
      await redis.hset(key, 'readBy', JSON.stringify(updated))
    }
  } catch {
    // ignore
  }
}

/** Rate limit: returns remaining budget or -1 if over limit. */
export async function redisCheckRateLimit(userId: string, maxPerSecond = 30): Promise<number> {
  const redis = getClient()
  if (!redis) return maxPerSecond // pass-through if Redis unavailable

  const key = MESSAGE_KEYS.rateLimit(userId)
  try {
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, 1)
    }
    return count <= maxPerSecond ? maxPerSecond - count : -1
  } catch {
    return maxPerSecond
  }
}

export { getClient as getRedisClient }
