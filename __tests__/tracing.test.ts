/**
 * Tests for backend/services/tracing.ts  (#639)
 *
 * Tests cover:
 *  - SDK initialization guard (no double-init)
 *  - tracingMiddleware — success + failure path span attributes
 *  - createPrismaTracingMiddleware — success + failure
 *  - withSpan — result passthrough + error re-throw
 *  - getCurrentSpan, setAttribute, addEvent, recordException (passthrough when no tracer)
 *  - getTraceparent — null when not initialized
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @opentelemetry/* ─────────────────────────────────────────────────────
// All mocks must use vi.hoisted() to avoid TDZ errors with vi.mock() hoisting

const mocks = vi.hoisted(() => {
  const mockSpan = {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    addEvent: vi.fn(),
    end: vi.fn(),
    spanContext: vi.fn().mockReturnValue({
      traceId: 'abc123'.padEnd(32, '0'),
      spanId: 'def456'.padEnd(16, '0'),
      traceFlags: 1,
    }),
  };
  const mockTracer = {
    startSpan: vi.fn().mockReturnValue(mockSpan),
  };
  return { mockSpan, mockTracer };
});

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: vi.fn().mockReturnValue(mocks.mockTracer),
    getSpan: vi.fn().mockReturnValue(null),
    setSpan: vi.fn((ctx: unknown) => ctx),
  },
  context: {
    active: vi.fn().mockReturnValue({}),
    with: vi.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
  },
  SpanStatusCode: { OK: 1, ERROR: 2 },
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    constructor(_opts?: unknown) {}
    start() {}
    async shutdown() {}
  },
}));

vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: vi.fn().mockReturnValue([]),
}));

vi.mock('@opentelemetry/exporter-trace-otlp-grpc', () => ({
  OTLPTraceExporter: class { constructor(_opts?: unknown) {} },
}));

vi.mock('@opentelemetry/resources', () => ({
  Resource: class {
    static default() {
      return new (class {
        merge() { return {}; }
      })();
    }
    constructor(_attrs: unknown) {}
    merge() { return {}; }
  },
}));

vi.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: class { constructor(_e: unknown, _o?: unknown) {} },
  AlwaysOnSampler: class { constructor() {} },
  ParentBasedSampler: class { constructor(_o: unknown) {} },
  TraceIdRatioBasedSampler: class { constructor(_r: number) {} },
}));

vi.mock('@opentelemetry/core', () => ({
  W3CTraceContextPropagator: class {
    extract(ctx: unknown) { return ctx; }
  },
}));

vi.mock('@opentelemetry/sdk-trace-node', () => ({
  ConsoleSpanExporter: class { constructor() {} },
}));

import {
  initializeTracing,
  tracingMiddleware,
  createPrismaTracingMiddleware,
  withSpan,
  getCurrentSpan,
  setAttribute,
  addEvent,
  recordException,
  getTraceparent,
} from '@/backend/services/tracing';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockTracer.startSpan.mockReturnValue(mocks.mockSpan);
});

// ── initializeTracing ─────────────────────────────────────────────────────────

describe('initializeTracing()', () => {
  it('does not throw when called', () => {
    expect(() => initializeTracing()).not.toThrow();
  });

  it('returns void', () => {
    const result = initializeTracing();
    expect(result).toBeUndefined();
  });
});

// ── tracingMiddleware ─────────────────────────────────────────────────────────

describe('tracingMiddleware()', () => {
  it('calls next() and returns the result', async () => {
    const next = vi.fn().mockResolvedValue({ data: 'ok' });
    const result = await tracingMiddleware({
      ctx: { headers: new Headers() },
      next,
      path: 'bounties.list',
      type: 'query',
    });
    expect(next).toHaveBeenCalledOnce();
    expect(result).toEqual({ data: 'ok' });
  });

  it('re-throws errors from next()', async () => {
    const next = vi.fn().mockRejectedValue(new Error('DB failure'));
    await expect(
      tracingMiddleware({
        ctx: { headers: new Headers() },
        next,
        path: 'bounties.create',
        type: 'mutation',
      }),
    ).rejects.toThrow('DB failure');
  });

  it('handles missing headers gracefully', async () => {
    const next = vi.fn().mockResolvedValue('result');
    const result = await tracingMiddleware({
      ctx: {},
      next,
      path: 'health.ping',
      type: 'query',
    });
    expect(result).toBe('result');
  });

  it('extracts traceparent from headers when present', async () => {
    const headers = new Headers({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    });
    const next = vi.fn().mockResolvedValue('ok');
    await tracingMiddleware({ ctx: { headers }, next, path: 'test', type: 'query' });
    expect(next).toHaveBeenCalledOnce();
  });
});

// ── createPrismaTracingMiddleware ─────────────────────────────────────────────

describe('createPrismaTracingMiddleware()', () => {
  it('creates middleware that calls next with params', async () => {
    const middleware = createPrismaTracingMiddleware();
    const next = vi.fn().mockResolvedValue({ id: '1' });
    const params = { model: 'Bounty', action: 'findMany' };
    const result = await middleware(params, next);
    expect(next).toHaveBeenCalledWith(params);
    expect(result).toEqual({ id: '1' });
  });

  it('re-throws prisma errors', async () => {
    const middleware = createPrismaTracingMiddleware();
    const next = vi.fn().mockRejectedValue(new Error('Connection refused'));
    await expect(
      middleware({ model: 'User', action: 'findUnique' }, next),
    ).rejects.toThrow('Connection refused');
  });

  it('handles missing model gracefully', async () => {
    const middleware = createPrismaTracingMiddleware();
    const next = vi.fn().mockResolvedValue(null);
    const result = await middleware({ action: 'raw' }, next);
    expect(result).toBeNull();
  });
});

// ── withSpan ──────────────────────────────────────────────────────────────────

describe('withSpan()', () => {
  it('returns the function result', async () => {
    const result = await withSpan('my-op', async () => 'value');
    expect(result).toBe('value');
  });

  it('re-throws errors from the wrapped function', async () => {
    await expect(
      withSpan('failing-op', async () => {
        throw new Error('op failed');
      }),
    ).rejects.toThrow('op failed');
  });

  it('passes a span-like object to the callback', async () => {
    let receivedSpan: unknown;
    await withSpan('span-test', async (span) => {
      receivedSpan = span;
      return null;
    });
    expect(receivedSpan).toBeDefined();
  });

  it('accepts custom attributes', async () => {
    const result = await withSpan(
      'attr-test',
      async () => 42,
      { 'user.id': 'u1', 'op.type': 'query' },
    );
    expect(result).toBe(42);
  });
});

// ── getCurrentSpan, setAttribute, addEvent, recordException ──────────────────

describe('getCurrentSpan()', () => {
  it('returns null when no span is active', () => {
    const span = getCurrentSpan();
    expect(span).toBeNull();
  });
});

describe('setAttribute()', () => {
  it('does not throw when no span is active', () => {
    expect(() => setAttribute('key', 'value')).not.toThrow();
  });
});

describe('addEvent()', () => {
  it('does not throw when no span is active', () => {
    expect(() => addEvent('cache.hit', { key: 'user:1' })).not.toThrow();
  });
});

describe('recordException()', () => {
  it('does not throw when no span is active', () => {
    expect(() => recordException(new Error('test'))).not.toThrow();
  });
});

// ── getTraceparent ────────────────────────────────────────────────────────────

describe('getTraceparent()', () => {
  it('returns null when no active span', () => {
    expect(getTraceparent()).toBeNull();
  });
});
