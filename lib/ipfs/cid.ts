import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import * as digest from 'multiformats/hashes/digest';
import { sha256 } from 'multiformats/hashes/sha2';

const SHA256_HEX_LENGTH = 64;

export class InvalidCidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCidError';
  }
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new InvalidCidError('SHA-256 digest must be a 64 character hex string');
  }

  const bytes = new Uint8Array(SHA256_HEX_LENGTH / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function createRawCidV1FromSha256(sha256Hex: string): string {
  const multihash = digest.create(sha256.code, hexToBytes(sha256Hex));
  return CID.createV1(raw.code, multihash).toString();
}

export async function createRawCidV1(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes =
    data instanceof Blob
      ? new Uint8Array(await data.arrayBuffer())
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data;
  const multihash = await sha256.digest(bytes);
  return CID.createV1(raw.code, multihash).toString();
}

export function assertValidCidV1(cid: string): void {
  try {
    const parsed = CID.parse(cid);
    if (parsed.version !== 1) {
      throw new InvalidCidError('CID must be version 1');
    }
  } catch (err) {
    if (err instanceof InvalidCidError) throw err;
    throw new InvalidCidError(`Invalid CID: ${cid}`);
  }
}

export function assertMatchingCid(serverCid: string, expectedCid: string): void {
  assertValidCidV1(serverCid);
  if (serverCid !== expectedCid) {
    throw new InvalidCidError(`Pin API returned CID ${serverCid}, expected ${expectedCid}`);
  }
}

/**
 * @deprecated Use createRawCidV1FromSha256 instead. This function now returns a
 * valid CIDv1 for backward compatibility with callers that still pass SHA-256 hex.
 */
export function sha256ToCid(sha256Hex: string): string {
  return createRawCidV1FromSha256(sha256Hex);
}
