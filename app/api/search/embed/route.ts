/**
 * POST /api/search/embed
 *
 * Generates vector embeddings for text using OpenAI's embedding model.
 * Used for semantic search over creator portfolios.
 */

import { NextRequest, NextResponse } from 'next/server';
import { redisIncr, KEYS } from '@/lib/storage/redis';

const EMBED_ENDPOINT =
  process.env.EMBED_ENDPOINT ?? 'https://api.openai.com/v1/embeddings';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'text-embedding-3-small';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const EMBED_DIMENSIONS = parseInt(process.env.EMBED_DIMENSIONS ?? '1536', 10);
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60;

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') ?? 'unknown';
}

async function generateEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    return Array.from({ length: EMBED_DIMENSIONS }, (_, i) =>
      Math.sin(i + text.length),
    );
  }

  const res = await fetch(EMBED_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ input: text, model: EMBED_MODEL }),
  });

  if (!res.ok) {
    throw new Error(`Embedding API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return json.data[0].embedding as number[];
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rateLimitKey = KEYS.rateLimit(`embed:${ip}`);
    const count = await redisIncr(rateLimitKey, RATE_LIMIT_WINDOW);

    if (count !== null && count > RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        { status: 429 },
      );
    }

    const { text } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 });
    }

    if (text.length > 8000) {
      return NextResponse.json(
        { error: 'Text too long (max 8000 characters)' },
        { status: 400 },
      );
    }

    const embedding = await generateEmbedding(text.trim());

    return NextResponse.json({ embedding, dimensions: embedding.length });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
