import { NextRequest, NextResponse } from 'next/server';
import { getSwapQuote, type ChainId } from '@/lib/swap/cross-chain-sdk';
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
    const { fromChain, toChain, fromAmount, slippageBps } = body;
    if (!fromChain || !toChain || !fromAmount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const quote = await getSwapQuote(fromChain, toChain, fromAmount, slippageBps);
    return NextResponse.json(quote);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
