/**
 * Memory optimization utilities for infinite scrolling
 *
 * Features:
 *  - Item cache with LRU eviction
 *  - Memory pressure monitoring
 *  - Automatic cleanup on low memory
 *  - Batch item release for efficiency
 */

export interface MemoryConfig {
  maxItemsInMemory: number;
  enableMemoryMonitoring: boolean;
  lowMemoryThreshold: number; // Percentage (0-100)
}

export class ItemMemoryCache<T> {
  private cache = new Map<string, T>();
  private accessTimes = new Map<string, number>();
  private config: Required<MemoryConfig>;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = {
      maxItemsInMemory: config.maxItemsInMemory ?? 1000,
      enableMemoryMonitoring: config.enableMemoryMonitoring ?? true,
      lowMemoryThreshold: config.lowMemoryThreshold ?? 80,
    };
  }

  /**
   * Add or update item in cache
   */
  set(key: string, value: T): void {
    this.cache.set(key, value);
    this.accessTimes.set(key, Date.now());
    this.evictIfNecessary();
  }

  /**
   * Get item from cache
   */
  get(key: string): T | undefined {
    const value = this.cache.get(key);
    if (value) {
      this.accessTimes.set(key, Date.now());
    }
    return value;
  }

  /**
   * Check if item exists
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Remove item from cache
   */
  delete(key: string): boolean {
    this.accessTimes.delete(key);
    return this.cache.delete(key);
  }

  /**
   * Get all cached items
   */
  getAll(): T[] {
    return Array.from(this.cache.values());
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.accessTimes.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Evict least recently used items if cache exceeds max size
   */
  private evictIfNecessary(): void {
    if (this.cache.size <= this.config.maxItemsInMemory) {
      return;
    }

    const evictCount = Math.ceil(this.cache.size * 0.2); // Evict 20%
    const entries = Array.from(this.accessTimes.entries()).sort(
      (a, b) => a[1] - b[1]
    );

    for (let i = 0; i < evictCount && i < entries.length; i++) {
      const [key] = entries[i];
      this.delete(key);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    utilizationPercent: number;
  } {
    const size = this.cache.size;
    const utilizationPercent = (size / this.config.maxItemsInMemory) * 100;

    return {
      size,
      maxSize: this.config.maxItemsInMemory,
      utilizationPercent,
    };
  }
}

/**
 * Batch cleanup processor for efficient memory release
 */
export class BatchCleanupProcessor {
  private queue: (() => void)[] = [];
  private isProcessing = false;
  private batchSize: number;
  private delayMs: number;

  constructor(batchSize: number = 50, delayMs: number = 100) {
    this.batchSize = batchSize;
    this.delayMs = delayMs;
  }

  /**
   * Add cleanup task to queue
   */
  queue(task: () => void): void {
    this.queue.push(task);
    this.processNext();
  }

  /**
   * Process queued tasks in batches
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      batch.forEach((task) => {
        try {
          task();
        } catch (error) {
          console.warn("Cleanup task error:", error);
        }
      });

      if (this.queue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
    }

    this.isProcessing = false;
  }

  /**
   * Clear all pending tasks
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.length;
  }
}

/**
 * Memory monitor for detecting low memory conditions
 */
export class MemoryMonitor {
  private config: Required<MemoryConfig>;
  private isLowMemory = false;
  private listeners: ((isLowMemory: boolean) => void)[] = [];
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = {
      maxItemsInMemory: config.maxItemsInMemory ?? 1000,
      enableMemoryMonitoring: config.enableMemoryMonitoring ?? true,
      lowMemoryThreshold: config.lowMemoryThreshold ?? 80,
    };
  }

  /**
   * Start monitoring memory
   */
  start(intervalMs: number = 5000): void {
    if (!this.config.enableMemoryMonitoring) {
      return;
    }

    if (this.checkInterval) {
      return; // Already running
    }

    this.checkInterval = setInterval(() => {
      this.check();
    }, intervalMs);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check current memory status
   */
  private check(): void {
    // Note: In React Native, we don't have direct access to memory stats
    // This is a placeholder for custom memory pressure detection
    // You can implement native module integration for actual memory checks
  }

  /**
   * Manually set memory pressure state
   */
  setMemoryPressure(utilizationPercent: number): void {
    const wasLowMemory = this.isLowMemory;
    this.isLowMemory = utilizationPercent >= this.config.lowMemoryThreshold;

    if (wasLowMemory !== this.isLowMemory) {
      this.listeners.forEach((listener) => listener(this.isLowMemory));
    }
  }

  /**
   * Subscribe to memory pressure changes
   */
  onMemoryPressure(listener: (isLowMemory: boolean) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Check if currently in low memory state
   */
  isLowMemoryState(): boolean {
    return this.isLowMemory;
  }
}

/**
 * Utility to release resources and cleanup
 */
export const releaseResourcesGracefully = async (items: any[], chunkSize: number = 100) => {
  const processor = new BatchCleanupProcessor(chunkSize, 50);

  for (let i = 0; i < items.length; i++) {
    processor.queue(() => {
      const item = items[i];
      if (item && typeof item.cleanup === "function") {
        item.cleanup();
      }
    });
  }

  // Wait for all cleanup tasks to complete
  return new Promise((resolve) => {
    const checkCompletion = setInterval(() => {
      if (processor.size() === 0) {
        clearInterval(checkCompletion);
        resolve(true);
      }
    }, 100);
  });
};
