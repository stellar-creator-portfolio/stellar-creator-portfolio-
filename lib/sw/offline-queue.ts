/**
 * Issue #630 — Client-side offline mutation queue
 *
 * Stores pending mutations in IndexedDB when the user is offline.
 * Registers a Background Sync tag so the service worker replays them
 * automatically once connectivity is restored.
 */

const DB_NAME = 'stellar-offline-queue';
const STORE_NAME = 'mutations';
const SYNC_TAG = 'stellar-mutation-queue';

export interface OfflineMutation {
  mutationId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timestamp: number;
  requiresAuth: boolean;
  retryCount: number;
  status: 'pending' | 'replaying' | 'failed' | 'success';
  failureReason?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2); // upgrading to v2
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: 'mutationId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Queue a mutation for later replay. */
export async function enqueue(mutation: Partial<OfflineMutation>): Promise<void> {
  const headers = { ...mutation.headers };
  const requiresAuth = !!headers['Authorization'] || !!headers['authorization'];
  
  // Strip Authorization header
  delete headers['Authorization'];
  delete headers['authorization'];

  const fullMutation: OfflineMutation = {
    mutationId: mutation.mutationId || crypto.randomUUID(),
    url: mutation.url!,
    method: mutation.method!,
    headers,
    body: mutation.body,
    timestamp: mutation.timestamp || Date.now(),
    requiresAuth: mutation.requiresAuth ?? requiresAuth,
    retryCount: mutation.retryCount ?? 0,
    status: mutation.status ?? 'pending',
    failureReason: mutation.failureReason
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(fullMutation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Notify the service worker to replay when online
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    const reg = await navigator.serviceWorker.ready;
    await reg.sync.register(SYNC_TAG);
  }
}

/** Retrieve all queued mutations without removing them. */
export async function listQueued(): Promise<OfflineMutation[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const results: OfflineMutation[] = [];
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).openCursor();
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        results.push(cursor.value as OfflineMutation);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function refreshAuthToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.accessToken;
  } catch (e) {
    return null;
  }
}

export async function clearStaleMutations(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const db = await openDB();
  const now = Date.now();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const mutation = cursor.value as OfflineMutation;
        if (now - mutation.timestamp > maxAgeMs) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function updateMutation(mutation: OfflineMutation): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(mutation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function calculateBackoff(retryCount: number): number {
  const base = 1000 * Math.pow(2, retryCount);
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(base + jitter, 32000);
}

/**
 * Replay all queued mutations directly from the page context.
 */
export async function flush(): Promise<{ replayed: number; failed: number; authFailed: number }> {
  const db = await openDB();
  const mutations = await listQueued();

  let replayed = 0;
  let failed = 0;
  let authFailed = 0;

  for (const mutation of mutations) {
    if (mutation.status === 'success' || mutation.status === 'failed') continue;

    mutation.status = 'replaying';
    await updateMutation(mutation);

    try {
      let headers = new Headers(mutation.headers);
      
      if (mutation.requiresAuth) {
        // Needs a real token, assume we can get it from localStorage or we need to refresh
        const token = await refreshAuthToken();
        if (!token) {
          authFailed++;
          mutation.status = 'pending'; // retry later
          await updateMutation(mutation);
          continue;
        }
        headers.set('Authorization', `Bearer ${token}`);
      }

      const res = await fetch(mutation.url, {
        method: mutation.method,
        headers,
        body: mutation.body,
      });

      if (res.status === 401 || res.status === 403) {
        // auth failed
        const token = await refreshAuthToken();
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
          const retryRes = await fetch(mutation.url, {
            method: mutation.method,
            headers,
            body: mutation.body,
          });
          
          if (!retryRes.ok) {
            throw new Error(`HTTP ${retryRes.status}`);
          }
        } else {
          authFailed++;
          mutation.status = 'pending';
          await updateMutation(mutation);
          continue;
        }
      } else if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      await deleteRecord(db, mutation.mutationId);
      replayed++;
    } catch (e: any) {
      mutation.retryCount = (mutation.retryCount || 0) + 1;
      
      if (mutation.retryCount >= 5) {
        mutation.status = 'failed';
        mutation.failureReason = e.message || 'Unknown error';
        failed++;
      } else {
        mutation.status = 'pending';
        // Wait backoff time? The problem says "Implement exponential backoff"
        // In flush, we might just apply backoff by sleeping or skipping? 
        // We can just sleep for backoff
        await new Promise(r => setTimeout(r, calculateBackoff(mutation.retryCount)));
      }
      
      await updateMutation(mutation);
    }
  }

  return { replayed, failed, authFailed };
}

function deleteRecord(db: IDBDatabase, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
