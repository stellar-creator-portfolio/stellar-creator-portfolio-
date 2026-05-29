/**
 * High-availability RPC client for Soroban.
 *
 * Maintains a pool of endpoints per network. On each call it tries the
 * current primary; on timeout or error it rotates to the next endpoint and
 * retries. A lightweight latency probe runs in the background to keep the
 * healthiest node at the front of the pool.
 */

import { type NetworkName } from "./network";

// ---------------------------------------------------------------------------
// Endpoint pools — env vars override defaults at each position.
// ---------------------------------------------------------------------------

const POOLS: Record<NetworkName, string[]> = {
  mainnet: [
    process.env.NEXT_PUBLIC_MAINNET_RPC_URL ?? "https://soroban-mainnet.stellar.org",
    process.env.NEXT_PUBLIC_MAINNET_RPC_URL_2 ?? "https://mainnet.stellar.validationcloud.io/v1/soroban/rpc",
    process.env.NEXT_PUBLIC_MAINNET_RPC_URL_3 ?? "https://rpc.ankr.com/stellar_soroban",
  ],
  testnet: [
    process.env.NEXT_PUBLIC_TESTNET_RPC_URL ?? "https://soroban-testnet.stellar.org",
    process.env.NEXT_PUBLIC_TESTNET_RPC_URL_2 ?? "https://testnet.stellar.validationcloud.io/v1/soroban/rpc",
  ],
};

const REQUEST_TIMEOUT_MS = 5_000;
const PROBE_INTERVAL_MS  = 30_000;

// ---------------------------------------------------------------------------
// Per-network state
// ---------------------------------------------------------------------------

interface PoolState {
  urls: string[];
  index: number;          // current primary
  latencies: number[];    // last measured ms per endpoint (Infinity = unknown)
  probeTimer?: ReturnType<typeof setInterval>;
}

const state: Record<NetworkName, PoolState> = {
  mainnet: { urls: [...POOLS.mainnet], index: 0, latencies: POOLS.mainnet.map(() => Infinity) },
  testnet: { urls: [...POOLS.testnet], index: 0, latencies: POOLS.testnet.map(() => Infinity) },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rotate(pool: PoolState): void {
  pool.index = (pool.index + 1) % pool.urls.length;
}

/** Promote the lowest-latency endpoint to index 0. */
function reorder(pool: PoolState): void {
  const best = pool.latencies.indexOf(Math.min(...pool.latencies));
  if (best > 0) {
    [pool.urls[0], pool.urls[best]] = [pool.urls[best], pool.urls[0]];
    [pool.latencies[0], pool.latencies[best]] = [pool.latencies[best], pool.latencies[0]];
    pool.index = 0;
  }
}

async function fetchWithTimeout(url: string, body: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Latency probe
// ---------------------------------------------------------------------------

async function probeEndpoint(url: string): Promise<number> {
  const ping = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "getHealth", params: [] });
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(url, ping);
    if (!res.ok) return Infinity;
    await res.json();
    return Date.now() - t0;
  } catch {
    return Infinity;
  }
}

async function runProbe(pool: PoolState): Promise<void> {
  const results = await Promise.all(pool.urls.map(probeEndpoint));
  results.forEach((ms, i) => { pool.latencies[i] = ms; });
  reorder(pool);
}

/** Start background health probing for a network (idempotent). */
export function startProbing(network: NetworkName): void {
  const pool = state[network];
  if (pool.probeTimer) return;
  // Run once immediately, then on interval.
  void runProbe(pool);
  pool.probeTimer = setInterval(() => void runProbe(pool), PROBE_INTERVAL_MS);
}

/** Stop background probing (e.g. in tests or SSR teardown). */
export function stopProbing(network: NetworkName): void {
  const pool = state[network];
  if (pool.probeTimer) {
    clearInterval(pool.probeTimer);
    pool.probeTimer = undefined;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RpcCallResult<T> {
  data: T;
  endpoint: string;       // which URL actually served the response
  attempts: number;
}

/**
 * Send a JSON-RPC request to the pool for `network`, automatically retrying
 * against the next endpoint on timeout or HTTP error.
 *
 * @throws if all endpoints fail.
 */
export async function rpcCall<T = unknown>(
  network: NetworkName,
  method: string,
  params: unknown = [],
): Promise<RpcCallResult<T>> {
  const pool = state[network];
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const tried = new Set<number>();

  for (let attempt = 1; attempt <= pool.urls.length; attempt++) {
    const idx = pool.index;
    if (tried.has(idx)) { rotate(pool); continue; }
    tried.add(idx);

    const url = pool.urls[idx];
    try {
      const res = await fetchWithTimeout(url, body);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = (await res.json()) as { result?: T; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? "RPC error");

      return { data: json.result as T, endpoint: url, attempts: attempt };
    } catch {
      rotate(pool);
    }
  }

  throw new Error(
    `All ${pool.urls.length} RPC endpoints failed for network "${network}" (method: ${method})`,
  );
}

/** Convenience: return the URL of the current primary endpoint. */
export function getPrimaryRpcUrl(network: NetworkName): string {
  const pool = state[network];
  return pool.urls[pool.index];
}

/** Snapshot of pool health — useful for observability/dashboards. */
export function getPoolHealth(network: NetworkName): { url: string; latencyMs: number }[] {
  const pool = state[network];
  return pool.urls.map((url, i) => ({ url, latencyMs: pool.latencies[i] }));
}
