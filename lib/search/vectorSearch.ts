/**
 * vectorSearch
 *
 * Semantic search over creator portfolios using vector embeddings.
 *
 * Flow:
 *  1. The query string is sent to the embedding endpoint to get a vector.
 *  2. The vector is compared against stored creator embeddings via cosine
 *     similarity (delegated to pgvector via the /api/search/vector endpoint).
 *  3. Results are ranked by similarity score and optionally filtered by
 *     high-dimension tag vectors.
 */

const EMBED_ENDPOINT =
  process.env.NEXT_PUBLIC_EMBED_ENDPOINT ?? '/api/search/embed';

export interface VectorSearchResult {
  id: string;
  name: string;
  title: string;
  discipline: string;
  skills: string[];
  /** Cosine similarity score [0, 1]. */
  score: number;
  /** Matched tag labels from high-dimension tag filtering. */
  matchedTags: string[];
}

export interface VectorSearchOptions {
  /** Maximum number of results to return. */
  limit?: number;
  /** Minimum similarity threshold [0, 1]. */
  threshold?: number;
  /** Additional tag filters applied after vector ranking. */
  tags?: string[];
}

/**
 * Perform a semantic search over creator portfolios.
 *
 * @param query   Natural-language search query.
 * @param options Search options.
 */
export async function vectorSearch(
  query: string,
  options: VectorSearchOptions = {},
): Promise<VectorSearchResult[]> {
  const { limit = 10, threshold = 0.5, tags = [] } = options;

  const res = await fetch('/api/search/vector', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit, threshold, tags }),
  });

  if (res.status === 429) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }

  if (!res.ok) {
    throw new Error(`Vector search failed: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Compute cosine similarity between two equal-length vectors.
 * Used client-side for lightweight re-ranking.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  if (a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Filter results by tag overlap using a simple Jaccard-like score.
 * Tags are treated as a high-dimension binary feature space.
 */
export function filterByTags(
  results: VectorSearchResult[],
  requiredTags: string[],
): VectorSearchResult[] {
  if (!requiredTags.length) return results;
  const required = new Set(requiredTags.map((t) => t.toLowerCase()));
  return results
    .map((r) => {
      const matched = r.skills
        .concat(r.discipline)
        .filter((s) => required.has(s.toLowerCase()));
      return { ...r, matchedTags: matched };
    })
    .filter((r) => r.matchedTags.length > 0)
    .sort(
      (a, b) =>
        b.matchedTags.length - a.matchedTags.length || b.score - a.score,
    );
}
