import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import WebSocket from 'ws'
import jwt from 'jsonwebtoken'
import * as Y from 'yjs'
// @ts-ignore
import { WebsocketProvider } from 'y-websocket'

// Test Constants & Env Setup
const TEST_PORT = 12345
const TEST_SECRET = 'super-secret-test-key'
process.env.WS_PORT = TEST_PORT.toString()
process.env.WS_HOST = '127.0.0.1'
process.env.AUTH_SECRET = TEST_SECRET
process.env.REDIS_URL = 'redis://127.0.0.1:6379'
process.env.COLLAB_SNAPSHOT_INTERVAL = '1' // Save snapshot on every update
process.env.COLLAB_MAX_PARTICIPANTS = '10'  // Production limit check

// Mock Redis Singleton
const mockRedisStore = new Map<string, Buffer>()
const mockRedis = {
  getBuffer: vi.fn(async (key: string) => {
    return mockRedisStore.get(key) || null
  }),
  set: vi.fn(async (key: string, value: any) => {
    mockRedisStore.set(key, value)
    return 'OK'
  }),
  on: vi.fn(),
}

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      constructor() {
        return mockRedis as any
      }
    },
  }
})

// Import Collaboration Server dynamically after setting environment and mocks
let server: any

describe('Collaborative WebSocket Server Integration Tests', () => {
  beforeAll(async () => {
    // @ts-ignore
    const collabModule = await import('../server/collab.js')
    server = collabModule.server

    // Wait slightly to guarantee the server is listening
    await new Promise((resolve) => setTimeout(resolve, 500))
  })

  afterAll(async () => {
    // Close WebSocket server and HTTP listener
    await new Promise<void>((resolve) => {
      if (server) {
        server.close(() => {
          resolve()
        })
      } else {
        resolve()
      }
    })
  })

  it('rejects connection without token (401)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/room-1`)

    const statusCode = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode ?? 401)
        ws.terminate()
      })
      ws.on('open', () => {
        ws.close()
        resolve(200)
      })
      ws.on('error', () => {
        resolve(401)
      })
    })

    expect(statusCode).toBe(401)
  })

  it('rejects connection with invalid token (401)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/room-1?token=invalid-sig`)

    const statusCode = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode ?? 401)
        ws.terminate()
      })
      ws.on('open', () => {
        ws.close()
        resolve(200)
      })
      ws.on('error', () => {
        resolve(401)
      })
    })

    expect(statusCode).toBe(401)
  })

  it('rejects connection to unauthorized room (403)', async () => {
    const token = jwt.sign(
      { userId: 'user-1', permittedDocIds: ['authorized-room'] },
      TEST_SECRET
    )
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/unauthorized-room?token=${token}`)

    const statusCode = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode ?? 403)
        ws.terminate()
      })
      ws.on('open', () => {
        ws.close()
        resolve(200)
      })
      ws.on('error', () => {
        resolve(403)
      })
    })

    expect(statusCode).toBe(403)
  })

  it('allows connection to authorized room', async () => {
    const token = jwt.sign(
      { userId: 'user-2', permittedDocIds: ['authorized-room'] },
      TEST_SECRET
    )
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/authorized-room?token=${token}`)

    const isOpen = await new Promise<boolean>((resolve) => {
      ws.on('open', () => {
        ws.close()
        resolve(true)
      })
      ws.on('unexpected-response', () => {
        ws.terminate()
        resolve(false)
      })
      ws.on('error', () => {
        resolve(false)
      })
    })

    expect(isOpen).toBe(true)
  })

  it('allows connection to any room with wildcard * permittedDocIds', async () => {
    const token = jwt.sign(
      { userId: 'user-admin', permittedDocIds: '*' },
      TEST_SECRET
    )
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/any-random-room?token=${token}`)

    const isOpen = await new Promise<boolean>((resolve) => {
      ws.on('open', () => {
        ws.close()
        resolve(true)
      })
      ws.on('unexpected-response', () => {
        ws.terminate()
        resolve(false)
      })
      ws.on('error', () => {
        resolve(false)
      })
    })

    expect(isOpen).toBe(true)
  })

  it('enforces COLLAB_MAX_PARTICIPANTS room size and rejects 11th connection with Close Code 4008', async () => {
    const tokens = Array.from({ length: 10 }, (_, i) =>
      jwt.sign({ userId: `user-p${i}`, permittedDocIds: '*' }, TEST_SECRET)
    )
    const sockets = tokens.map(
      (token) => new WebSocket(`ws://127.0.0.1:${TEST_PORT}/limited-room?token=${token}`)
    )

    await Promise.all(
      sockets.map((ws) => new Promise<void>((resolve) => ws.on('open', resolve)))
    )

    const token11 = jwt.sign({ userId: 'user-p11', permittedDocIds: '*' }, TEST_SECRET)
    const ws11 = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/limited-room?token=${token11}`)

    const closeCode = await new Promise<number>((resolve) => {
      ws11.on('close', (code) => {
        resolve(code)
      })
      ws11.on('unexpected-response', () => {
        ws11.terminate()
        resolve(9999)
      })
      ws11.on('error', () => {
        resolve(9999)
      })
    })

    sockets.forEach((ws) => ws.close())
    ws11.terminate()

    expect(closeCode).toBe(4008)
  })

  it('converges concurrent edits for 10 simultaneous editors within 2 seconds (CRDT property test)', async () => {
    const editorsCount = 10
    const docsList = Array.from({ length: editorsCount }, () => new Y.Doc())
    const providers = docsList.map((ydoc, i) => {
      const token = jwt.sign({ userId: `user-${i}`, permittedDocIds: '*' }, TEST_SECRET)
      return new WebsocketProvider(`ws://127.0.0.1:${TEST_PORT}`, 'sync-room-10', ydoc, {
        params: { token },
        WebSocketPolyfill: WebSocket as any,
      })
    })

    // Wait for all 10 providers to connect
    await new Promise((resolve) => setTimeout(resolve, 800))

    // Perform concurrent edits simultaneously
    docsList.forEach((ydoc, i) => {
      ydoc.getText('content').insert(0, `[Edit ${i}] `)
    })

    // Wait for replication and sync (must be within 2 seconds)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Fetch and check texts
    const texts = docsList.map((ydoc) => ydoc.getText('content').toString())

    // Cleanup
    providers.forEach((p) => p.destroy())
    docsList.forEach((d) => d.destroy())

    const firstText = texts[0]
    for (const text of texts) {
      expect(text).toBe(firstText)
    }

    for (let i = 0; i < editorsCount; i++) {
      expect(firstText.includes(`[Edit ${i}]`)).toBe(true)
    }
  })

  it('persists room snapshots to Redis and restores on room creation', async () => {
    const token1 = jwt.sign({ userId: 'user-writer', permittedDocIds: '*' }, TEST_SECRET)
    const ydoc1 = new Y.Doc()
    const provider1 = new WebsocketProvider(`ws://127.0.0.1:${TEST_PORT}`, 'persist-room', ydoc1, {
      params: { token: token1 },
      WebSocketPolyfill: WebSocket as any,
    })

    await new Promise((resolve) => setTimeout(resolve, 500))

    // Make an edit. With COLLAB_SNAPSHOT_INTERVAL = 1, this immediately triggers a saveSnapshot
    ydoc1.getText('content').insert(0, 'Saved State!')

    await new Promise((resolve) => setTimeout(resolve, 500))

    // Verify mockRedis.set was called
    expect(mockRedis.set).toHaveBeenCalled()

    // Disconnect and clean up first doc
    provider1.destroy()
    ydoc1.destroy()

    // Wait for the room to be completely disposed on server
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Connect a new client to the same room
    const token2 = jwt.sign({ userId: 'user-reader', permittedDocIds: '*' }, TEST_SECRET)
    const ydoc2 = new Y.Doc()
    const provider2 = new WebsocketProvider(`ws://127.0.0.1:${TEST_PORT}`, 'persist-room', ydoc2, {
      params: { token: token2 },
      WebSocketPolyfill: WebSocket as any,
    })

    await new Promise((resolve) => setTimeout(resolve, 800))

    const restoredText = ydoc2.getText('content').toString()

    provider2.destroy()
    ydoc2.destroy()

    expect(restoredText).toBe('Saved State!')
  })
})
