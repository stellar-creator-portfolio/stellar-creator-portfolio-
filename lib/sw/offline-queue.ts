const DB_NAME = 'stellar-offline-queue';
const STORE_NAME = 'mutations';
const SYNC_TAG = 'stellar-mutation-queue';
const MAX_RETRIES = 5;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface OfflineMutation {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timestamp: number;
  requiresAuth?: boolean;
  retryCount: number;
  status: 'pending' | 'failed';
  failureReason?: string;
}

export interface FlushResult {
  replayed: number;
  failed: number;
  authFailed: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function computeBackoff(attempt: number): number {
  const base = Math.min(Math.pow(2, attempt) * 1000, 32000);
  return base + Math.floor(Math.random() * 1000);
}

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('stellar_auth_token');
}

function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('stellar_refresh_token');
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const newToken = data.access_token || data.token;
    if (newToken) {
      localStorage.setItem('stellar_auth_token', newToken);
      if (data.refresh_token) {
        localStorage.setItem('stellar_refresh_token', data.refresh_token);
      }
    }
    return newToken;
  } catch {
    return null;
  }
}

export async function enqueue(mutation: OfflineMutation): Promise<void> {
  const db = await openDB();
  const headers = { ...mutation.headers };
  const hasAuth = typeof headers['authorization'] !== 'undefined' || typeof headers['Authorization'] !== 'undefined';
  delete headers['authorization'];
  delete headers['Authorization'];

  const record: OfflineMutation = {
    ...mutation,
    headers,
    requiresAuth: hasAuth,
    retryCount: 0,
    status: 'pending',
    timestamp: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
    const reg = await navigator.serviceWorker.ready;
    await reg.sync.register(SYNC_TAG);
  }
}

export async function listQueued(): Promise<OfflineMutation[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const results: OfflineMutation[] = [];
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).openCursor();
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        results.push(normalize(cursor.value));
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function flush(): Promise<FlushResult> {
  const db = await openDB();
  const entries = await listAllWithKeys(db);

  let replayed = 0;
  let failed = 0;
  let authFailed = 0;

  for (const { key, mutation } of entries) {
    const m = normalize(mutation);
    if (m.status === 'failed') continue;

    let token: string | null = null;
    let didRefresh = false;
    let success = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (m.requiresAuth) {
          if (!token) token = getAuthToken();
          if (!token && !didRefresh) {
            token = await refreshAccessToken();
            if (token) didRefresh = true;
          }
        }

        const h: Record<string, string> = { ...m.headers };
        if (m.requiresAuth && token) {
          h['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(m.url, {
          method: m.method,
          headers: new Headers(h),
          body: m.body,
        });

        if (res.ok) {
          await deleteRecord(db, key);
          replayed++;
          success = true;
          break;
        }

        if (res.status === 401 && m.requiresAuth) {
          if (!didRefresh) {
            token = await refreshAccessToken();
            if (token) {
              didRefresh = true;
              attempt--;
              continue;
            }
          }
          authFailed++;
          await updateRecord(db, key, { ...m, status: 'failed', retryCount: attempt, failureReason: 'Authentication failed' });
          break;
        }

        if (attempt >= MAX_RETRIES) {
          await updateRecord(db, key, { ...m, status: 'failed', retryCount: attempt, failureReason: `HTTP ${res.status}` });
          failed++;
          break;
        }

        await sleep(computeBackoff(attempt));
      } catch (err) {
        if (attempt >= MAX_RETRIES) {
          await updateRecord(db, key, { ...m, status: 'failed', retryCount: attempt, failureReason: err instanceof Error ? err.message : 'Network error' });
          failed++;
          break;
        }
        await sleep(computeBackoff(attempt));
      }
    }
  }

  return { replayed, failed, authFailed };
}

export async function retryFailed(): Promise<FlushResult> {
  const db = await openDB();
  const entries = await listAllWithKeys(db);

  for (const { key, mutation } of entries) {
    if (mutation.status !== 'failed') continue;
    await updateRecord(db, key, { ...mutation, status: 'pending', retryCount: 0, failureReason: undefined });
  }

  return flush();
}

export async function clearStaleMutations(): Promise<number> {
  const db = await openDB();
  const entries = await listAllWithKeys(db);
  const cutoff = Date.now() - MAX_AGE_MS;
  let removed = 0;

  for (const { key, mutation } of entries) {
    if ((mutation.timestamp || 0) < cutoff) {
      await deleteRecord(db, key);
      removed++;
    }
  }

  return removed;
}

export async function getQueueStats(): Promise<{ pending: number; failed: number }> {
  const mutations = await listQueued();
  let pending = 0;
  let failed = 0;
  for (const m of mutations) {
    if (m.status === 'failed') failed++;
    else pending++;
  }
  return { pending, failed };
}

function normalize(m: any): OfflineMutation {
  const hasStoredAuth = typeof m.headers?.Authorization !== 'undefined' || typeof m.headers?.authorization !== 'undefined';
  const h: Record<string, string> = {};
  if (m.headers) {
    for (const k of Object.keys(m.headers)) {
      const lk = k.toLowerCase();
      if (lk !== 'authorization') h[k] = m.headers[k];
    }
  }
  return {
    url: m.url || '',
    method: m.method || 'GET',
    headers: h,
    body: m.body,
    timestamp: m.timestamp || Date.now(),
    requiresAuth: m.requiresAuth ?? hasStoredAuth,
    retryCount: m.retryCount ?? 0,
    status: m.status || 'pending',
    failureReason: m.failureReason,
  };
}

function listAllWithKeys(db: IDBDatabase): Promise<Array<{ key: IDBValidKey; mutation: OfflineMutation }>> {
  return new Promise((resolve, reject) => {
    const results: Array<{ key: IDBValidKey; mutation: OfflineMutation }> = [];
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).openCursor();
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        results.push({ key: cursor.key, mutation: normalize(cursor.value) });
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

function deleteRecord(db: IDBDatabase, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function updateRecord(db: IDBDatabase, key: IDBValidKey, mutation: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(mutation, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
