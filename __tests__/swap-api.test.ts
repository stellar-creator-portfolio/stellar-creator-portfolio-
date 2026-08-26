import { describe, it, expect, beforeEach } from 'vitest';
import { POST as executePost } from '@/app/api/swap/execute/route';
import { POST as quotePost } from '@/app/api/swap/quote/route';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { getSwapQuote, type SwapQuote } from '@/lib/swap/cross-chain-sdk';
import { prisma } from '@/lib/prisma';

const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'dev-secret-change-me';

function createToken(userId: string) {
  return jwt.sign({ id: userId, role: 'USER' }, JWT_SECRET);
}

function createReq(body: any, token?: string) {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

describe('Swap API Adversarial', () => {
  const token = createToken('test-user-123');

  beforeEach(async () => {
    await prisma.crossChainSwap.deleteMany({});
  });

  it('401 unauthenticated execute', async () => {
    const req = createReq({ quote: {}, senderAddress: 'addr' });
    const res = await executePost(req);
    expect(res.status).toBe(401);
  });

  it('tamper -> 400', async () => {
    const quoteReq = createReq({ fromChain: 'stellar', toChain: 'polygon', fromAmount: '1000', slippageBps: 50 }, token);
    const quoteRes = await quotePost(quoteReq);
    const quote = await quoteRes.json();
    
    // tamper
    quote.toAmount = '9999999';
    
    const execReq = createReq({ quote, senderAddress: 'addr' }, token);
    const execRes = await executePost(execReq);
    expect(execRes.status).toBe(400);
    const text = await execRes.json();
    expect(text.error).toMatch(/tamper/i);
  });
});
