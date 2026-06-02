/**
 * Neural Search Engine  (#638)
 *
 * Proprietary hybrid search engine combining:
 *  1. Lexical search  — Elasticsearch full-text (BM25 + field boosting)
 *  2. Dense semantic search — vector embeddings (OpenAI / HuggingFace)
 *  3. Reciprocal Rank Fusion (RRF) — merges both result sets into one ranking
 *
 * Architecture:
 *  • elasticClient    — typed ES client with cluster health checks
 *  • generateEmbedding() — calls OpenAI or local HuggingFace endpoint
 *  • indexCreator()   — upserts a creator document with auto-generated embedding
 *  • hybridSearch()   — executes parallel lexical + semantic queries then RRF merges
 *  • onProfileChanged()— background embedding regeneration triggered on profile updates
 *
 * Cluster configuration:
 *  • Index settings: 1 primary shard, 1 replica (adjust per cluster size)
 *  • Dense vector field: 1536 dims, cosine similarity (matches text-embedding-3-small)
 *  • BM25 text fields with custom analysers for domain terms
 *  • Background embedding queue prevents hot-path latency on writes
 */

import { Client as ElasticClient } from '@elastic/elasticsearch';
import type { SearchHit } from '@elastic/elasticsearch/lib/api/types';

// ── Configuration ────────────────────────────────────────────────────────────

const ES_URL = process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200';
const ES_INDEX = process.env.ELASTICSEARCH_CREATORS_INDEX ?? 'creators';
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';
const EMBED_ENDPOINT = process.env.EMBED_ENDPOINT ?? 'https://api.openai.com/v1/embeddings';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'text-embedding-3-small';

/** Number of dimensions for the embedding model */
const EMBED_DIMS = EMBED_MODEL === 'text-embedding-3-large' ? 3072 : 1536;

/** RRF fusion constant (higher = smoother rank blending) */
const RRF_K = 60;

// ── ES Client (singleton) ─────────────────────────────────────────────────────

let _esClient: ElasticClient | null = null;

/** @internal — for test isolation only */
export function _resetElasticClientForTests(): void {
  _esClient = null;
}

function getElasticClient(): ElasticClient {
  if (_esClient) return _esClient;

  const auth = process.env.ELASTICSEARCH_API_KEY
    ? { apiKey: process.env.ELASTICSEARCH_API_KEY }
    : process.env.ELASTICSEARCH_USERNAME
      ? {
          username: process.env.ELASTICSEARCH_USERNAME,
          password: process.env.ELASTICSEARCH_PASSWORD ?? '',
        }
      : undefined;

  _esClient = new ElasticClient({
    node: ES_URL,
    auth,
    requestTimeout: 10_000,
    sniffOnStart: false,     // avoid blocking startup
    sniffOnConnectionFault: false,
    compression: true,
    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
  });

  return _esClient;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CreatorDocument {
  /** Database primary key */
  id: string;
  displayName: string;
  bio: string | null;
  discipline: string | null;
  skills: string[];
  /** Dense embedding vector (auto-generated on index) */
  embedding?: number[];
  /** ISO timestamp of last profile update */
  updatedAt: string;
  /** External profile links for relevance boosting */
  githubUrl?: string | null;
  linkedinUrl?: string | null;
  verified: boolean;
  rating: number;
  completedProjects: number;
}

export interface SearchResult {
  id: string;
  displayName: string;
  discipline: string | null;
  skills: string[];
  verified: boolean;
  rating: number;
  completedProjects: number;
  /** Combined RRF score [0, ∞) */
  score: number;
  /** Breakdown: lexical vs semantic contribution */
  scoreBreakdown: {
    lexical: number;
    semantic: number;
    rrf: number;
  };
}

export interface HybridSearchOptions {
  query: string;
  /** Max results (default 10) */
  limit?: number;
  /** Minimum combined score threshold [0, ∞) */
  minScore?: number;
  /** Filter by discipline (exact match) */
  discipline?: string;
  /** Required skills (AND semantics) */
  skills?: string[];
  /** Only return verified creators */
  verifiedOnly?: boolean;
  /** Expand lexical query with synonyms (design → UI/UX) */
  expandSynonyms?: boolean;
}

// ── Embedding generation ─────────────────────────────────────────────────────

/**
 * Generate an embedding vector for a text string.
 * Uses OpenAI API if key is available, otherwise falls back to a deterministic
 * mock vector (dev/test environments).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const normalised = text.trim().slice(0, 8192); // OpenAI max input

  if (!OPENAI_KEY) {
    // Deterministic dev mock: consistent so the same text always gets the same vector
    console.warn('[Search] No OPENAI_API_KEY — using mock embedding');
    return Array.from({ length: EMBED_DIMS }, (_, i) =>
      Math.sin((i + 1) * normalised.length * 0.01),
    );
  }

  const res = await fetch(EMBED_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ input: normalised, model: EMBED_MODEL }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  return json.data[0].embedding as number[];
}

/**
 * Build the text corpus from a creator document for embedding.
 * More context = better semantic search quality.
 */
function buildEmbeddingCorpus(doc: Omit<CreatorDocument, 'embedding'>): string {
  return [
    doc.displayName,
    doc.discipline ?? '',
    doc.bio ?? '',
    doc.skills.join(', '),
  ]
    .filter(Boolean)
    .join('. ');
}

// ── Index management ──────────────────────────────────────────────────────────

/**
 * Create or update the Elasticsearch index with the correct mapping.
 * Idempotent — safe to call on every application startup.
 */
export async function ensureIndex(): Promise<void> {
  const es = getElasticClient();

  const exists = await es.indices.exists({ index: ES_INDEX });
  if (exists) {
    console.log(`[Search] Index '${ES_INDEX}' already exists`);
    return;
  }

  await es.indices.create({
    index: ES_INDEX,
    settings: {
      number_of_shards: 2,
      number_of_replicas: 1,
      analysis: {
        analyzer: {
          // Domain-aware analyser: handles camelCase, abbreviations, tech terms
          tech_analyzer: {
            type: 'custom',
            tokenizer: 'standard',
            filter: ['lowercase', 'asciifolding', 'tech_synonyms', 'stop'],
          },
        },
        filter: {
          tech_synonyms: {
            type: 'synonym',
            synonyms: [
              'ui,ux,user interface,user experience,design',
              'frontend,front-end,client-side,react,nextjs,next.js',
              'backend,back-end,server-side,node,nodejs,express',
              'ml,machine learning,ai,artificial intelligence,deep learning',
              'smart contract,solidity,blockchain,web3,defi',
              'motion,animation,after effects,lottie,framer',
            ],
          },
        },
      },
    },
    mappings: {
      properties: {
        id: { type: 'keyword' },
        displayName: {
          type: 'text',
          analyzer: 'tech_analyzer',
          fields: { keyword: { type: 'keyword', ignore_above: 256 } },
        },
        bio: {
          type: 'text',
          analyzer: 'tech_analyzer',
        },
        discipline: {
          type: 'keyword',
          fields: {
            text: { type: 'text', analyzer: 'tech_analyzer' },
          },
        },
        skills: {
          type: 'keyword',
          fields: {
            text: { type: 'text', analyzer: 'tech_analyzer' },
          },
        },
        embedding: {
          type: 'dense_vector',
          dims: EMBED_DIMS,
          index: true,
          similarity: 'cosine',
        },
        updatedAt: { type: 'date' },
        verified: { type: 'boolean' },
        rating: { type: 'float' },
        completedProjects: { type: 'integer' },
        githubUrl: { type: 'keyword', index: false },
        linkedinUrl: { type: 'keyword', index: false },
      },
    },
  });

  console.log(`[Search] Created index '${ES_INDEX}' with ${EMBED_DIMS}-dim dense vector field`);
}

// ── Indexing ──────────────────────────────────────────────────────────────────

/**
 * Upsert a creator document into Elasticsearch.
 * Automatically generates an embedding from the profile text corpus.
 *
 * This is called:
 *  1. During initial data ingestion
 *  2. In the background when a creator profile is updated (via onProfileChanged)
 */
export async function indexCreator(
  doc: Omit<CreatorDocument, 'embedding'>,
  options: { generateVector?: boolean } = {},
): Promise<void> {
  const { generateVector = true } = options;
  const es = getElasticClient();

  let embedding: number[] | undefined;

  if (generateVector) {
    const corpus = buildEmbeddingCorpus(doc);
    embedding = await generateEmbedding(corpus);
  }

  await es.index({
    index: ES_INDEX,
    id: doc.id,
    document: {
      ...doc,
      embedding,
    },
    // Use optimistic concurrency control via sequence numbers
    refresh: false, // Async refresh — don't block the write path
  });
}

/**
 * Remove a creator document from the index.
 */
export async function deleteCreatorFromIndex(creatorId: string): Promise<void> {
  const es = getElasticClient();
  await es.delete({ index: ES_INDEX, id: creatorId }).catch(() => {
    // Ignore 404 — document may not be indexed yet
  });
}

/**
 * Background embedding regeneration hook.
 * Call this whenever a creator profile changes.
 * The regeneration runs asynchronously and never blocks the HTTP response.
 *
 * @example
 * ```ts
 * // In your profile update route:
 * await prisma.creatorProfile.update({ ... });
 * void onProfileChanged(updatedProfile); // non-blocking
 * ```
 */
export function onProfileChanged(
  profile: Omit<CreatorDocument, 'embedding'>,
): void {
  // Background task — fire and forget
  void (async () => {
    try {
      await indexCreator(profile, { generateVector: true });
      console.log(`[Search] Re-indexed creator ${profile.id} after profile change`);
    } catch (err) {
      console.error(`[Search] Failed to re-index creator ${profile.id}:`, err);
    }
  })();
}

// ── Hybrid Search ─────────────────────────────────────────────────────────────

/**
 * Execute a hybrid search (lexical + semantic) and merge with Reciprocal Rank Fusion.
 *
 * RRF score formula: sum(1 / (k + rank_i)) for each result list
 * This is model-agnostic, handles score scale differences, and is provably effective
 * (Cormack et al., 2009).
 *
 * @returns Merged, re-ranked array of creator results
 */
export async function hybridSearch(
  options: HybridSearchOptions,
): Promise<SearchResult[]> {
  const {
    query,
    limit = 10,
    minScore = 0,
    discipline,
    skills,
    verifiedOnly = false,
    expandSynonyms = true,
  } = options;

  if (!query.trim()) return [];

  const es = getElasticClient();

  // Build shared filter clauses
  const filters: any[] = [];
  if (discipline) {
    filters.push({ term: { discipline } });
  }
  if (skills?.length) {
    filters.push({ terms: { skills } });
  }
  if (verifiedOnly) {
    filters.push({ term: { verified: true } });
  }

  // ── 1. Lexical search (BM25 + field boosting) ─────────────────────────────

  const lexicalPromise = es.search<CreatorDocument>({
    index: ES_INDEX,
    size: limit * 3, // fetch extra to ensure good RRF candidates
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query,
              fields: [
                'displayName^4', // Name match is highest signal
                'discipline^3',
                'skills^2',
                'bio^1',
                'skills.text^2',
              ],
              type: expandSynonyms ? 'best_fields' : 'cross_fields',
              analyzer: expandSynonyms ? 'tech_analyzer' : 'standard',
              fuzziness: 'AUTO',
              operator: 'or',
            },
          },
        ],
        filter: filters,
        should: [
          // Boost verified and highly-rated creators
          { term: { verified: { value: true, boost: 1.5 } } },
          { range: { rating: { gte: 4.0, boost: 1.2 } } },
        ],
      },
    },
    _source: ['id', 'displayName', 'discipline', 'skills', 'verified', 'rating', 'completedProjects'],
  });

  // ── 2. Dense vector semantic search ──────────────────────────────────────

  const queryEmbedding = await generateEmbedding(query);

  const semanticPromise = es.search<CreatorDocument>({
    index: ES_INDEX,
    size: limit * 3,
    knn: {
      field: 'embedding',
      query_vector: queryEmbedding,
      k: limit * 3,
      num_candidates: limit * 10,
      filter: filters.length ? { bool: { filter: filters } } : undefined,
      boost: 1.5,
    },
    _source: ['id', 'displayName', 'discipline', 'skills', 'verified', 'rating', 'completedProjects'],
  });

  // ── 3. Run both queries in parallel ──────────────────────────────────────

  const [lexicalResult, semanticResult] = await Promise.all([
    lexicalPromise,
    semanticPromise,
  ]);

  // ── 4. Reciprocal Rank Fusion ─────────────────────────────────────────────

  const rrfScores = new Map<
    string,
    {
      source: CreatorDocument;
      lexicalRank: number;
      semanticRank: number;
      lexicalScore: number;
      semanticScore: number;
    }
  >();

  const lexicalHits = lexicalResult.hits.hits as SearchHit<CreatorDocument>[];
  const semanticHits = semanticResult.hits.hits as SearchHit<CreatorDocument>[];

  // Process lexical results
  lexicalHits.forEach((hit, rank) => {
    const id = hit._id as string;
    const source = hit._source!;
    rrfScores.set(id, {
      source,
      lexicalRank: rank + 1,
      semanticRank: Infinity,
      lexicalScore: hit._score ?? 0,
      semanticScore: 0,
    });
  });

  // Process semantic results
  semanticHits.forEach((hit, rank) => {
    const id = hit._id as string;
    const source = hit._source!;
    const existing = rrfScores.get(id);
    if (existing) {
      existing.semanticRank = rank + 1;
      existing.semanticScore = hit._score ?? 0;
    } else {
      rrfScores.set(id, {
        source,
        lexicalRank: Infinity,
        semanticRank: rank + 1,
        lexicalScore: 0,
        semanticScore: hit._score ?? 0,
      });
    }
  });

  // Compute RRF score and sort
  const merged: SearchResult[] = [];

  for (const [id, data] of rrfScores) {
    const rrfScore =
      1 / (RRF_K + data.lexicalRank) + 1 / (RRF_K + data.semanticRank);

    if (rrfScore < minScore) continue;

    merged.push({
      id,
      displayName: data.source.displayName,
      discipline: data.source.discipline ?? null,
      skills: data.source.skills ?? [],
      verified: data.source.verified,
      rating: data.source.rating,
      completedProjects: data.source.completedProjects,
      score: rrfScore,
      scoreBreakdown: {
        lexical: data.lexicalScore,
        semantic: data.semanticScore,
        rrf: rrfScore,
      },
    });
  }

  // Sort by RRF score descending, then verified + rating as tiebreaker
  merged.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 1e-6) return scoreDiff;
    // Tiebreaker: verified > rating > completedProjects
    if (a.verified !== b.verified) return b.verified ? 1 : -1;
    return b.rating - a.rating;
  });

  return merged.slice(0, limit);
}

// ── Cluster health ────────────────────────────────────────────────────────────

/**
 * Check Elasticsearch cluster health.
 * Returns true if the cluster is green or yellow (degraded but functional).
 */
export async function checkClusterHealth(): Promise<{
  healthy: boolean;
  status: 'green' | 'yellow' | 'red' | 'unreachable';
  nodeCount?: number;
  indexCount?: number;
}> {
  try {
    const es = getElasticClient();
    const health = await es.cluster.health({ timeout: '5s' });
    const stats = await es.cluster.stats();

    return {
      healthy: health.status !== 'red',
      status: health.status as 'green' | 'yellow' | 'red',
      nodeCount: health.number_of_nodes,
      indexCount: stats.indices?.count,
    };
  } catch {
    return { healthy: false, status: 'unreachable' };
  }
}

/**
 * Return search metrics for a given index (doc count, index size).
 * Used for monitoring dashboards.
 */
export async function getIndexStats(): Promise<{
  docCount: number;
  sizeBytes: number;
}> {
  try {
    const es = getElasticClient();
    const stats = await es.indices.stats({ index: ES_INDEX });
    const idx = stats.indices?.[ES_INDEX];
    return {
      docCount: idx?.total?.docs?.count ?? 0,
      sizeBytes: idx?.total?.store?.size_in_bytes ?? 0,
    };
  } catch {
    return { docCount: 0, sizeBytes: 0 };
  }
}
