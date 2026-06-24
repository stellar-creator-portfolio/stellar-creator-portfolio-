import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  apiFetch,
  fetchCreator,
  fetchCreators,
  fetchFreelancers,
  fetchFreelancer,
  fetchBounties,
  fetchCreatorReputation,
  submitReview,
  ApiClientError,
  API_VERSION,
  API_BASE,
} from './api-client';
import { apiSuccess, apiFailure } from './api-models';

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('unwraps a success envelope', async () => {
    mockFetch(apiSuccess({ id: 'alex-studio' }));
    const data = await apiFetch<{ id: string }>('/api/creators/alex-studio');
    expect(data.id).toBe('alex-studio');
  });

  it('throws ApiClientError on API failure', async () => {
    mockFetch(apiFailure('NOT_FOUND', 'Creator not found'), 404);
    await expect(apiFetch('/api/creators/missing')).rejects.toThrow(ApiClientError);
  });

  it('sets correct error code from API failure', async () => {
    mockFetch(apiFailure('UNAUTHORIZED', 'No token'), 401);
    try {
      await apiFetch('/api/bounties');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiClientError);
      expect((e as ApiClientError).code).toBe('UNAUTHORIZED');
      expect((e as ApiClientError).status).toBe(401);
    }
  });

  it('throws network error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    await expect(apiFetch('/api/creators')).rejects.toThrow(ApiClientError);
    await expect(apiFetch('/api/creators')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('throws on malformed JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      }),
    );
    await expect(apiFetch('/api/creators')).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  it('attaches Content-Type and Accept headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({})),
    });
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/api/health');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((init.headers as Record<string, string>)['Accept']).toBe('application/json');
  });
});

describe('fetchCreator', () => {
  it('calls the correct endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ id: 'alex-studio', name: 'Alex Chen' })),
    });
    vi.stubGlobal('fetch', fetchMock);
    const creator = await fetchCreator('alex-studio');
    expect(creator.name).toBe('Alex Chen');
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/creators/alex-studio');
  });
});

describe('fetchCreators', () => {
  it('appends discipline query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ creators: [], total: 0 })),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchCreators({ discipline: 'UI/UX Design' });
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('discipline=UI%2FUX+Design');
  });

  it('appends search query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ creators: [], total: 0 })),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchCreators({ search: 'figma' });
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('search=figma');
  });
});

describe('ApiClientError', () => {
  it('fromApiError maps fields correctly', () => {
    const err = ApiClientError.fromApiError(
      { code: 'VALIDATION_ERROR', message: 'Invalid', fieldErrors: [{ field: 'title', message: 'Required' }] },
      422,
    );
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(422);
    expect(err.fieldErrors).toHaveLength(1);
  });

  it('network() returns SERVICE_UNAVAILABLE', () => {
    const err = ApiClientError.network();
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('fetchFreelancers', () => {
  it('calls /api/freelancers without params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ freelancers: [], total: 0 })),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchFreelancers();
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/freelancers');
  });

  it('appends discipline param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ freelancers: [], total: 0 })),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchFreelancers({ discipline: 'Writing' });
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('discipline=Writing');
  });
});

describe('fetchFreelancer', () => {
  it('calls the correct endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ address: 'wallet-1', name: 'Jane' })),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchFreelancer('wallet-1') as { address: string };
    expect(result.address).toBe('wallet-1');
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/freelancers/wallet-1');
  });
});

describe('fetchBounties', () => {
  it('calls /api/bounties without params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } })),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchBounties();
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/bounties');
  });

  it('appends category and difficulty params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } })),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchBounties({ category: 'Design', difficulty: 'intermediate', page: 2, limit: 5 });
    const url = (fetchMock.mock.calls[0] as [string])[0];
    expect(url).toContain('category=Design');
    expect(url).toContain('difficulty=intermediate');
    expect(url).toContain('page=2');
    expect(url).toContain('limit=5');
  });

  it('throws ApiClientError on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 503,
      json: () => Promise.resolve(apiFailure('SERVICE_UNAVAILABLE', 'Down')),
    }));
    await expect(fetchBounties()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('fetchCreatorReputation', () => {
  it('calls the correct endpoint', async () => {
    const payload = {
      creatorId: 'alex-studio',
      aggregation: { averageRating: 4.9, totalReviews: 3, stars5: 2, stars4: 1, stars3: 0, stars2: 0, stars1: 0 },
      recentReviews: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess(payload)),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchCreatorReputation('alex-studio');
    expect(result.creatorId).toBe('alex-studio');
    expect(result.aggregation.averageRating).toBe(4.9);
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/creators/alex-studio/reputation');
  });

  it('throws ApiClientError on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 404,
      json: () => Promise.resolve(apiFailure('NOT_FOUND', 'Creator not found')),
    }));
    await expect(fetchCreatorReputation('ghost')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('submitReview', () => {
  const validReview = {
    bountyId: 'b-1',
    creatorId: 'c-1',
    rating: 5,
    title: 'Great',
    body: 'Excellent work',
    reviewerName: 'Jane',
  };

  it('POSTs to /api/reviews and returns reviewId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      json: () => Promise.resolve(apiSuccess({ reviewId: 'rev-42' })),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await submitReview(validReview);
    expect(result.reviewId).toBe('rev-42');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/reviews');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).bountyId).toBe('b-1');
  });

  it('throws VALIDATION_ERROR with fieldErrors on 422', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 422,
      json: () => Promise.resolve(
        apiFailure('VALIDATION_ERROR', 'Invalid', [{ field: 'rating', message: 'Required' }])
      ),
    }));
    try {
      await submitReview(validReview);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiClientError);
      expect((e as ApiClientError).code).toBe('VALIDATION_ERROR');
      expect((e as ApiClientError).fieldErrors).toHaveLength(1);
    }
  });
});

describe('ApiClientError — additional codes', () => {
  it('preserves FORBIDDEN code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 403,
      json: () => Promise.resolve(apiFailure('FORBIDDEN', 'Access denied')),
    }));
    await expect(apiFetch('/api/admin')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('preserves CONFLICT code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 409,
      json: () => Promise.resolve(apiFailure('CONFLICT', 'Already exists')),
    }));
    await expect(apiFetch('/api/creators')).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('preserves UNPROCESSABLE_ENTITY code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 422,
      json: () => Promise.resolve(apiFailure('UNPROCESSABLE_ENTITY', 'Unprocessable')),
    }));
    await expect(apiFetch('/api/bounties')).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', status: 422 });
  });
});

// ── API versioning ────────────────────────────────────────────────────────────

describe('API versioning', () => {
  it('API_VERSION is empty because routes are unversioned', () => {
    expect(API_VERSION).toBe('');
  });

  it('API_BASE is /api', () => {
    expect(API_BASE).toBe('/api');
  });

  it('apiFetch does not send Accept-Version header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({})),
    });
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/api/health');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Accept-Version']).toBeUndefined();
  });

  it('domain helpers use unversioned paths', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ creators: [], total: 0 })),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchCreators();
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/creators');
  });

  it('fetchBounties uses unversioned path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } })),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchBounties();
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/bounties');
  });

  it('fetchFreelancers uses unversioned path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ freelancers: [], total: 0 })),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchFreelancers();
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/freelancers');
  });
});
