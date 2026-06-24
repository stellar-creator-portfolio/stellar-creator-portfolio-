import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
  API_BASE,
  apiFetch,
  fetchBounties,
  fetchCreators,
  fetchFreelancers,
} from '@/lib/api-client';
import { apiSuccess } from '@/lib/api-models';
import { GET as healthGET } from '@/app/api/health/route';
import { GET as creatorsGET } from '@/app/api/creators/route';
import { GET as creatorGET } from '@/app/api/creators/[id]/route';
import { GET as creatorReputationGET } from '@/app/api/creators/[id]/reputation/route';
import { GET as creatorReviewsGET } from '@/app/api/creators/[id]/reviews/route';
import { POST as creatorReviewsBatchPOST } from '@/app/api/creators/reviews/batch/route';
import { POST as creatorReputationBatchPOST } from '@/app/api/creators/reputation/batch/route';
import { GET as reviewsGET, POST as reviewsPOST } from '@/app/api/reviews/route';
import { GET as bountiesGET } from '@/app/api/bounties/route';
import { GET as bountyGET } from '@/app/api/bounties/[id]/route';
import { GET as freelancersGET } from '@/app/api/freelancers/route';
import { GET as freelancerGET } from '@/app/api/freelancers/[address]/route';
import { POST as escrowTransactionPOST } from '@/app/api/escrow/transaction/route';
import { POST as escrowReleasePOST } from '@/app/api/escrow/[id]/release/route';
import { POST as paymentWebhookPOST } from '@/app/api/webhooks/payment/route';

type RouteContext<T extends Record<string, string>> = {
  params: Promise<T>;
};

function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(`http://localhost${path}`, init);
}

function context<T extends Record<string, string>>(params: T): RouteContext<T> {
  return { params: Promise.resolve(params) };
}

async function expectOk(label: string, call: () => Promise<Response>) {
  const response = await call();
  expect(response.status, `${label} returned ${response.status}`).toBe(200);
}

describe('api-client route coverage', () => {
  it('keeps the web API base unversioned', () => {
    expect(API_BASE).toBe('/api');
  });

  it('omits the obsolete Accept-Version header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ ok: true })),
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/health');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Accept-Version']).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('domain helpers build unversioned paths', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess({ creators: [], freelancers: [], total: 0 })),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchCreators();
    expect((fetchMock.mock.calls.at(-1) as [string])[0]).toContain('/api/creators');

    await fetchFreelancers();
    expect((fetchMock.mock.calls.at(-1) as [string])[0]).toContain('/api/freelancers');

    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: () =>
        Promise.resolve(apiSuccess({ items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } })),
    });
    await fetchBounties();
    expect((fetchMock.mock.calls.at(-1) as [string])[0]).toContain('/api/bounties');
    vi.unstubAllGlobals();
  });

  it('responds 200 for GET paths used by api-client.ts', async () => {
    await expectOk('GET /api/health', () => healthGET());
    await expectOk('GET /api/creators', () => creatorsGET(request('/api/creators')));
    await expectOk('GET /api/creators/:id', () =>
      creatorGET(request('/api/creators/alex-studio'), context({ id: 'alex-studio' })),
    );
    await expectOk('GET /api/creators/:id/reputation', () =>
      creatorReputationGET(request('/api/creators/alex-studio/reputation'), context({ id: 'alex-studio' })),
    );
    await expectOk('GET /api/creators/:id/reviews', () =>
      creatorReviewsGET(request('/api/creators/alex-studio/reviews'), context({ id: 'alex-studio' })),
    );
    await expectOk('GET /api/reviews', () => reviewsGET(request('/api/reviews')));
    await expectOk('GET /api/bounties', () => bountiesGET(request('/api/bounties')));
    await expectOk('GET /api/bounties/:id', () =>
      bountyGET(request('/api/bounties/bounty-1'), context({ id: 'bounty-1' })),
    );
    await expectOk('GET /api/freelancers', () => freelancersGET(request('/api/freelancers')));
    await expectOk('GET /api/freelancers/:address', () =>
      freelancerGET(request('/api/freelancers/alex-studio'), context({ address: 'alex-studio' })),
    );
  });

  it('responds 200 for POST paths used by api-client.ts', async () => {
    await expectOk('POST /api/creators/reviews/batch', () =>
      creatorReviewsBatchPOST(
        request('/api/creators/reviews/batch', {
          method: 'POST',
          body: JSON.stringify({ creatorIds: ['alex-studio'] }),
        }),
      ),
    );
    await expectOk('POST /api/creators/reputation/batch', () =>
      creatorReputationBatchPOST(
        request('/api/creators/reputation/batch', {
          method: 'POST',
          body: JSON.stringify({ creatorIds: ['alex-studio'] }),
        }),
      ),
    );
    await expectOk('POST /api/reviews', () =>
      reviewsPOST(
        request('/api/reviews', {
          method: 'POST',
          body: JSON.stringify({
            bountyId: 'bounty-1',
            creatorId: 'alex-studio',
            rating: 5,
            title: 'Great work',
            body: 'The creator delivered high quality work.',
            reviewerName: 'Jane',
          }),
        }),
      ),
    );
    await expectOk('POST /api/escrow/transaction', () =>
      escrowTransactionPOST(
        request('/api/escrow/transaction', {
          method: 'POST',
          body: JSON.stringify({
            bountyId: 'bounty-1',
            operation: 'deposit',
            amount: 100,
            payerAddress: 'GPAYER',
            payeeAddress: 'GPAYEE',
            tokenAddress: 'GUSDC',
          }),
        }),
      ),
    );
    await expectOk('POST /api/escrow/:id/release', () =>
      escrowReleasePOST(
        request('/api/escrow/escrow-1/release', {
          method: 'POST',
          body: JSON.stringify({ authorizerAddress: 'GPAYER' }),
        }),
        context({ id: 'escrow-1' }),
      ),
    );
    await expectOk('POST /api/webhooks/payment', () =>
      paymentWebhookPOST(
        request('/api/webhooks/payment', {
          method: 'POST',
          body: JSON.stringify({ escrow_id: 'escrow-1' }),
        }),
      ),
    );
  });
});
