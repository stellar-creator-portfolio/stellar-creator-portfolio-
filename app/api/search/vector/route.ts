/**
 * POST /api/search/vector
 *
 * Semantic vector search over creator portfolios using pgvector.
 *
 * 1. Embeds the query string via the configured embedding model.
 * 2. Queries the database for the nearest-neighbour creators using
 *    pgvector's <=> operator (cosine distance).
 * 3. Applies optional tag filters and returns ranked results.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { redisIncr, redisGet, redisSet, KEYS, TTL } from '@/lib/storage/redis';

const EMBED_ENDPOINT =
  process.env.EMBED_ENDPOINT ?? 'https://api.openai.com/v1/embeddings';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'text-embedding-3-small';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const EMBED_DIMENSIONS = parseInt(process.env.EMBED_DIMENSIONS ?? '1536', 10);
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60;
const EMBEDDING_CACHE_TTL = 3600;

let prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') ?? 'unknown';
}

async function generateEmbedding(text: string): Promise<number[]> {
  const cacheKey = KEYS.rateLimit(`embed_cache:${text}`);
  const cached = await redisGet<number[]>(cacheKey);
  if (cached) return cached;

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
  const embedding = json.data[0].embedding as number[];

  await redisSet(cacheKey, embedding, EMBEDDING_CACHE_TTL);

  return embedding;
}

function embeddingToSql(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rateLimitKey = KEYS.rateLimit(`vector:${ip}`);
    const count = await redisIncr(rateLimitKey, RATE_LIMIT_WINDOW);

    if (count !== null && count > RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        { status: 429 },
      );
    }

    const { query, limit = 10, threshold = 0.5, tags = [] } = await req.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    const embedding = await generateEmbedding(query.trim());
    const embeddingSql = embeddingToSql(embedding);

    const db = getPrisma();

    const results = await db.$queryRaw`
      SELECT
        cp.id,
        cp."displayName" as name,
        cp."userId" as "userId",
        cp.discipline,
        cp.skills,
        ce.model,
        1 - (ce.embedding <=> ${embeddingSql}::vector) as score
      FROM "CreatorEmbedding" ce
      JOIN "CreatorProfile" cp ON cp.id = ce."creatorId"
      WHERE ce.embedding IS NOT NULL
        AND 1 - (ce.embedding <=> ${embeddingSql}::vector) > ${threshold}
      ORDER BY score DESC
      LIMIT ${limit}
    `;

    let mappedResults = (results as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      title: r.discipline,
      discipline: r.discipline,
      skills: r.skills ?? [],
      score: parseFloat(r.score),
      matchedTags: [],
    }));

    if (tags.length > 0) {
      const required = new Set((tags as string[]).map((t) => t.toLowerCase()));
      mappedResults = mappedResults
        .map((r) => ({
          ...r,
          matchedTags: (r.skills ?? [])
            .concat(r.discipline ?? '')
            .filter((s: string) => required.has(s.toLowerCase())),
        }))
        .filter((r) => r.matchedTags.length > 0)
        .sort(
          (a, b) =>
            b.matchedTags.length - a.matchedTags.length || b.score - a.score,
        );
    }

    return NextResponse.json(mappedResults);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
