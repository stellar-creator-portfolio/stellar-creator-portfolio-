import { TelemetryCollector } from '../../src/telemetry/TelemetryCollector';

global.performance = { now: jest.fn(() => Date.now()) } as any;
global.requestAnimationFrame = jest.fn();
global.cancelAnimationFrame  = jest.fn();

describe('TelemetryCollector — network latency', () => {
  let collector: TelemetryCollector;
  beforeEach(() => { collector = new TelemetryCollector({ bufferSize: 100 }); });

  it('records a latency event', () => {
    collector.recordLatency('https://api.test/creator', 'GET', 120, 200);
    expect(collector.flush()).toHaveLength(1);
    expect(collector.flush()[0].type).toBe('network_latency');
  });
  it('computes correct latencyBucket for 120ms at 50ms bucket size', () => {
    collector.recordLatency('https://api.test', 'GET', 120, 200);
    expect((collector.flush()[0] as any).latencyBucket).toBe(2);
  });
  it('computes bucket 0 for fast responses under 50ms', () => {
    collector.recordLatency('https://api.test', 'GET', 30, 200);
    expect((collector.flush()[0] as any).latencyBucket).toBe(0);
  });
  it('builds a latency heatmap', () => {
    collector.recordLatency('https://api.test/a', 'GET', 60,  200);
    collector.recordLatency('https://api.test/a', 'GET', 75,  200);
    collector.recordLatency('https://api.test/b', 'GET', 200, 200);
    const heatmap = collector.buildLatencyHeatmap();
    expect(heatmap.get(1)?.get('https://api.test/a')).toBe(2);
    expect(heatmap.get(4)?.get('https://api.test/b')).toBe(1);
  });
});

describe('TelemetryCollector — subscriber', () => {
  let collector: TelemetryCollector;
  beforeEach(() => { collector = new TelemetryCollector(); });

  it('notifies subscriber on event', () => {
    const received: any[] = [];
    collector.subscribe(e => received.push(e));
    collector.recordLatency('https://x', 'POST', 50, 201);
    expect(received).toHaveLength(1);
  });
  it('unsubscribe removes subscriber', () => {
    const received: any[] = [];
    const unsub = collector.subscribe(e => received.push(e));
    unsub();
    collector.recordLatency('https://x', 'GET', 50, 200);
    expect(received).toHaveLength(0);
  });
  it('subscriber error does not crash collector', () => {
    collector.subscribe(() => { throw new Error('crash'); });
    expect(() => collector.recordLatency('https://x', 'GET', 50, 200)).not.toThrow();
  });
});

describe('TelemetryCollector — buffer', () => {
  it('respects bufferSize limit', () => {
    const collector = new TelemetryCollector({ bufferSize: 3 });
    for (let i = 0; i < 5; i++) collector.recordLatency(`https://url${i}`, 'GET', 50, 200);
    expect(collector.flush()).toHaveLength(3);
  });
  it('clear empties buffer', () => {
    const collector = new TelemetryCollector();
    collector.recordLatency('https://x', 'GET', 50, 200);
    collector.clear();
    expect(collector.flush()).toHaveLength(0);
  });
});

describe('TelemetryCollector — memory snapshot', () => {
  it('returns snapshot with valid shape', () => {
    const collector = new TelemetryCollector();
    const snap = collector.captureMemorySnapshot();
    expect(snap.type).toBe('memory');
    expect(typeof snap.usedJSHeapMB).toBe('number');
    expect(typeof snap.totalJSHeapMB).toBe('number');
  });
});
