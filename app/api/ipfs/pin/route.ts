import { NextRequest, NextResponse } from 'next/server';
import { assertValidCidV1, createRawCidV1FromSha256 } from '@/lib/ipfs/cid';
import { buildGatewayUrl } from '@/lib/ipfs/gateways';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const { cid } = (await req.json()) as { cid?: string };

    try {
      assertValidCidV1(String(cid ?? ''));
    } catch {
      return NextResponse.json({ error: 'valid CIDv1 required' }, { status: 400 });
    }

    return NextResponse.json({ cid, retryAccepted: true }, { status: 202 });
  }

  const form = await req.formData();
  const file = form.get('file');
  const expectedSha256 = String(form.get('sha256') ?? '');

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const sha256 = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
    return NextResponse.json({ error: 'Hash mismatch' }, { status: 422 });
  }

  const cid = createRawCidV1FromSha256(sha256);
  const gatewayUrl = buildGatewayUrl(cid);

  return NextResponse.json({
    cid,
    sha256,
    size: buffer.byteLength,
    gatewayUrl,
  });
}
