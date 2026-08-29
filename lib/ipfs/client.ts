import {
  InvalidCidError,
  assertMatchingCid,
  assertValidCidV1,
  createRawCidV1FromSha256,
} from './cid';
import { buildGatewayUrl, fetchViaGateways, verifyCidResolvable, verifyContentHash } from './gateways';

export { InvalidCidError, createRawCidV1, createRawCidV1FromSha256, sha256ToCid } from './cid';

export interface IpfsUploadResult {
  cid: string;
  sha256: string;
  size: number;
  gatewayUrl: string;
}

export interface IpfsPinEntry {
  cid: string;
  sha256: string;
  name: string;
  size: number;
  pinnedAt: string;
  gatewayUrl: string;
}

const PIN_API = process.env.NEXT_PUBLIC_IPFS_PIN_API ?? '/api/ipfs/pin';
const PIN_REGISTRY_KEY = 'ipfs-pins';
const RETRY_PIN_TIMEOUT_MS = 30_000;

/** Compute SHA-256 hex digest using Web Crypto (browser-native). */
export async function computeSha256(file: Blob | ArrayBuffer): Promise<string> {
  const buffer = file instanceof Blob ? await file.arrayBuffer() : file;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Upload file directly from the browser to the pinning API. */
export async function uploadToIpfs(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<IpfsUploadResult> {
  const sha256 = await computeSha256(file);
  const expectedCid = createRawCidV1FromSha256(sha256);
  onProgress?.(10);

  const form = new FormData();
  form.append('file', file);
  form.append('sha256', sha256);

  const xhr = new XMLHttpRequest();

  const result = await new Promise<IpfsUploadResult>((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress?.(10 + Math.round((e.loaded / e.total) * 80));
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as IpfsUploadResult;
          onProgress?.(100);
          resolve(data);
        } catch {
          reject(new Error('Invalid pin response'));
        }
      } else {
        reject(new Error(`Pin failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during IPFS upload')));
    xhr.open('POST', PIN_API);
    xhr.send(form);
  });

  assertMatchingCid(result.cid, expectedCid);

  const resolved = await verifyCidResolvable(result.cid);
  if (!resolved && !(await retryPin(result.cid))) {
    throw new Error(`Pinned CID is not resolvable: ${result.cid}`);
  }

  savePinEntry({
    cid: result.cid,
    sha256,
    name: file.name,
    size: result.size,
    pinnedAt: new Date().toISOString(),
    gatewayUrl: result.gatewayUrl || buildGatewayUrl(result.cid),
  });
  return result;
}

export async function retryPin(cid: string): Promise<boolean> {
  assertValidCidV1(cid);

  const deadline = Date.now() + RETRY_PIN_TIMEOUT_MS;
  let delayMs = 500;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(PIN_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid }),
      });

      if (!res.ok) return false;
    } catch {
      return false;
    }

    if (await verifyCidResolvable(cid)) return true;

    await delay(Math.min(delayMs, Math.max(0, deadline - Date.now())));
    delayMs = Math.min(delayMs * 2, 4_000);
  }

  return false;
}

/** Retrieve pinned content with cryptographic hash verification and gateway fallback. */
export async function retrieveFromIpfs(
  cid: string,
  expectedSha256: string,
): Promise<{ blob: Blob; verified: boolean; gateway: string }> {
  const { blob, gateway, verified } = await fetchViaGateways(cid, expectedSha256);
  return { blob, verified, gateway };
}

export async function verifyRetrievedFile(blob: Blob, expectedSha256: string): Promise<boolean> {
  return verifyContentHash(blob, expectedSha256);
}

export function getPublicUrl(cid: string): string {
  return buildGatewayUrl(cid);
}

export function loadPinRegistry(): IpfsPinEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PIN_REGISTRY_KEY) ?? '[]';
    const entries = JSON.parse(raw) as IpfsPinEntry[];
    const migrated = migratePinRegistry(entries);

    if (JSON.stringify(migrated) !== raw) {
      localStorage.setItem(PIN_REGISTRY_KEY, JSON.stringify(migrated));
    }

    return migrated;
  } catch {
    return [];
  }
}

export function savePinEntry(entry: IpfsPinEntry): void {
  const existing = loadPinRegistry();
  localStorage.setItem(PIN_REGISTRY_KEY, JSON.stringify([entry, ...existing.filter((e) => e.cid !== entry.cid)]));
}

export function migratePinRegistry(entries: IpfsPinEntry[]): IpfsPinEntry[] {
  const migrated = new Map<string, IpfsPinEntry>();

  for (const entry of entries) {
    const cid = recomputeEntryCid(entry);
    const nextEntry = cid
      ? {
          ...entry,
          cid,
          gatewayUrl: buildGatewayUrl(cid),
        }
      : entry;

    migrated.set(nextEntry.cid, nextEntry);
  }

  return Array.from(migrated.values());
}

function recomputeEntryCid(entry: IpfsPinEntry): string | null {
  try {
    const cid = createRawCidV1FromSha256(entry.sha256);
    assertValidCidV1(cid);
    return cid;
  } catch (err) {
    if (err instanceof InvalidCidError) return null;
    throw err;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
