import { NextRequest, NextResponse } from 'next/server';
import { executeSwap, QuoteExpiredError, IdempotentSwapError, type SwapQuote } from '@/lib/swap/cross-chain-sdk';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { quote, senderAddress } = body as { quote: SwapQuote; senderAddress: string };

    if (!quote || !senderAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: quote, senderAddress' },
        { status: 400 },
      );
    }

    const receipt = await executeSwap(quote, senderAddress);
    return NextResponse.json({ receipt, idempotent: false });
  } catch (err) {
    if (err instanceof QuoteExpiredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof IdempotentSwapError) {
      return NextResponse.json(
        { receipt: err.existingReceipt, idempotent: true },
        { status: 200 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
