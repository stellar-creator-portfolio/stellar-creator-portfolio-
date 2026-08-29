import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CID } from 'multiformats/cid';
import {
  InvalidCidError,
  computeSha256,
  createRawCidV1FromSha256,
  loadPinRegistry,
  retryPin,
  uploadToIpfs,
  sha256ToCid,
} from '@/lib/ipfs/client';
import { verifyCidResolvable } from '@/lib/ipfs/gateways';

type MockResponse = {
  status?: number;
  responseText?: string;
};

class MockXMLHttpRequest {
  static nextResponse: MockResponse = {};

  status = 200;
  responseText = '';
  upload = {
    addEventListener: vi.fn(),
  };

  private listeners = new Map<string, Array<() => void>>();

  addEventListener(event: string, listener: () => void) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  open = vi.fn();

  send = vi.fn(() => {
    this.status = MockXMLHttpRequest.nextResponse.status ?? 200;
    this.responseText = MockXMLHttpRequest.nextResponse.responseText ?? '{}';
    queueMicrotask(() => this.listeners.get('load')?.forEach((listener) => listener()));
  });
}

function randomSha256Hex(seed: number): string {
  let state = seed;
  const bytes = Array.from({ length: 32 }, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state & 0xff).toString(16).padStart(2, '0');
  });

  return bytes.join('');
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
  MockXMLHttpRequest.nextResponse = {};
});

describe('IPFS CID storage', () => {
  it('generates CIDv1 strings parseable by multiformats for random SHA-256 inputs', () => {
    for (let i = 1; i <= 1000; i++) {
      const cid = sha256ToCid(randomSha256Hex(i));
      expect(CID.parse(cid).toString()).toBe(cid);
    }
  });

  it('round-trips raw asset bytes through CID.parse', async () => {
    const data = new Uint8Array(1024 * 1024);
    data.fill(19);

    const sha256 = await computeSha256(data.buffer);
    const cid = createRawCidV1FromSha256(sha256);

    expect(CID.parse(cid).toString()).toBe(cid);
  });

  it('throws InvalidCidError when the pin API returns a CID mismatch', async () => {
    const file = new File(['portfolio asset'], 'portfolio.txt', { type: 'text/plain' });
    const wrongCid = createRawCidV1FromSha256('0'.repeat(64));

    MockXMLHttpRequest.nextResponse = {
      responseText: JSON.stringify({
        cid: wrongCid,
        sha256: await computeSha256(file),
        size: file.size,
        gatewayUrl: `https://cloudflare-ipfs.com/ipfs/${wrongCid}`,
      }),
    };

    await expect(uploadToIpfs(file)).rejects.toBeInstanceOf(InvalidCidError);
    expect(localStorage.getItem('ipfs-pins')).toBeNull();
  });

  it('returns resolver status from gateway probes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyCidResolvable('bafkreidfgbocdkw2zloho6funocvwy42kttbbj4p4cmq6rj4sce3nxa6la')).resolves.toBe(
      true,
    );

    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    await expect(verifyCidResolvable('bafkreifabricatedcidvalueforatestonly')).resolves.toBe(false);
  });

  it('does not write localStorage when the pin API fails', async () => {
    const file = new File(['broken upload'], 'broken.txt', { type: 'text/plain' });

    MockXMLHttpRequest.nextResponse = {
      status: 500,
      responseText: JSON.stringify({ error: 'pin failed' }),
    };

    await expect(uploadToIpfs(file)).rejects.toThrow('Pin failed: 500');
    expect(localStorage.getItem('ipfs-pins')).toBeNull();
  });

  it('writes localStorage only after the CID is resolvable', async () => {
    const file = new File(['verified upload'], 'verified.txt', { type: 'text/plain' });
    const sha256 = await computeSha256(file);
    const cid = createRawCidV1FromSha256(sha256);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    MockXMLHttpRequest.nextResponse = {
      responseText: JSON.stringify({
        cid,
        sha256,
        size: file.size,
        gatewayUrl: `https://cloudflare-ipfs.com/ipfs/${cid}`,
      }),
    };

    await uploadToIpfs(file);

    expect(loadPinRegistry()).toEqual([
      expect.objectContaining({
        cid,
        name: 'verified.txt',
        sha256,
      }),
    ]);
  });

  it('retries pin verification with backoff until the CID resolves', async () => {
    vi.useFakeTimers();

    const cid = createRawCidV1FromSha256('3'.repeat(64));
    let postAttempts = 0;
    let probeAttempts = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') {
          postAttempts += 1;
          return { ok: true, status: 202 };
        }

        probeAttempts += 1;
        return probeAttempts >= 3 ? { ok: true, status: 200 } : { ok: false, status: 404 };
      }),
    );

    const retryPromise = retryPin(cid);

    await vi.advanceTimersByTimeAsync(1_500);

    await expect(retryPromise).resolves.toBe(true);
    expect(postAttempts).toBe(3);
    expect(probeAttempts).toBeGreaterThanOrEqual(3);
  });

  it('migrates legacy pseudo-CIDs in localStorage to valid CIDv1 records', () => {
    const sha256 = '1'.repeat(64);
    const legacyCid = `bafy${sha256.slice(0, 52)}`;

    localStorage.setItem(
      'ipfs-pins',
      JSON.stringify([
        {
          cid: legacyCid,
          sha256,
          name: 'legacy.png',
          size: 42,
          pinnedAt: '2026-06-21T00:00:00.000Z',
          gatewayUrl: `https://ipfs.io/ipfs/${legacyCid}`,
        },
      ]),
    );

    const [entry] = loadPinRegistry();

    expect(entry.cid).toBe(createRawCidV1FromSha256(sha256));
    expect(CID.parse(entry.cid).toString()).toBe(entry.cid);
    expect(entry.gatewayUrl).toContain(entry.cid);
  });
});
