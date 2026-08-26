import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enqueue, flush, listQueued, clearStaleMutations, refreshAuthToken, OfflineMutation } from '../lib/sw/offline-queue';

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
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-' + Math.random() });
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
    // Can't directly assert since store is private to mock, but we can list queued
    const queued = await listQueued();
    expect(queued[0].headers['Authorization']).toBeUndefined();
    expect(queued[0].requiresAuth).toBe(true);
  });
});
