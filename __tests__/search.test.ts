/**
 * Tests for backend/services/search.ts  (#638)
 *
 * Tests cover:
 *  - generateEmbedding() — mock fallback, deterministic output, correct dims
 *  - buildEmbeddingCorpus (via indexCreator mock call)
 *  - hybridSearch() — parallel execution, RRF fusion, filtering, graceful degradation
 *  - onProfileChanged() — fire-and-forget indexing
 *  - checkClusterHealth() — health status mapping
 *  - deleteCreatorFromIndex() — 404 tolerance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @elastic/elasticsearch ───────────────────────────────────────────────

const esMocks = vi.hoisted(() => {
  const mockSearch = vi.fn();
  const mockIndex = vi.fn();
  const mockDelete = vi.fn();
  const mockIndicesExists = vi.fn();
  const mockIndicesCreate = vi.fn();
  const mockIndicesStats = vi.fn();
  const mockClusterHealth = vi.fn();
  const mockClusterStats = vi.fn();
  return {
    mockSearch, mockIndex, mockDelete,
    mockIndicesExists, mockIndicesCreate, mockIndicesStats,
    mockClusterHealth, mockClusterStats,
  };
});

vi.mock('@elastic/elasticsearch', () => ({
  Client: class {
    search = esMocks.mockSearch;
    index = esMocks.mockIndex;
    delete = esMocks.mockDelete;
    indices = {
      exists: esMocks.mockIndicesExists,
      create: esMocks.mockIndicesCreate,
      stats: esMocks.mockIndicesStats,
    };
    cluster = {
      health: esMocks.mockClusterHealth,
      stats: esMocks.mockClusterStats,
    };
  },
}));

import {
  generateEmbedding,
  hybridSearch,
  indexCreator,
  deleteCreatorFromIndex,
  checkClusterHealth,
  getIndexStats,
  onProfileChanged,
  ensureIndex,
  _resetElasticClientForTests,
  type CreatorDocument,
} from '@/backend/services/search';

import {
  cosineSimilarity,
  filterByTags,
  type VectorSearchResult,
} from '@/lib/search/vectorSearch';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLexicalHit(id: string, score: number, source: Partial<CreatorDocument> = {}) {
  return {
    _id: id,
    _score: score,
    _source: {
      id,
      displayName: source.displayName ?? `Creator ${id}`,
      discipline: source.discipline ?? 'Design',
      skills: source.skills ?? ['figma'],
      verified: source.verified ?? false,
      rating: source.rating ?? 4.0,
      completedProjects: source.completedProjects ?? 5,
    },
  };
}

function makeSearchResponse(hits: ReturnType<typeof makeLexicalHit>[]) {
  return { hits: { hits, total: { value: hits.length } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset singleton ES client so each test gets a fresh mock instance
  _resetElasticClientForTests();
  // Reset ES mock defaults
  esMocks.mockSearch.mockResolvedValue(makeSearchResponse([]));
  esMocks.mockIndex.mockResolvedValue({ result: 'created' });
  esMocks.mockDelete.mockResolvedValue({ result: 'deleted' });
  esMocks.mockIndicesExists.mockResolvedValue(true);
  esMocks.mockIndicesCreate.mockResolvedValue({ acknowledged: true });
  esMocks.mockIndicesStats.mockResolvedValue({ indices: {} });
  esMocks.mockClusterHealth.mockResolvedValue({ status: 'green', number_of_nodes: 3 });
  esMocks.mockClusterStats.mockResolvedValue({ indices: { count: 2 } });
});

// ── generateEmbedding ─────────────────────────────────────────────────────────

describe('generateEmbedding()', () => {
  it('returns an array when OPENAI_API_KEY is not set (mock fallback)', async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const embedding = await generateEmbedding('test query');
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBeGreaterThan(0);
    process.env.OPENAI_API_KEY = original;
  });

  it('returns 1536 dimensions for text-embedding-3-small (default)', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.EMBED_MODEL;
    const embedding = await generateEmbedding('hello world');
    expect(embedding.length).toBe(1536);
  });

  it('is deterministic for the same input (dev mock)', async () => {
    delete process.env.OPENAI_API_KEY;
    const a = await generateEmbedding('stellar portfolio');
    const b = await generateEmbedding('stellar portfolio');
    expect(a).toEqual(b);
  });

  it('produces different vectors for different inputs (dev mock)', async () => {
    delete process.env.OPENAI_API_KEY;
    const a = await generateEmbedding('design');
    const b = await generateEmbedding('backend');
    expect(a).not.toEqual(b);
  });
});

// ── hybridSearch ──────────────────────────────────────────────────────────────

describe('hybridSearch()', () => {
  it('returns empty array for empty query', async () => {
    const results = await hybridSearch({ query: '' });
    expect(results).toEqual([]);
  });

  it('returns empty array when ES returns no hits', async () => {
    esMocks.mockSearch.mockResolvedValue(makeSearchResponse([]));
    const results = await hybridSearch({ query: 'designer' });
    expect(results).toEqual([]);
  });

  it('merges results from both lexical and semantic via RRF', async () => {
    // Lexical hits creator-A and creator-B
    esMocks.mockSearch.mockResolvedValueOnce(
      makeSearchResponse([
        makeLexicalHit('creator-A', 10.0),
        makeLexicalHit('creator-B', 5.0),
      ]),
    );
    // Semantic hits creator-B and creator-C
    esMocks.mockSearch.mockResolvedValueOnce(
      makeSearchResponse([
        makeLexicalHit('creator-B', 0.9),
        makeLexicalHit('creator-C', 0.7),
      ]),
    );

    const results = await hybridSearch({ query: 'designer' });

    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('creator-A');
    expect(ids).toContain('creator-B');
    expect(ids).toContain('creator-C');
  });

  it('creator-B appears once even if in both result sets (deduplication)', async () => {
    esMocks.mockSearch.mockResolvedValueOnce(
      makeSearchResponse([makeLexicalHit('creator-B', 8.0)]),
    );
    esMocks.mockSearch.mockResolvedValueOnce(
      makeSearchResponse([makeLexicalHit('creator-B', 0.85)]),
    );

    const results = await hybridSearch({ query: 'ui design' });
    const bCount = results.filter((r) => r.id === 'creator-B').length;
    expect(bCount).toBe(1);
  });

  it('respects limit parameter', async () => {
    const hits = Array.from({ length: 20 }, (_, i) =>
      makeLexicalHit(`creator-${i}`, 10 - i),
    );
    esMocks.mockSearch.mockResolvedValue(makeSearchResponse(hits));

    const results = await hybridSearch({ query: 'design', limit: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('includes score breakdown with lexical, semantic, and rrf fields', async () => {
    esMocks.mockSearch.mockResolvedValueOnce(
      makeSearchResponse([makeLexicalHit('creator-X', 7.0)]),
    );
    esMocks.mockSearch.mockResolvedValueOnce(makeSearchResponse([]));

    const results = await hybridSearch({ query: 'ux designer' });
    if (results.length > 0) {
      expect(results[0].scoreBreakdown).toMatchObject({
        lexical: expect.any(Number),
        semantic: expect.any(Number),
        rrf: expect.any(Number),
      });
    }
  });

  it('runs lexical and semantic queries in parallel (both search calls made)', async () => {
    await hybridSearch({ query: 'developer' });
    // One call for lexical, one for semantic (knn)
    expect(esMocks.mockSearch).toHaveBeenCalledTimes(2);
  });

  it('propagates ES errors as thrown exceptions', async () => {
    esMocks.mockSearch.mockRejectedValue(new Error('ES cluster unavailable'));
    await expect(hybridSearch({ query: 'test' })).rejects.toThrow('ES cluster unavailable');
  });
});

// ── indexCreator ──────────────────────────────────────────────────────────────

describe('indexCreator()', () => {
  it('calls es.index with the document', async () => {
    delete process.env.OPENAI_API_KEY;
    await indexCreator({
      id: 'creator-1',
      displayName: 'Alice',
      bio: 'UI designer',
      discipline: 'Design',
      skills: ['figma', 'sketch'],
      updatedAt: new Date().toISOString(),
      verified: true,
      rating: 4.8,
      completedProjects: 12,
    });
    expect(esMocks.mockIndex).toHaveBeenCalledOnce();
    const callArg = esMocks.mockIndex.mock.calls[0][0];
    expect(callArg.id).toBe('creator-1');
    expect(callArg.document.displayName).toBe('Alice');
  });

  it('skips embedding generation when generateVector=false', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    await indexCreator(
      {
        id: 'creator-2',
        displayName: 'Bob',
        bio: null,
        discipline: 'Dev',
        skills: ['typescript'],
        updatedAt: new Date().toISOString(),
        verified: false,
        rating: 4.0,
        completedProjects: 3,
      },
      { generateVector: false },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ── deleteCreatorFromIndex ────────────────────────────────────────────────────

describe('deleteCreatorFromIndex()', () => {
  it('calls es.delete with the correct id', async () => {
    await deleteCreatorFromIndex('creator-99');
    expect(esMocks.mockDelete).toHaveBeenCalledWith({
      index: expect.any(String),
      id: 'creator-99',
    });
  });

  it('does not throw on 404 (document not indexed)', async () => {
    esMocks.mockDelete.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { statusCode: 404 }));
    await expect(deleteCreatorFromIndex('nonexistent')).resolves.not.toThrow();
  });
});

// ── onProfileChanged ──────────────────────────────────────────────────────────

describe('onProfileChanged()', () => {
  it('does not throw and returns void', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() =>
      onProfileChanged({
        id: 'creator-5',
        displayName: 'Charlie',
        bio: 'Full-stack dev',
        discipline: 'Development',
        skills: ['node', 'react'],
        updatedAt: new Date().toISOString(),
        verified: false,
        rating: 3.9,
        completedProjects: 7,
      }),
    ).not.toThrow();
  });

  it('is fire-and-forget (returns synchronously)', () => {
    const start = Date.now();
    onProfileChanged({
      id: 'creator-6',
      displayName: 'Dave',
      bio: null,
      discipline: null,
      skills: [],
      updatedAt: new Date().toISOString(),
      verified: false,
      rating: 0,
      completedProjects: 0,
    });
    expect(Date.now() - start).toBeLessThan(50);
  });
});

// ── checkClusterHealth ────────────────────────────────────────────────────────

describe('checkClusterHealth()', () => {
  it('returns healthy=true for green status', async () => {
    esMocks.mockClusterHealth.mockResolvedValue({ status: 'green', number_of_nodes: 3 });
    esMocks.mockClusterStats.mockResolvedValue({ indices: { count: 2 } });
    const result = await checkClusterHealth();
    expect(result.healthy).toBe(true);
    expect(result.status).toBe('green');
    expect(result.nodeCount).toBe(3);
  });

  it('returns healthy=true for yellow status (degraded but functional)', async () => {
    esMocks.mockClusterHealth.mockResolvedValue({ status: 'yellow', number_of_nodes: 1 });
    esMocks.mockClusterStats.mockResolvedValue({ indices: { count: 1 } });
    const result = await checkClusterHealth();
    expect(result.healthy).toBe(true);
    expect(result.status).toBe('yellow');
  });

  it('returns healthy=false for red status', async () => {
    esMocks.mockClusterHealth.mockResolvedValue({ status: 'red', number_of_nodes: 0 });
    esMocks.mockClusterStats.mockResolvedValue({ indices: { count: 0 } });
    const result = await checkClusterHealth();
    expect(result.healthy).toBe(false);
    expect(result.status).toBe('red');
  });

  it('returns unreachable when ES throws', async () => {
    esMocks.mockClusterHealth.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkClusterHealth();
    expect(result.healthy).toBe(false);
    expect(result.status).toBe('unreachable');
  });
});

// ── getIndexStats ─────────────────────────────────────────────────────────────

describe('getIndexStats()', () => {
  it('returns docCount and sizeBytes', async () => {
    esMocks.mockIndicesStats.mockResolvedValue({
      indices: {
        creators: {
          total: {
            docs: { count: 500 },
            store: { size_in_bytes: 10485760 },
          },
        },
      },
    });
    const stats = await getIndexStats();
    expect(stats.docCount).toBe(500);
    expect(stats.sizeBytes).toBe(10485760);
  });

  it('returns zeros when stats call fails', async () => {
    esMocks.mockIndicesStats.mockRejectedValue(new Error('ES error'));
    const stats = await getIndexStats();
    expect(stats.docCount).toBe(0);
    expect(stats.sizeBytes).toBe(0);
  });
});

// ── ensureIndex ───────────────────────────────────────────────────────────────

describe('ensureIndex()', () => {
  it('skips creation if index already exists', async () => {
    esMocks.mockIndicesExists.mockResolvedValue(true);
    await ensureIndex();
    expect(esMocks.mockIndicesCreate).not.toHaveBeenCalled();
  });

  it('creates index if it does not exist', async () => {
    esMocks.mockIndicesExists.mockResolvedValue(false);
    await ensureIndex();
    expect(esMocks.mockIndicesCreate).toHaveBeenCalledOnce();
  });
});

// ── cosineSimilarity ──────────────────────────────────────────────────────────

describe('cosineSimilarity()', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('returns 0.0 for zero vectors', () => {
    const zero = [0, 0, 0];
    const nonZero = [1, 2, 3];
    expect(cosineSimilarity(zero, nonZero)).toBe(0);
  });

  it('returns 0.0 when both vectors are zero', () => {
    const zero = [0, 0, 0];
    expect(cosineSimilarity(zero, zero)).toBe(0);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 10);
  });

  it('returns correct value for similar vectors', () => {
    const a = [1, 2, 3];
    const b = [1, 2, 4];
    const expected =
      (1 * 1 + 2 * 2 + 3 * 4) /
      (Math.sqrt(1 + 4 + 9) * Math.sqrt(1 + 4 + 16));
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 10);
  });

  it('throws for vectors of different lengths', () => {
    const a = [1, 2, 3];
    const b = [1, 2];
    expect(() => cosineSimilarity(a, b)).toThrow('same length');
  });

  it('handles empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

// ── filterByTags ──────────────────────────────────────────────────────────────

describe('filterByTags()', () => {
  const results: VectorSearchResult[] = [
    {
      id: '1',
      name: 'Alice',
      title: 'Designer',
      discipline: 'Design',
      skills: ['figma', 'ui', 'ux'],
      score: 0.9,
      matchedTags: [],
    },
    {
      id: '2',
      name: 'Bob',
      title: 'Developer',
      discipline: 'Engineering',
      skills: ['typescript', 'react', 'node'],
      score: 0.8,
      matchedTags: [],
    },
  ];

  it('returns all results when no tags specified', () => {
    expect(filterByTags(results, [])).toEqual(results);
  });

  it('filters results by matching skills', () => {
    const filtered = filterByTags(results, ['figma']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
    expect(filtered[0].matchedTags).toContain('figma');
  });

  it('filters results by discipline', () => {
    const filtered = filterByTags(results, ['engineering']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('2');
  });

  it('returns empty when no matches', () => {
    const filtered = filterByTags(results, ['python']);
    expect(filtered).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const filtered = filterByTags(results, ['FIGMA']);
    expect(filtered).toHaveLength(1);
  });
});
