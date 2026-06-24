/**
 * backfill-embeddings.ts
 *
 * Idempotent script to generate and store vector embeddings for all creators.
 * Skips creators whose embeddings are already up to date.
 *
 * Usage:
 *   npx tsx scripts/backfill-embeddings.ts [--batch-size=50] [--dry-run]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EMBED_ENDPOINT =
  process.env.EMBED_ENDPOINT ?? 'https://api.openai.com/v1/embeddings';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'text-embedding-3-small';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const EMBED_DIMENSIONS = parseInt(process.env.EMBED_DIMENSIONS ?? '1536', 10);

interface BackfillOptions {
  batchSize: number;
  dryRun: boolean;
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  let batchSize = 50;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--batch-size=')) {
      batchSize = parseInt(arg.split('=')[1], 10);
    }
    if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { batchSize, dryRun };
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

function buildCreatorText(creator: {
  displayName: string;
  bio: string | null;
  discipline: string | null;
  skills: string[];
}): string {
  const parts = [creator.displayName];
  if (creator.bio) parts.push(creator.bio);
  if (creator.discipline) parts.push(`Discipline: ${creator.discipline}`);
  if (creator.skills.length > 0) parts.push(`Skills: ${creator.skills.join(', ')}`);
  return parts.join(' ');
}

function embeddingToSql(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function backfill({ batchSize, dryRun }: BackfillOptions) {
  console.log('Starting embedding backfill...');
  console.log(`Batch size: ${batchSize}, Dry run: ${dryRun}`);

  if (!OPENAI_API_KEY) {
    console.warn('Warning: OPENAI_API_KEY not set. Using mock embeddings.');
  }

  const totalCreators = await prisma.creatorProfile.count();
  console.log(`Total creators: ${totalCreators}`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  while (processed < totalCreators) {
    const creators = await prisma.creatorProfile.findMany({
      skip: processed,
      take: batchSize,
      include: { embedding: true },
    });

    if (creators.length === 0) break;

    for (const creator of creators) {
      if (creator.embedding?.embedding) {
        skipped++;
        continue;
      }

      try {
        const text = buildCreatorText(creator);
        const embedding = await generateEmbedding(text);
        const embeddingSql = embeddingToSql(embedding);

        if (!dryRun) {
          await prisma.$executeRaw`
            INSERT INTO "CreatorEmbedding" ("id", "creatorId", "embedding", "model", "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), ${creator.id}, ${embeddingSql}::vector, ${EMBED_MODEL}, NOW(), NOW())
            ON CONFLICT ("creatorId")
            DO UPDATE SET
              embedding = ${embeddingSql}::vector,
              model = ${EMBED_MODEL},
              updatedAt = NOW()
          `;
        }

        console.log(
          `[${dryRun ? 'DRY RUN' : 'OK'}] Embedded: ${creator.displayName} (${creator.id})`,
        );
      } catch (err) {
        console.error(
          `[FAILED] ${creator.displayName} (${creator.id}): ${(err as Error).message}`,
        );
        failed++;
      }
    }

    processed += creators.length;
    console.log(`Progress: ${processed}/${totalCreators} (skipped: ${skipped}, failed: ${failed})`);

    if (creators.length === batchSize) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  console.log('\nBackfill complete:');
  console.log(`  Processed: ${processed}`);
  console.log(`  Skipped (already embedded): ${skipped}`);
  console.log(`  Failed: ${failed}`);
}

backfill(parseArgs())
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
