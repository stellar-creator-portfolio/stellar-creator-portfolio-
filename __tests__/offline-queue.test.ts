import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enqueue, flush, listQueued, clearStaleMutations, refreshAuthToken, OfflineMutation } from '../lib/sw/offline-queue';

// Use actual crypto randomUUID if available, else mock with standard structure
if (!globalThis.crypto) {
  globalThis.crypto = require('crypto').webcrypto;
}

// Mock IndexedDB
const mockIndexedDB = () => {
  let store: any = {};
  return {
    open: vi.fn().mockReturnValue({
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      result: {
        objectStoreNames: { contains: () => true },
        transaction: () => ({
          objectStore: () => ({
            put: (item: any) => {
              store[item.mutationId] = item;
              return { onsuccess: null, onerror: null, set oncomplete(cb: any) { cb(); } };
            },
            delete: (id: string) => {
              delete store[id];
              return { onsuccess: null, onerror: null, set oncomplete(cb: any) { cb(); } };
            },
            openCursor: () => {
              let i = 0;
              const values = Object.values(store);
              return {
                onsuccess: null,
                onerror: null,
                set onsuccess(cb: any) {
                  const callCb = (idx: number) => {
                    if (idx < values.length) {
                      cb({ target: { result: { value: values[idx], continue: () => callCb(idx + 1), delete: () => delete store[(values[idx] as any).mutationId] } } });
                    } else {
                      cb({ target: { result: null } });
                    }
                  };
                  setTimeout(() => callCb(0), 0);
                }
              };
            }
          }),
          set oncomplete(cb: any) { setTimeout(cb, 0); },
          onerror: null
        })
      }
    })
  };
};

describe('Offline Queue', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', mockIndexedDB());
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('strips authorization header on enqueue', async () => {
    await enqueue({
      url: '/api/test',
      method: 'POST',
      headers: { 'Authorization': 'Bearer test', 'Content-Type': 'application/json' },
      body: '{}'
    });
    
    const queued = await listQueued();
    expect(queued[0].headers['Authorization']).toBeUndefined();
    expect(queued[0].requiresAuth).toBe(true);
    expect(queued[0].mutationId).toBeDefined();
  });
});

  it('handles 401 and refresh cycle', async () => {
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes('/api/auth/refresh')) {
        return { ok: true, json: async () => ({ accessToken: 'new-token' }) } as Response;
      }
      
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 401 } as Response;
      }
      return { ok: true, status: 200 } as Response;
    });

    await enqueue({
      url: '/api/data',
      method: 'POST',
      headers: { 'Authorization': 'Bearer old', 'Content-Type': 'application/json' },
      body: '{}'
    });

    const result = await flush();
    expect(result.replayed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.authFailed).toBe(0);
    
    const queued = await listQueued();
    expect(queued.length).toBe(0);
  });

  it('handles 5 retry backoff limit', async () => {
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      if (url.toString().includes('/api/auth/refresh')) {
        return { ok: true, json: async () => ({ accessToken: 'new-token' }) } as Response;
      }
      return { ok: false, status: 500 } as Response;
    });

    await enqueue({
      url: '/api/fail',
      method: 'POST',
      headers: {},
      body: '{}'
    });

    // Simulate 5 flushes
    for (let i = 0; i < 5; i++) {
      await flush();
    }

    const queued = await listQueued();
    expect(queued.length).toBe(1);
    expect(queued[0].status).toBe('failed');
    expect(queued[0].retryCount).toBe(5);
  });
