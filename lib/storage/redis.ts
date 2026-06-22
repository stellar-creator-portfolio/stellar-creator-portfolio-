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

export { getClient as getRedisClient }
