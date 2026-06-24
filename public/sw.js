const CACHE_VERSION = 'v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const ALL_CACHES = [STATIC_CACHE, DYNAMIC_CACHE, IMAGE_CACHE];

const STATIC_PRECACHE = [
  '/',
  '/offline.html',
  '/manifest.json',
];

// ── Lifecycle ─────────────────────────────────────────────────────────────────

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

// ── Fetch interception ────────────────────────────────────────────────────────

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

// ── Routing strategies ────────────────────────────────────────────────────────

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

// ── Offline API mocking ───────────────────────────────────────────────────────

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

// ── Mutation queue ────────────────────────────────────────────────────────────

function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('stellar-offline-queue', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('mutations', { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueOfflineMutation(request) {
  const db = await openQueueDB();
  const body = await request.text();
  const headers = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  const hasAuth = 'authorization' in headers;
  delete headers['authorization'];
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    tx.objectStore('mutations').add({
      url: request.url,
      method: request.method,
      headers,
      body,
      timestamp: Date.now(),
      requiresAuth: hasAuth,
      retryCount: 0,
      status: 'pending',
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
    event.waitUntil(notifyClientsToFlush());
  }
});

async function notifyClientsToFlush() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'FLUSH_OFFLINE_QUEUE' });
  }
}

// Listen for flush results from clients
self.addEventListener('message', (event) => {
  if (event.data?.type === 'FLUSH_RESULT') {
    const { replayed, failed, authFailed } = event.data;
    if (failed > 0 || authFailed > 0) {
      self.registration.showNotification('Offline Queue Sync', {
        body: `Replayed: ${replayed}, Failed: ${failed}, Auth failures: ${authFailed}`,
        icon: '/icons/icon-192.png',
      });
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchWithTimeout(request, ms) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}
