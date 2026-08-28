const STATIC_CACHE = 'stellar-static-v1';
const DYNAMIC_CACHE = 'stellar-dynamic-v1';
const IMAGE_CACHE = 'stellar-images-v1';
const ALL_CACHES = [STATIC_CACHE, DYNAMIC_CACHE, IMAGE_CACHE];

const STATIC_PRECACHE = [
  '/',
  '/offline.html',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => !ALL_CACHES.includes(n))
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.method !== 'GET') {
    event.respondWith(handleMutationRequest(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithMock(request));
  } else if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(js|css|woff2?|ttf|otf)$/)
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|avif|ico)$/)) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
  } else if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
  } else {
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
  }
});

async function networkFirstWithMock(request) {
  try {
    const response = await fetchWithTimeout(request.clone(), 5000);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request.clone(), response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return buildOfflineMock(new URL(request.url));
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request.clone(), response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request.clone()).then((response) => {
    if (response.ok) cache.put(request.clone(), response.clone());
    return response;
  });

  return cached ?? networkFetch;
}

async function navigationHandler(request) {
  try {
    const response = await fetchWithTimeout(request, 8000);
    const cache = await caches.open(DYNAMIC_CACHE);
    cache.put(request.clone(), response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match('/offline.html') ?? new Response('Offline', { status: 503 });
  }
}

function buildOfflineMock(url) {
  const body = getMockBody(url.pathname);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Served-By': 'service-worker-offline-mock',
    },
  });
}

function getMockBody(pathname) {
  if (pathname.startsWith('/api/creators')) {
    return { data: [], meta: { offline: true, total: 0 } };
  }
  if (pathname.startsWith('/api/bounties')) {
    return { data: [], meta: { offline: true, total: 0 } };
  }
  if (pathname.startsWith('/api/messages')) {
    return { data: [], meta: { offline: true } };
  }
  if (pathname.startsWith('/api/analytics')) {
    return { offline: true, metrics: {} };
  }
  return { offline: true, error: 'Unavailable offline' };
}

// ── Mutation queue (non-GET requests while offline) ───────────────────────────

const DB_NAME = 'stellar-offline-queue';
const STORE_NAME = 'mutations';

function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: 'mutationId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueOfflineMutation(request) {
  const db = await openQueueDB();
  const body = await request.text();
  const headersObj = {};
  for (const [key, value] of request.headers.entries()) {
    headersObj[key] = value;
  }
  
  const requiresAuth = !!headersObj['authorization'];
  delete headersObj['authorization'];
  delete headersObj['Authorization'];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      mutationId: crypto.randomUUID(),
      url: request.url,
      method: request.method,
      headers: headersObj,
      body,
      timestamp: Date.now(),
      requiresAuth,
      retryCount: 0,
      status: 'pending'
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function handleMutationRequest(request) {
  try {
    return await fetch(request);
  } catch {
    await enqueueOfflineMutation(request.clone());
    return new Response(JSON.stringify({ queued: true, offline: true }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Background Sync ───────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'stellar-mutation-queue') {
    event.waitUntil(replayMutationQueue());
  }
});

function calculateBackoff(retryCount) {
  const base = 1000 * Math.pow(2, retryCount);
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(base + jitter, 32000);
}

async function refreshAuthToken() {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.accessToken;
  } catch (e) {
    return null;
  }
}

async function replayMutationQueue() {
  const db = await openQueueDB();
  const mutations = await getAllMutations(db);

  for (const record of mutations) {
    if (record.status === 'success' || record.status === 'failed') continue;

    try {
      record.status = 'replaying';
      await updateMutation(db, record);

      let headers = new Headers(record.headers);
      
      if (record.requiresAuth) {
        const token = await refreshAuthToken();
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        } else {
          record.status = 'pending';
          await updateMutation(db, record);
          continue;
        }
      }

      const res = await fetch(record.url, {
        method: record.method,
        headers,
        body: record.body || undefined,
      });

      if (res.status === 401 || res.status === 403) {
        const token = await refreshAuthToken();
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
          const retryRes = await fetch(record.url, {
            method: record.method,
            headers,
            body: record.body || undefined,
          });
          if (!retryRes.ok) throw new Error(`HTTP ${retryRes.status}`);
        } else {
          record.status = 'pending';
          await updateMutation(db, record);
          continue;
        }
      } else if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      await deleteMutation(db, record.mutationId);
    } catch (e) {
      record.retryCount = (record.retryCount || 0) + 1;
      if (record.retryCount >= 5) {
        record.status = 'failed';
        record.failureReason = e.message || 'Unknown error';
        await updateMutation(db, record);
        
        // Notify clients
        const clients = await self.clients.matchAll();
        for (const client of clients) {
          client.postMessage({
            type: 'MUTATION_FAILED',
            mutationId: record.mutationId,
            reason: record.failureReason
          });
        }
      } else {
        record.status = 'pending';
        await updateMutation(db, record);
        await new Promise(r => setTimeout(r, calculateBackoff(record.retryCount)));
      }
    }
  }
}

function getAllMutations(db) {
  return new Promise((resolve, reject) => {
    const results = [];
    const tx = db.transaction(STORE_NAME, 'readonly');
    const cursor = tx.objectStore(STORE_NAME).openCursor();
    cursor.onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) {
        results.push(cur.value);
        cur.continue();
      } else {
        resolve(results);
      }
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

function updateMutation(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function deleteMutation(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchWithTimeout(request, ms) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => !ALL_CACHES.includes(n))
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim())
      .then(() => {
        return self.clients.matchAll().then(clients => {
          clients.forEach(client => client.postMessage("SW_ACTIVATED"));
        });
      })
  );
});
