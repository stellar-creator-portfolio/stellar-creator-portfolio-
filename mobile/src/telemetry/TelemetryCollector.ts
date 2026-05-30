/**
 * Lightweight native telemetry and profiling system for React Native.
 * Frame drop detection, memory snapshots, and network latency heatmap.
 * All telemetry stored in a circular buffer to bound memory usage.
 */

export interface FrameDropEvent {
  type: 'frame_drop';
  timestamp: number;
  frameDurationMs: number;
  droppedFrameCount: number;
  stackTrace?: string;
}

export interface MemorySnapshot {
  type: 'memory';
  timestamp: number;
  usedJSHeapMB: number;
  totalJSHeapMB: number;
}

export interface NetworkLatencyEvent {
  type: 'network_latency';
  url: string;
  method: string;
  durationMs: number;
  statusCode?: number;
  timestamp: number;
  latencyBucket: number;
}

export type TelemetryEvent = FrameDropEvent | MemorySnapshot | NetworkLatencyEvent;

export interface TelemetryConfig {
  targetFrameMs?: number;
  bufferSize?: number;
  dropThresholdMultiplier?: number;
  latencyBucketMs?: number;
}

export type TelemetrySubscriber = (event: TelemetryEvent) => void;

class CircularBuffer<T> {
  private buffer: T[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  toArray(): T[] {
    if (this.count < this.capacity) return this.buffer.slice(0, this.count);
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
  }

  get size(): number { return this.count; }
  clear(): void { this.head = 0; this.count = 0; }
}

export class TelemetryCollector {
  private readonly config: Required<TelemetryConfig>;
  private readonly buffer: CircularBuffer<TelemetryEvent>;
  private subscribers: TelemetrySubscriber[] = [];
  private rafHandle: number | null = null;
  private lastFrameTime = 0;
  private originalFetch: typeof fetch | null = null;
  private active = false;

  constructor(config: TelemetryConfig = {}) {
    this.config = {
      targetFrameMs:           config.targetFrameMs           ?? 16.67,
      bufferSize:              config.bufferSize              ?? 500,
      dropThresholdMultiplier: config.dropThresholdMultiplier ?? 2,
      latencyBucketMs:         config.latencyBucketMs         ?? 50,
    };
    this.buffer = new CircularBuffer<TelemetryEvent>(this.config.bufferSize);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.startFrameMonitor();
    this.instrumentFetch();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.rafHandle !== null) { cancelAnimationFrame(this.rafHandle); this.rafHandle = null; }
    this.restoreFetch();
  }

  private startFrameMonitor(): void {
    const dropThresholdMs = this.config.targetFrameMs * this.config.dropThresholdMultiplier;
    this.lastFrameTime = performance.now();

    const tick = (now: number) => {
      if (!this.active) return;
      const frameDurationMs = now - this.lastFrameTime;
      this.lastFrameTime = now;
      if (frameDurationMs > dropThresholdMs) {
        this.emit({
          type: 'frame_drop',
          timestamp: now,
          frameDurationMs,
          droppedFrameCount: Math.floor(frameDurationMs / this.config.targetFrameMs) - 1,
          stackTrace: this.captureStackTrace(),
        });
      }
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private captureStackTrace(): string {
    try { throw new Error('__telemetry_frame_drop__'); }
    catch (e: any) { return (e.stack ?? '').replace('Error: __telemetry_frame_drop__\n', ''); }
  }

  captureMemorySnapshot(): MemorySnapshot {
    const g = global as any;
    let usedJSHeapMB = 0, totalJSHeapMB = 0;
    if (typeof g.__hermesMemoryInfo === 'function') {
      const info = g.__hermesMemoryInfo();
      usedJSHeapMB  = (info.used  ?? 0) / 1048576;
      totalJSHeapMB = (info.total ?? 0) / 1048576;
    } else if (g.performance?.memory) {
      usedJSHeapMB  = g.performance.memory.usedJSHeapSize  / 1048576;
      totalJSHeapMB = g.performance.memory.totalJSHeapSize / 1048576;
    }
    const snap: MemorySnapshot = {
      type: 'memory',
      timestamp: performance.now(),
      usedJSHeapMB:  Math.round(usedJSHeapMB  * 100) / 100,
      totalJSHeapMB: Math.round(totalJSHeapMB * 100) / 100,
    };
    this.emit(snap);
    return snap;
  }

  private instrumentFetch(): void {
    if (typeof fetch === 'undefined') return;
    this.originalFetch = fetch;
    const collector = this;
    const origFetch = this.originalFetch;
    (global as any).fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      const start = performance.now();
      try {
        const response = await origFetch(input, init);
        collector.recordLatency(url, method, performance.now() - start, response.status);
        return response;
      } catch (err) {
        collector.recordLatency(url, method, performance.now() - start, undefined);
        throw err;
      }
    };
  }

  private restoreFetch(): void {
    if (this.originalFetch) { (global as any).fetch = this.originalFetch; this.originalFetch = null; }
  }

  recordLatency(url: string, method: string, durationMs: number, statusCode?: number): void {
    this.emit({
      type: 'network_latency',
      url, method,
      durationMs: Math.round(durationMs),
      statusCode,
      timestamp: performance.now(),
      latencyBucket: Math.floor(durationMs / this.config.latencyBucketMs),
    });
  }

  buildLatencyHeatmap(): Map<number, Map<string, number>> {
    const heatmap = new Map<number, Map<string, number>>();
    for (const event of this.buffer.toArray()) {
      if (event.type !== 'network_latency') continue;
      if (!heatmap.has(event.latencyBucket)) heatmap.set(event.latencyBucket, new Map());
      const urlMap = heatmap.get(event.latencyBucket)!;
      urlMap.set(event.url, (urlMap.get(event.url) ?? 0) + 1);
    }
    return heatmap;
  }

  subscribe(fn: TelemetrySubscriber): () => void {
    this.subscribers.push(fn);
    return () => { this.subscribers = this.subscribers.filter(s => s !== fn); };
  }

  private emit(event: TelemetryEvent): void {
    this.buffer.push(event);
    for (const sub of this.subscribers) { try { sub(event); } catch { /* isolated */ } }
  }

  flush(): TelemetryEvent[] { return this.buffer.toArray(); }
  getFrameDropEvents(): FrameDropEvent[] { return this.flush().filter((e): e is FrameDropEvent => e.type === 'frame_drop'); }
  clear(): void { this.buffer.clear(); }
}

export const telemetry = new TelemetryCollector();
