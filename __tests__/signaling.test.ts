import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Redis so tests always hit the in-memory fallback path
vi.mock('@/lib/storage/redis', () => ({
  redisSet: vi.fn().mockResolvedValue(undefined),
  redisGet: vi.fn().mockResolvedValue(null),
  getRedisClient: vi.fn().mockReturnValue(null),
}));

import {
  signalingStore,
  clearPruningInterval,
  ensurePruningInterval,
} from '@/app/api/signaling/route';

function makeEntry(roomId: string, ageMs: number) {
  return { type: 'offer', peerId: 'p1', ts: Date.now() - ageMs, sdp: 'v=0' };
}

beforeEach(() => {
  // Clear any real-timer interval from module load, then enable fake timers
  clearPruningInterval();
  vi.useFakeTimers();
  signalingStore.clear();
  // Start a fresh interval under fake timers
  ensurePruningInterval();
});

afterEach(() => {
  clearPruningInterval();
  vi.useRealTimers();
});

// ── clearPruningInterval ──────────────────────────────────────────────────────

describe('clearPruningInterval', () => {
  it('stops the pruning timer so no further cleanups occur', () => {
    // Write an expired entry
    signalingStore.set('room1', [makeEntry('room1', 10 * 60_000)]);

    // Advance past the 60s prune cycle
    vi.advanceTimersByTime(60_000);

    // The expired entry should be gone
    expect(signalingStore.size).toBe(0);

    // Now clear the interval
    clearPruningInterval();

    // Add another expired entry
    signalingStore.set('room2', [makeEntry('room2', 10 * 60_000)]);

    // Advance well past the next prune cycle — should NOT be pruned
    vi.advanceTimersByTime(120_000);
    expect(signalingStore.has('room2')).toBe(true);
  });
});

// ── TTL expiry via mocked timers ──────────────────────────────────────────────

describe('in-memory TTL expiry', () => {
  it('removes expired entries after simulated 5 minutes', () => {
    const store = signalingStore;

    // Fresh entry — should survive
    store.set('active', [makeEntry('active', 0)]);

    // Stale entry — should be pruned
    store.set('stale', [makeEntry('stale', 6 * 60_000)]);

    // Advance time to trigger the pruning interval
    vi.advanceTimersByTime(60_000);

    expect(store.has('active')).toBe(true);
    expect(store.has('stale')).toBe(false);
  });

  it('removes rooms with only expired entries', () => {
    const store = signalingStore;
    store.set('room', [makeEntry('room', 7 * 60_000)]);

    vi.advanceTimersByTime(60_000);

    expect(store.has('room')).toBe(false);
  });

  it('keeps rooms with mixed fresh and stale entries', () => {
    const store = signalingStore;
    store.set('mixed', [
      makeEntry('mixed', 7 * 60_000), // stale
      makeEntry('mixed', 1 * 60_000), // fresh
    ]);

    vi.advanceTimersByTime(60_000);

    expect(store.has('mixed')).toBe(true);
    expect(store.get('mixed')!.length).toBe(1);
  });
});

// ── Memory leak test ──────────────────────────────────────────────────────────

describe('memory leak prevention', () => {
  it('does not leak heap after cycling 10,000 entries through expiry', () => {
    const store = signalingStore;

    // Fill to capacity with expired entries
    for (let i = 0; i < 10_000; i++) {
      store.set(`room-${i}`, [makeEntry(`room-${i}`, 10 * 60_000)]);
    }

    // Force a GC cycle if available
    if (globalThis.gc) globalThis.gc();
    const afterFill = process.memoryUsage().heapUsed;

    // Prune everything
    vi.advanceTimersByTime(60_000);
    expect(store.size).toBe(0);

    // Fill again with fresh entries
    for (let i = 0; i < 10_000; i++) {
      store.set(`room-${i}`, [makeEntry(`room-${i}`, 0)]);
    }

    if (globalThis.gc) globalThis.gc();
    const afterCycle = process.memoryUsage().heapUsed;

    // Heap should not have grown by more than 10 MB between cycles.
    // Without --expose-gc, GC is non-deterministic; 10k small objects
    // may linger. A real leak would be orders of magnitude larger.
    expect(afterCycle - afterFill).toBeLessThan(10 * 1024 * 1024);
  });
});

// ── Duplicate interval prevention ─────────────────────────────────────────────

describe('HMR / duplicate interval prevention', () => {
  it('clearPruningInterval is idempotent', () => {
    clearPruningInterval();
    clearPruningInterval();
    clearPruningInterval();
    expect(signalingStore.size).toBe(0);
  });

  it('ensurePruningInterval is idempotent', () => {
    ensurePruningInterval();
    ensurePruningInterval();
    ensurePruningInterval();
    // Should still work — no duplicate intervals
    signalingStore.set('room', [makeEntry('room', 10 * 60_000)]);
    vi.advanceTimersByTime(60_000);
    expect(signalingStore.size).toBe(0);
  });
});
