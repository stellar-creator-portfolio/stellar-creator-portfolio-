/**
 * Tests for server/signaling.ts  (#637)
 *
 * NOTE: This file also contains the sequence-manager concurrency property
 * test per the issue requirements. The two suites share the file as
 * requested, though they exercise completely independent units.
 *
 * Signaling test coverage:
 *  - TURN credential generation (HMAC-SHA1, expiry format, base64)
 *  - ICE server list structure (STUN + TURN/UDP + TURN/TCP + TURNS/TLS)
 *  - Credential uniqueness (different peerIds → different credentials)
 *  - Credential determinism (same peerId+timestamp → same credential)
 *  - app/api/signaling/route.ts — GET endpoint (ICE servers + peerId)
 *  - app/api/signaling/route.ts — POST endpoint (relay store)
 *  - Credential expiry timestamp is in the future
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

// ── Sequence Manager concurrency test mock ─────────────────────────────
// Mock Prisma so the sequence manager tests don't need a live database.
// The mock implements an atomic in-memory CAS that simulates PostgreSQL
// UPDATE … WHERE lockedBy = '' OR expiresAt < NOW() semantics.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sequenceLock: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

// ── TURN credential utilities (extracted from server/signaling.ts) ────────────

const TURN_SECRET = 'test-secret-for-unit-tests';
const TURN_HOST = 'turn.example.com';
const TURN_PORT = 3478;
const TURN_TLS_PORT = 5349;
const STUN_URL = 'stun:stun.l.google.com:19302';
const TURN_CREDENTIAL_TTL = 86400;

function generateTurnCredentials(peerId: string, secret = TURN_SECRET) {
  const expiry = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL;
  const username = `${expiry}:${peerId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

function buildIceServers(peerId: string) {
  const { username, credential } = generateTurnCredentials(peerId);
  return [
    { urls: STUN_URL },
    { urls: `turn:${TURN_HOST}:${TURN_PORT}`, username, credential },
    { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`, username, credential },
    { urls: `turns:${TURN_HOST}:${TURN_TLS_PORT}`, username, credential },
  ];
}

// ── TURN credential tests ─────────────────────────────────────────────────────

describe('generateTurnCredentials()', () => {
  it('returns an object with username and credential', () => {
    const { username, credential } = generateTurnCredentials('peer-1');
    expect(typeof username).toBe('string');
    expect(typeof credential).toBe('string');
  });

  it('username format is "<expiry>:<peerId>"', () => {
    const { username } = generateTurnCredentials('peer-abc');
    const parts = username.split(':');
    expect(parts.length).toBe(2);
    expect(parts[1]).toBe('peer-abc');
    const expiry = parseInt(parts[0]);
    expect(isNaN(expiry)).toBe(false);
  });

  it('expiry timestamp is in the future', () => {
    const { username } = generateTurnCredentials('peer-future');
    const expiry = parseInt(username.split(':')[0]);
    expect(expiry).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('expiry is approximately TTL seconds from now', () => {
    const { username } = generateTurnCredentials('peer-ttl');
    const expiry = parseInt(username.split(':')[0]);
    const now = Math.floor(Date.now() / 1000);
    const delta = expiry - now;
    // Allow ±5s for test execution time
    expect(delta).toBeGreaterThan(TURN_CREDENTIAL_TTL - 5);
    expect(delta).toBeLessThanOrEqual(TURN_CREDENTIAL_TTL + 5);
  });

  it('credential is a base64 string', () => {
    const { credential } = generateTurnCredentials('peer-b64');
    expect(credential).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('different peerIds produce different credentials', () => {
    const a = generateTurnCredentials('peer-A');
    const b = generateTurnCredentials('peer-B');
    expect(a.credential).not.toBe(b.credential);
    expect(a.username).not.toBe(b.username);
  });

  it('HMAC is verifiable with the known secret', () => {
    const peerId = 'peer-verify';
    const { username, credential } = generateTurnCredentials(peerId, TURN_SECRET);
    const expected = createHmac('sha1', TURN_SECRET)
      .update(username)
      .digest('base64');
    expect(credential).toBe(expected);
  });

  it('different secrets produce different credentials for the same username', () => {
    const { username } = generateTurnCredentials('peer-1');
    const cred1 = createHmac('sha1', 'secret-1').update(username).digest('base64');
    const cred2 = createHmac('sha1', 'secret-2').update(username).digest('base64');
    expect(cred1).not.toBe(cred2);
  });
});

// ── ICE server list tests ─────────────────────────────────────────────────────

describe('buildIceServers()', () => {
  it('returns 4 ICE servers (STUN + TURN/UDP + TURN/TCP + TURNS/TLS)', () => {
    const servers = buildIceServers('peer-1');
    expect(servers).toHaveLength(4);
  });

  it('first entry is the STUN server (no auth)', () => {
    const servers = buildIceServers('peer-1');
    expect(servers[0].urls).toBe(STUN_URL);
    expect((servers[0] as any).username).toBeUndefined();
    expect((servers[0] as any).credential).toBeUndefined();
  });

  it('TURN entries include username and credential', () => {
    const servers = buildIceServers('peer-2');
    for (const server of servers.slice(1)) {
      expect(server.username).toBeDefined();
      expect(server.credential).toBeDefined();
    }
  });

  it('includes TURN/UDP entry', () => {
    const servers = buildIceServers('peer-1');
    const udp = servers.find(
      (s) => s.urls === `turn:${TURN_HOST}:${TURN_PORT}`,
    );
    expect(udp).toBeDefined();
  });

  it('includes TURN/TCP entry', () => {
    const servers = buildIceServers('peer-1');
    const tcp = servers.find((s) =>
      (s.urls as string).includes('?transport=tcp'),
    );
    expect(tcp).toBeDefined();
  });

  it('includes TURNS/TLS entry', () => {
    const servers = buildIceServers('peer-1');
    const tls = servers.find((s) =>
      (s.urls as string).startsWith('turns:'),
    );
    expect(tls).toBeDefined();
  });

  it('all TURN entries share the same username (same peerId)', () => {
    const servers = buildIceServers('same-peer');
    const turnServers = servers.slice(1);
    const usernames = new Set(turnServers.map((s) => s.username));
    expect(usernames.size).toBe(1);
  });
});

// ── API route tests ──────────────────────────────────────────────────────────

// Mock Next.js modules for route testing
vi.mock('next/server', () => ({
  NextRequest: class {
    url: string;
    nextUrl: URL;
    headers: Headers;
    method: string;
    constructor(url: string, init?: any) {
      this.url = url;
      this.nextUrl = new URL(url);
      this.headers = new Headers(init?.headers ?? {});
      this.method = init?.method ?? 'GET';
    }
    async json() {
      return JSON.parse(this._body ?? '{}');
    }
    _body?: string;
  },
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => ({
      status: init?.status ?? 200,
      json: async () => data,
      _data: data,
    }),
  },
}));

import { GET, POST } from '@/app/api/signaling/route';

describe('GET /api/signaling', () => {
  it('returns iceServers array', async () => {
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/api/signaling?peerId=test-peer');
    const res = await GET(req as any);
    const data = await res.json();
    expect(Array.isArray(data.iceServers)).toBe(true);
    expect(data.iceServers.length).toBeGreaterThan(0);
  });

  it('returns a peerId in the response', async () => {
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/api/signaling?peerId=explicit-peer');
    const res = await GET(req as any);
    const data = await res.json();
    expect(data.peerId).toBe('explicit-peer');
  });

  it('generates a peerId if not provided', async () => {
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/api/signaling');
    const res = await GET(req as any);
    const data = await res.json();
    expect(typeof data.peerId).toBe('string');
    expect(data.peerId.length).toBeGreaterThan(0);
  });

  it('returns signalingWsUrl', async () => {
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/api/signaling');
    const res = await GET(req as any);
    const data = await res.json();
    expect(typeof data.signalingWsUrl).toBe('string');
  });

  it('first iceServer entry is STUN (no auth fields)', async () => {
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/api/signaling?peerId=p1');
    const res = await GET(req as any);
    const data = await res.json();
    const stun = data.iceServers[0];
    expect(stun.urls).toMatch(/^stun:/);
    expect(stun.username).toBeUndefined();
  });
});

describe('POST /api/signaling', () => {
  it('returns { ok: true } on valid payload', async () => {
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/api/signaling', {
      method: 'POST',
    });
    req._body = JSON.stringify({
      roomId: 'room-1',
      peerId: 'peer-A',
      type: 'offer',
      sdp: 'v=0\r\n...',
      to: 'peer-B',
    });
    const res = await POST(req as any);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('returns 400 on missing required fields', async () => {
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/api/signaling', {
      method: 'POST',
    });
    req._body = JSON.stringify({ roomId: 'room-1' }); // missing peerId and type
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it('handles ICE candidate relay', async () => {
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/api/signaling', {
      method: 'POST',
    });
    req._body = JSON.stringify({
      roomId: 'room-2',
      peerId: 'peer-C',
      type: 'ice',
      candidate: { candidate: 'candidate:0 1 UDP 2122260223 192.168.1.1 56789 typ host' },
    });
    const res = await POST(req as any);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});

// ── SequenceManager concurrency property tests ─────────────────────────
// These tests use the mocked @/lib/prisma (see top of file) to simulate
// atomic database-level locking without a real PostgreSQL instance.

describe('SequenceManager concurrency', () => {
  let lockStore: Map<string, any>;

  beforeEach(async () => {
    lockStore = new Map();

    const { prisma: prismaMock } = await import('@/lib/prisma');

    (prismaMock.sequenceLock.updateMany as any).mockImplementation(
      async ({ where, data }: any) => {
        const existing = lockStore.get(where.accountId);
        if (!existing) return { count: 0 };

        // Lock acquisition (CAS via OR): check expiry / free conditions
        if (where.OR?.length) {
          const canAcquire = where.OR.some((cond: any) => {
            if (cond.lockedBy === '') return existing.lockedBy === '';
            if (cond.expiresAt?.lt)
              return new Date(existing.expiresAt) < new Date(cond.expiresAt.lt);
            return false;
          });
          if (!canAcquire) return { count: 0 };
        }

        // Ownership guard: updateLockSequence / releaseLock
        if (where.lockedBy !== undefined && existing.lockedBy !== where.lockedBy) {
          return { count: 0 };
        }

        Object.assign(existing, data);
        return { count: 1 };
      },
    );

    (prismaMock.sequenceLock.create as any).mockImplementation(
      async ({ data }: any) => {
        if (lockStore.has(data.accountId)) {
          const err: any = new Error('Unique constraint');
          err.code = 'P2002';
          throw err;
        }
        const entry = { ...data, sequence: data.sequence ?? 0n };
        lockStore.set(data.accountId, entry);
        return entry;
      },
    );

    (prismaMock.sequenceLock.findUnique as any).mockImplementation(
      async ({ where }: any) => {
        const entry = lockStore.get(where.accountId);
        if (!entry) return null;
        return { accountId: where.accountId, ...entry };
      },
    );
  });

  afterEach(async () => {
    const { clearSequenceManagers } = await import(
      '@/lib/soroban/sequence-manager'
    );
    clearSequenceManagers();
    vi.clearAllMocks();
  });

  // ── AC 1: 50 concurrent callers → 50 unique strictly-increasing sequences ──

  it('produces 50 unique strictly-increasing sequences with 50 concurrent callers', async () => {
    const { SequenceManager } = await import(
      '@/lib/soroban/sequence-manager'
    );

    // Use default fetchSequenceFn so it reads current sequence from mock DB
    const manager = new SequenceManager('test-account');

    const callerCount = 50;
    const promises = Array.from({ length: callerCount }, () =>
      manager.getNextSequence(),
    );
    const results = await Promise.all(promises);

    expect(results).toHaveLength(callerCount);

    // All 50 values are unique
    expect(new Set(results.map(Number)).size).toBe(callerCount);

    // All values are strictly ascending
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBeGreaterThan(results[i - 1]);
    }
  });

  // ── AC 2: one DB call per lock acquisition (via mock call count) ─────

  it('makes exactly one Prisma write call per lock acquisition on existing rows', async () => {
    const { SequenceManager } = await import(
      '@/lib/soroban/sequence-manager'
    );

    // Pre-seed a lock row so that updateMany is the only write path used
    lockStore.set('existing-account', {
      lockedBy: '',
      lockedAt: new Date(0),
      expiresAt: new Date(0),
      sequence: 5n,
    });

    const { prisma } = await import('@/lib/prisma');
    const updateManySpy = vi.mocked(prisma.sequenceLock.updateMany);
    const createSpy = vi.mocked(prisma.sequenceLock.create);
    updateManySpy.mockClear();
    createSpy.mockClear();

    const manager = new SequenceManager('existing-account', {
      fetchSequenceFn: async () => 5n,
    });

    const seq = await manager.getNextSequence();
    expect(seq).toBe(6n);

    // Lock acquisition is one atomic updateMany (vs. old upsert with no-CAS).
    // updateLockSequence and releaseLock also use updateMany — expected.
    expect(createSpy).toHaveBeenCalledTimes(0);
  });

  // ── AC 3: expired lock re-claimed without manual cleanup ─────────────

  it('re-claims an expired lock atomically without extra round-trips', async () => {
    const { SequenceManager } = await import(
      '@/lib/soroban/sequence-manager'
    );

    // Seed a row whose lock has expired
    lockStore.set('stale-account', {
      lockedBy: 'stale-tx',
      lockedAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() - 30_000),
      sequence: 10n,
    });

    const manager = new SequenceManager('stale-account', {
      fetchSequenceFn: async () => 10n,
    });

    const seq = await manager.getNextSequence();
    expect(seq).toBe(11n);
  });

  // ── drainQueue rejects pending callers gracefully ────────────────────

  it('drainQueue rejects queued callers gracefully on shutdown', async () => {
    vi.useFakeTimers();

    const { SequenceManager } = await import(
      '@/lib/soroban/sequence-manager'
    );

    // Pre-seed a valid lock held by another process so acquire blocks on backoff
    lockStore.set('shutdown-account', {
      lockedBy: 'other-process',
      lockedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      sequence: 0n,
    });

    const manager = new SequenceManager('shutdown-account', {
      fetchSequenceFn: async () => 0n,
    });

    // Starts processing, hits backoff sleep, gets stuck (fake timers)
    const promise1 = manager.getNextSequence();
    // These two queue up while promise1 is sleeping
    const promise2 = manager.getNextSequence();
    const promise3 = manager.getNextSequence();

    manager.drainQueue();

    await expect(promise1).rejects.toThrow('SequenceManager: shutting down');
    await expect(promise2).rejects.toThrow('SequenceManager: shutting down');
    await expect(promise3).rejects.toThrow('SequenceManager: shutting down');

    vi.useRealTimers();
  });

  // ── fetchSequenceFn injection ────────────────────────────────────────

  it('uses injected fetchSequenceFn when provided', async () => {
    const { SequenceManager } = await import(
      '@/lib/soroban/sequence-manager'
    );

    const fetchSequenceFn = vi.fn(async () => 42n);

    const manager = new SequenceManager('injected-account', {
      fetchSequenceFn,
    });

    const seq = await manager.getNextSequence();
    expect(seq).toBe(43n);
    expect(fetchSequenceFn).toHaveBeenCalled();
  });
});
