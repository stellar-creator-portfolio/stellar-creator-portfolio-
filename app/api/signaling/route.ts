/**
 * GET  /api/signaling  — Returns ICE server configuration (STUN/TURN credentials)
 * POST /api/signaling  — HTTP fallback for SDP offer/answer relay
 *
 * This route is used by:
 *  1. Mobile clients (mobile/src/services/streaming.service.ts) that call
 *     `/api/signaling` for SDP signaling before switching to the standalone
 *     WebSocket signaling server.
 *  2. Web clients that need ICE server credentials without connecting to the
 *     signaling WebSocket first (e.g., to pre-warm the TURN connection).
 *
 * For production, clients should connect directly to the signaling WebSocket
 * server (server/signaling.ts) for the lowest latency.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';

const TURN_SECRET = process.env.TURN_SECRET ?? 'insecure-dev-secret';
const TURN_HOST = process.env.TURN_HOST ?? 'turn.example.com';
const TURN_PORT = parseInt(process.env.TURN_PORT ?? '3478', 10);
const TURN_TLS_PORT = parseInt(process.env.TURN_TLS_PORT ?? '5349', 10);
const STUN_URL = process.env.STUN_URL ?? 'stun:stun.l.google.com:19302';
const TURN_CREDENTIAL_TTL = parseInt(process.env.TURN_CREDENTIAL_TTL ?? '86400', 10);

// In-memory relay store for HTTP signaling fallback
// In production this should be replaced with Redis for multi-instance support
const signalingStore = new Map<
  string,
  { type: string; sdp?: string; candidate?: RTCIceCandidateInit; peerId: string; ts: number }[]
>();

// Prune entries older than 5 minutes
const STORE_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - STORE_TTL_MS;
  for (const [key, entries] of signalingStore) {
    const fresh = entries.filter((e) => e.ts > cutoff);
    if (fresh.length === 0) signalingStore.delete(key);
    else signalingStore.set(key, fresh);
  }
}, 60_000).unref?.();

interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

function generateIceServers(peerId: string) {
  const expiry = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL;
  const username = `${expiry}:${peerId}`;
  const credential = createHmac('sha1', TURN_SECRET)
    .update(username)
    .digest('base64');

  return [
    { urls: STUN_URL },
    { urls: `turn:${TURN_HOST}:${TURN_PORT}`, username, credential },
    { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`, username, credential },
    { urls: `turns:${TURN_HOST}:${TURN_TLS_PORT}`, username, credential },
  ];
}

/**
 * GET /api/signaling?peerId=<id>
 * Returns ICE server configuration including STUN and time-limited TURN credentials.
 */
export async function GET(req: NextRequest) {
  const peerId =
    req.nextUrl.searchParams.get('peerId') ??
    `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return NextResponse.json({
    iceServers: generateIceServers(peerId),
    signalingWsUrl: process.env.NEXT_PUBLIC_SIGNALING_URL ?? 'ws://localhost:3001',
    peerId,
  });
}

/**
 * POST /api/signaling
 *
 * HTTP fallback relay for SDP and ICE candidates.
 * Clients poll GET /api/signaling?roomId=<id>&peerId=<id>&since=<ts> to fetch messages.
 *
 * Body:
 *   roomId   string   The signaling room
 *   peerId   string   Sender peer ID
 *   type     string   "offer" | "answer" | "ice"
 *   sdp      string?  SDP string (for offer/answer)
 *   candidate object? ICE candidate (for ice)
 *   to       string?  Target peer ID (optional, broadcasts if omitted)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomId, peerId, type, sdp, candidate, to } = body;

    if (!roomId || !peerId || !type) {
      return NextResponse.json(
        { error: 'Missing required fields: roomId, peerId, type' },
        { status: 400 },
      );
    }

    const key = to ? `${roomId}:${to}` : roomId;
    const existing = signalingStore.get(key) ?? [];
    existing.push({ type, sdp, candidate, peerId, ts: Date.now() });
    signalingStore.set(key, existing);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
