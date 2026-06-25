/** Ordered IPFS gateway endpoints — primary first, fallbacks on failure. */
export const IPFS_GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
  process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? 'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://4everland.io/ipfs/',
] as const;

export function buildGatewayUrl(cid: string, gatewayIndex = 0): string {
  const base = IPFS_GATEWAYS[gatewayIndex] ?? IPFS_GATEWAYS[0];
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${normalized}${cid}`;
}

export async function fetchViaGateways(
  cid: string,
  verifyHash?: string,
): Promise<{ blob: Blob; gateway: string; verified: boolean }> {
  let lastError: Error | null = null;

  for (let i = 0; i < IPFS_GATEWAYS.length; i++) {
    const url = buildGatewayUrl(cid, i);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();

      if (verifyHash) {
        const verified = await verifyContentHash(blob, verifyHash);
        if (!verified) throw new Error('Hash mismatch');
        return { blob, gateway: url, verified: true };
      }

      return { blob, gateway: url, verified: false };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error('All IPFS gateways failed');
}

export async function verifyCidResolvable(cid: string): Promise<boolean> {
  for (let i = 0; i < IPFS_GATEWAYS.length; i++) {
    const url = buildGatewayUrl(cid, i);

    try {
      const head = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(8_000),
      });

      if (head.ok) return true;
      if (![405, 501].includes(head.status)) continue;

      const ranged = await fetch(url, {
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(8_000),
      });

      if (ranged.ok) return true;
    } catch {
      // Try the next gateway.
    }
  }

  return false;
}

export async function verifyContentHash(data: Blob | ArrayBuffer, expectedHex: string): Promise<boolean> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex === expectedHex.toLowerCase();
}
