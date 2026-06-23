import { NextRequest, NextResponse } from 'next/server';
import { getSwapStatus } from '@/lib/swap/cross-chain-sdk';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const receipt = await getSwapStatus(id);
  if (!receipt) {
    return NextResponse.json({ error: 'Swap not found' }, { status: 404 });
  }
  return NextResponse.json(receipt);
}
