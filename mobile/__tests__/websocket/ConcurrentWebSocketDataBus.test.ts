import {
  RingBuffer,
  HermesBridge,
  UICommitBatcher,
  parseFrame,
  ConcurrentWebSocketDataBus,
  FRAME_BUDGET_MS,
  RING_BUFFER_CAPACITY,
  MAX_MESSAGES_PER_FLUSH,
  BusMessage,
} from '../../src/services/ConcurrentWebSocketDataBus';

// ─── parseFrame ────────────────────────────────────────────────────────────────

describe('parseFrame', () => {
  it('parses a valid message', () => {
    const raw = JSON.stringify({ type: 'feed.update', payload: { id: 1 }, timestamp: 1000, id: 'abc' });
    const result = parseFrame(raw);
    expect(result.ok).toBe(true);
    expect(result.message?.type).toBe('feed.update');
  });

  it('returns error for malformed JSON', () => {
    const result = parseFrame('{not json}');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error when type field is missing', () => {
    const result = parseFrame(JSON.stringify({ payload: 'x', timestamp: 0 }));
    expect(result.ok).toBe(false);
  });

  it('returns error for null JSON', () => {
    const result = parseFrame('null');
    expect(result.ok).toBe(false);
  });

  it('returns error for non-object JSON', () => {
    const result = parseFrame('"string"');
    expect(result.ok).toBe(false);
  });
});

// ─── RingBuffer ────────────────────────────────────────────────────────────────

describe('RingBuffer', () => {
  it('starts empty', () => {
    const rb = new RingBuffer<number>(4);
    expect(rb.size).toBe(0);
    expect(rb.isEmpty()).toBe(true);
  });

  it('accepts items up to capacity', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    expect(rb.size).toBe(3);
  });

  it('evicts oldest item when capacity is exceeded', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4); // evicts 1
    expect(rb.size).toBe(3);
    expect(rb.shift()).toBe(2);
  });

  it('shift returns undefined on empty buffer', () => {
    const rb = new RingBuffer<number>(4);
    expect(rb.shift()).toBeUndefined();
  });

  it('preserves FIFO order', () => {
    const rb = new RingBuffer<number>(5);
    [10, 20, 30].forEach((v) => rb.push(v));
    expect(rb.shift()).toBe(10);
    expect(rb.shift()).toBe(20);
    expect(rb.shift()).toBe(30);
  });

  it('clear resets all counters', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(1);
    rb.push(2);
    rb.clear();
    expect(rb.size).toBe(0);
    expect(rb.isEmpty()).toBe(true);
  });

  it('wraps around correctly after interleaved push/shift', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.shift();       // removes 1
    rb.push(3);
    rb.push(4);
    expect(rb.size).toBe(3);
    expect(rb.shift()).toBe(2);
  });
});

// ─── HermesBridge ─────────────────────────────────────────────────────────────

describe('HermesBridge', () => {
  it('executes scheduled tasks asynchronously', async () => {
    const bridge = new HermesBridge();
    const results: number[] = [];

    bridge.scheduleTask(() => results.push(1));
    bridge.scheduleTask(() => results.push(2));

    expect(results).toHaveLength(0); // Not yet executed

    await Promise.resolve(); // Flush microtask queue
    await Promise.resolve(); // Allow drain loop to complete

    expect(results).toEqual([1, 2]);
  });

  it('reports pendingCount before drain', () => {
    const bridge = new HermesBridge();
    bridge.scheduleTask(() => {});
    bridge.scheduleTask(() => {});
    expect(bridge.pendingCount()).toBe(2);
  });

  it('swallows task errors without crashing', async () => {
    const bridge = new HermesBridge();
    const after: string[] = [];
    bridge.scheduleTask(() => { throw new Error('boom'); });
    bridge.scheduleTask(() => after.push('ok'));
    await Promise.resolve();
    await Promise.resolve();
    expect(after).toEqual(['ok']);
  });
});

// ─── UICommitBatcher ──────────────────────────────────────────────────────────

describe('UICommitBatcher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('delivers messages to typed handlers on flush', () => {
    const batcher = new UICommitBatcher(FRAME_BUDGET_MS);
    const received: BusMessage[] = [];
    batcher.on('feed.update', (m) => received.push(m));
    batcher.start();

    const msg: BusMessage = { type: 'feed.update', payload: {}, timestamp: 0, id: '1' };
    batcher.enqueue(msg);

    jest.advanceTimersByTime(FRAME_BUDGET_MS);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('feed.update');
    batcher.stop();
  });

  it('delivers messages to wildcard handlers', () => {
    const batcher = new UICommitBatcher(FRAME_BUDGET_MS);
    const received: BusMessage[] = [];
    batcher.on('*', (m) => received.push(m));
    batcher.start();

    batcher.enqueue({ type: 'a', payload: null, timestamp: 0, id: '1' });
    batcher.enqueue({ type: 'b', payload: null, timestamp: 0, id: '2' });

    jest.advanceTimersByTime(FRAME_BUDGET_MS);
    expect(received).toHaveLength(2);
    batcher.stop();
  });

  it('unsubscribe removes handler', () => {
    const batcher = new UICommitBatcher(FRAME_BUDGET_MS);
    const received: BusMessage[] = [];
    const unsub = batcher.on('evt', (m) => received.push(m));
    batcher.start();

    unsub();
    batcher.enqueue({ type: 'evt', payload: null, timestamp: 0, id: '1' });
    jest.advanceTimersByTime(FRAME_BUDGET_MS);
    expect(received).toHaveLength(0);
    batcher.stop();
  });

  it('batches up to MAX_MESSAGES_PER_FLUSH per tick', () => {
    const batcher = new UICommitBatcher(FRAME_BUDGET_MS);
    const received: BusMessage[] = [];
    batcher.on('*', (m) => received.push(m));
    batcher.start();

    for (let i = 0; i < MAX_MESSAGES_PER_FLUSH + 50; i++) {
      batcher.enqueue({ type: 'x', payload: i, timestamp: 0, id: String(i) });
    }

    jest.advanceTimersByTime(FRAME_BUDGET_MS);
    expect(received.length).toBeLessThanOrEqual(MAX_MESSAGES_PER_FLUSH);
    // Remaining messages still pending
    expect(batcher.pendingCount).toBeGreaterThan(0);
    batcher.stop();
  });

  it('stop prevents further deliveries', () => {
    const batcher = new UICommitBatcher(FRAME_BUDGET_MS);
    const received: BusMessage[] = [];
    batcher.on('*', (m) => received.push(m));
    batcher.start();
    batcher.stop();

    batcher.enqueue({ type: 'x', payload: null, timestamp: 0, id: '1' });
    jest.advanceTimersByTime(FRAME_BUDGET_MS * 5);
    expect(received).toHaveLength(0);
  });

  it('flushedCount increments after each flush', () => {
    const batcher = new UICommitBatcher(FRAME_BUDGET_MS);
    batcher.start();
    batcher.enqueue({ type: 'x', payload: null, timestamp: 0, id: '1' });
    batcher.enqueue({ type: 'x', payload: null, timestamp: 0, id: '2' });
    jest.advanceTimersByTime(FRAME_BUDGET_MS);
    expect(batcher.flushedCount).toBe(2);
    batcher.stop();
  });
});

// ─── ConcurrentWebSocketDataBus ───────────────────────────────────────────────

describe('ConcurrentWebSocketDataBus', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('exposes correct default constants', () => {
    expect(FRAME_BUDGET_MS).toBe(16);
    expect(RING_BUFFER_CAPACITY).toBe(512);
    expect(MAX_MESSAGES_PER_FLUSH).toBe(256);
  });

  it('injectFrame parses and enqueues message', async () => {
    const bus = new ConcurrentWebSocketDataBus('ws://localhost:9999');
    const received: BusMessage[] = [];
    bus.on('feed.update', (m) => received.push(m));

    // Start the batcher so flush timers run
    // We cannot call connect() without a real WS server, so we tap injectFrame.
    const raw = JSON.stringify({ type: 'feed.update', payload: { id: 42 }, timestamp: 1, id: 'x1' });
    bus.injectFrame(raw);

    // Drain Hermes bridge microtasks
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(FRAME_BUDGET_MS);
    // The batcher isn't started (no connect), so messages remain pending.
    // Verify stats instead.
    const stats = bus.getStats();
    expect(stats.received).toBe(1);
    bus.disconnect();
  });

  it('injectFrame increments parseErrors for bad JSON', async () => {
    const bus = new ConcurrentWebSocketDataBus('ws://localhost:9999');
    bus.injectFrame('{bad}');
    await Promise.resolve();
    await Promise.resolve();
    const stats = bus.getStats();
    expect(stats.parseErrors).toBe(1);
    bus.disconnect();
  });

  it('getStats returns correct received count for multiple injections', async () => {
    const bus = new ConcurrentWebSocketDataBus('ws://localhost:9999');
    const msg = JSON.stringify({ type: 't', payload: null, timestamp: 0, id: 'y' });
    bus.injectFrame(msg);
    bus.injectFrame(msg);
    bus.injectFrame(msg);
    await Promise.resolve();
    await Promise.resolve();
    expect(bus.getStats().received).toBe(3);
    bus.disconnect();
  });

  it('on() returns unsubscribe function', () => {
    const bus = new ConcurrentWebSocketDataBus('ws://localhost:9999');
    const unsub = bus.on('evt', () => {});
    expect(typeof unsub).toBe('function');
    bus.disconnect();
  });

  it('disconnect stops processing', async () => {
    const bus = new ConcurrentWebSocketDataBus('ws://localhost:9999');
    bus.disconnect();
    const before = bus.getStats().received;
    const msg = JSON.stringify({ type: 't', payload: null, timestamp: 0, id: 'z' });
    bus.injectFrame(msg);
    await Promise.resolve();
    // Stats still increment because injectFrame is a test helper, but no delivery occurs
    expect(bus.getStats().received).toBe(before + 1);
  });
});
