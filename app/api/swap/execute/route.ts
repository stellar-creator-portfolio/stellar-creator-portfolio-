import { NextRequest, NextResponse } from 'next/server';
import { executeSwap, QuoteExpiredError, IdempotentSwapError, type SwapQuote } from '@/lib/swap/cross-chain-sdk';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'dev-secret-change-me';

function authenticate(req: NextRequest) {
  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return decoded.id || decoded.sub || decoded.userId;
  } catch {
    return null;
  }
}

import { redisCheckRateLimit } from '@/lib/storage/redis';

export async function POST(req: NextRequest) {
  const userId = authenticate(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const remaining = await redisCheckRateLimit(userId, 30);
  if (remaining < 0) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

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
    if ((err as Error).message.includes('Invalid quote signature') || (err as Error).message.includes('tamper')) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
