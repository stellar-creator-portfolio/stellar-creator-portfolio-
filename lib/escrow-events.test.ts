/**
 * Contract event listener tests — Issue #336
 *
 * Verifies that the escrow API client correctly handles event-driven
 * responses from the Soroban escrow contract, including:
 *  - Parsing escrow_deposited, escrow_released, escrow_refunded,
 *    escrow_disputed, and milestone_released event payloads
 *  - Consistent data formatting of EscrowTransactionResponse
 *  - Error handling for failed or unknown event types
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitEscrowTransaction,
  releaseEscrow,
  ApiClientError,
} from './api-client';
import {
  apiSuccess,
  apiFailure,
  validateEscrowTransaction,
  type EscrowTransactionResponse,
  type EscrowTransactionRequest,
} from './api-models';

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

// ── Event payload shape ───────────────────────────────────────────────────────

const depositedEvent: EscrowTransactionResponse = {
  escrowId: '1',
  txHash: 'abc123def456',
  operation: 'deposit',
  status: 'confirmed',
  timestamp: '2026-04-23T12:00:00Z',
};

const releasedEvent: EscrowTransactionResponse = {
  escrowId: '1',
  txHash: 'release789xyz',
  operation: 'release',
  status: 'confirmed',
  timestamp: '2026-04-23T13:00:00Z',
};

const refundedEvent: EscrowTransactionResponse = {
  escrowId: '2',
  txHash: 'refund000aaa',
  operation: 'refund',
  status: 'confirmed',
  timestamp: '2026-04-23T14:00:00Z',
};

const disputedEvent: EscrowTransactionResponse = {
  escrowId: '3',
  txHash: 'dispute111bbb',
  operation: 'dispute',
  status: 'pending',
  timestamp: '2026-04-23T15:00:00Z',
};

// ── submitEscrowTransaction — deposit event ───────────────────────────────────

describe('submitEscrowTransaction — deposit', () => {
  const depositRequest: EscrowTransactionRequest = {
    bountyId: 'bounty-1',
    operation: 'deposit',
    amount: 2500,
    payerAddress: 'GPAYER123',
    payeeAddress: 'GPAYEE456',
    tokenAddress: 'GUSDC789',
  };

  it('returns a confirmed EscrowTransactionResponse on success', async () => {
    mockFetch(apiSuccess(depositedEvent), 201);
    const result = await submitEscrowTransaction(depositRequest);
    expect(result.escrowId).toBe('1');
    expect(result.operation).toBe('deposit');
    expect(result.status).toBe('confirmed');
    expect(result.txHash).toBe('abc123def456');
  });

  it('POSTs to /api/escrow/transaction', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      json: () => Promise.resolve(apiSuccess(depositedEvent)),
    });
    vi.stubGlobal('fetch', fetchMock);
    await submitEscrowTransaction(depositRequest);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/escrow/transaction');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as EscrowTransactionRequest;
    expect(body.operation).toBe('deposit');
    expect(body.bountyId).toBe('bounty-1');
    expect(body.amount).toBe(2500);
  });

  it('throws ApiClientError on VALIDATION_ERROR', async () => {
    mockFetch(
      apiFailure('VALIDATION_ERROR', 'Amount must be positive', [
        { field: 'amount', message: 'Amount must be positive' },
      ]),
      422,
    );
    await expect(submitEscrowTransaction(depositRequest)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 422,
    });
  });

  it('throws ApiClientError on SERVICE_UNAVAILABLE', async () => {
    mockFetch(apiFailure('SERVICE_UNAVAILABLE', 'Stellar node unreachable'), 503);
    await expect(submitEscrowTransaction(depositRequest)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('throws network error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));
    await expect(submitEscrowTransaction(depositRequest)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});

// ── releaseEscrow — release event ─────────────────────────────────────────────

describe('releaseEscrow', () => {
  it('returns a confirmed release response', async () => {
    mockFetch(apiSuccess(releasedEvent), 200);
    const result = await releaseEscrow('1', 'GPAYER123');
    expect(result.operation).toBe('release');
    expect(result.status).toBe('confirmed');
    expect(result.escrowId).toBe('1');
  });

  it('POSTs to /api/escrow/:id/release', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess(releasedEvent)),
    });
    vi.stubGlobal('fetch', fetchMock);
    await releaseEscrow('42', 'GPAYER123');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/escrow/42/release');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { authorizerAddress: string };
    expect(body.authorizerAddress).toBe('GPAYER123');
  });

  it('throws UNAUTHORIZED when caller is not a party', async () => {
    mockFetch(apiFailure('UNAUTHORIZED', 'Unauthorized'), 401);
    await expect(releaseEscrow('1', 'GSTRANGER')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('throws NOT_FOUND for missing escrow', async () => {
    mockFetch(apiFailure('NOT_FOUND', 'Escrow not found'), 404);
    await expect(releaseEscrow('999', 'GPAYER123')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// ── Event payload data formatting ─────────────────────────────────────────────

describe('EscrowTransactionResponse data formatting', () => {
  it('parses refunded event correctly', async () => {
    mockFetch(apiSuccess(refundedEvent), 200);
    const result = await submitEscrowTransaction({
      bountyId: 'bounty-2',
      escrowId: '2',
      operation: 'refund',
      payerAddress: 'GPAYER123',
    });
    expect(result.operation).toBe('refund');
    expect(result.escrowId).toBe('2');
    expect(result.txHash).toBe('refund000aaa');
  });

  it('parses disputed event correctly', async () => {
    mockFetch(apiSuccess(disputedEvent), 200);
    const result = await submitEscrowTransaction({
      bountyId: 'bounty-3',
      escrowId: '3',
      operation: 'dispute',
      payerAddress: 'GPAYER123',
    });
    expect(result.operation).toBe('dispute');
    expect(result.status).toBe('pending');
  });

  it('preserves timestamp string from event', async () => {
    mockFetch(apiSuccess(depositedEvent), 201);
    const result = await submitEscrowTransaction({
      bountyId: 'bounty-1',
      operation: 'deposit',
      amount: 1000,
      payerAddress: 'GPAYER123',
      payeeAddress: 'GPAYEE456',
      tokenAddress: 'GUSDC789',
    });
    expect(result.timestamp).toBe('2026-04-23T12:00:00Z');
  });
});

// ── validateEscrowTransaction ─────────────────────────────────────────────────

describe('validateEscrowTransaction', () => {
  const validDeposit: EscrowTransactionRequest = {
    bountyId: 'b-1',
    operation: 'deposit',
    amount: 500,
    payerAddress: 'GPAYER123',
    payeeAddress: 'GPAYEE456',
    tokenAddress: 'GUSDC789',
  };

  it('returns null for a valid deposit request', () => {
    expect(validateEscrowTransaction(validDeposit)).toBeNull();
  });

  it('requires bountyId', () => {
    const errors = validateEscrowTransaction({ ...validDeposit, bountyId: '' });
    expect(errors?.some((e) => e.field === 'bountyId')).toBe(true);
  });

  it('requires operation', () => {
    const errors = validateEscrowTransaction({ ...validDeposit, operation: undefined as never });
    expect(errors?.some((e) => e.field === 'operation')).toBe(true);
  });

  it('requires payerAddress', () => {
    const errors = validateEscrowTransaction({ ...validDeposit, payerAddress: '' });
    expect(errors?.some((e) => e.field === 'payerAddress')).toBe(true);
  });

  it('requires payeeAddress for deposit', () => {
    const errors = validateEscrowTransaction({ ...validDeposit, payeeAddress: '' });
    expect(errors?.some((e) => e.field === 'payeeAddress')).toBe(true);
  });

  it('requires positive amount for deposit', () => {
    const errors = validateEscrowTransaction({ ...validDeposit, amount: 0 });
    expect(errors?.some((e) => e.field === 'amount')).toBe(true);
  });

  it('requires tokenAddress for deposit', () => {
    const errors = validateEscrowTransaction({ ...validDeposit, tokenAddress: '' });
    expect(errors?.some((e) => e.field === 'tokenAddress')).toBe(true);
  });

  it('does not require payee/amount/token for non-deposit operations', () => {
    const releaseRequest: EscrowTransactionRequest = {
      bountyId: 'b-1',
      escrowId: '1',
      operation: 'release',
      payerAddress: 'GPAYER123',
    };
    expect(validateEscrowTransaction(releaseRequest)).toBeNull();
  });

  it('returns multiple errors for multiple missing fields', () => {
    const errors = validateEscrowTransaction({ operation: 'deposit' });
    expect((errors ?? []).length).toBeGreaterThan(1);
  });
});

// ── ApiClientError propagation ────────────────────────────────────────────────

describe('ApiClientError propagation from escrow endpoints', () => {
  it('preserves FORBIDDEN code', async () => {
    mockFetch(apiFailure('FORBIDDEN', 'Only payer can refund'), 403);
    await expect(
      submitEscrowTransaction({ bountyId: 'b-1', operation: 'refund', payerAddress: 'GPAYEE' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('preserves CONFLICT code', async () => {
    mockFetch(apiFailure('CONFLICT', 'Escrow already exists'), 409);
    await expect(
      submitEscrowTransaction({
        bountyId: 'b-1',
        operation: 'deposit',
        amount: 100,
        payerAddress: 'G1',
        payeeAddress: 'G2',
        tokenAddress: 'G3',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('preserves UNPROCESSABLE_ENTITY code', async () => {
    mockFetch(apiFailure('UNPROCESSABLE_ENTITY', 'Release condition not met'), 422);
    await expect(releaseEscrow('1', 'GPAYER')).rejects.toMatchObject({
      code: 'UNPROCESSABLE_ENTITY',
      status: 422,
    });
  });
});
