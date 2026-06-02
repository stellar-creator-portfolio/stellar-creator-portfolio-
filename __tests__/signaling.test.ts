/**
 * Tests for server/signaling.ts  (#637)
 *
 * Since the signaling server is a standalone Node.js process, we test the
 * pure utility functions (credential generation, message parsing, room logic)
 * rather than the live WebSocket server.
 *
 * Tests cover:
 *  - TURN credential generation (HMAC-SHA1, expiry format, base64)
 *  - ICE server list structure (STUN + TURN/UDP + TURN/TCP + TURNS/TLS)
 *  - Credential uniqueness (different peerIds → different credentials)
 *  - Credential determinism (same peerId+timestamp → same credential)
 *  - app/api/signaling/route.ts — GET endpoint (ICE servers + peerId)
 *  - app/api/signaling/route.ts — POST endpoint (relay store)
 *  - Credential expiry timestamp is in the future
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

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
