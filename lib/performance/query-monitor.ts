/**
 * Query performance monitoring and N+1 detection
 * Tracks database queries and identifies N+1 patterns
 */

interface QueryMetric {
  path: string;
  method: string;
  duration: number;
  timestamp: number;
  batchSize?: number;
}

interface PrismaQueryMetric {
  operation: string;
  duration: number;
  timestamp: number;
}

class QueryMonitor {
  private metrics: QueryMetric[] = [];
  private prismaMetrics: PrismaQueryMetric[] = [];
  private readonly maxMetrics = 1000;
  private enabled =
    typeof window !== "undefined" && process.env.NODE_ENV === "development";
  private prismaEnabled =
    typeof window === "undefined" && process.env.NODE_ENV === "development";

  recordQuery(
    path: string,
    method: string,
    duration: number,
    batchSize?: number,
  ) {
    if (!this.enabled) return;

    this.metrics.push({
      path,
      method,
      duration,
      timestamp: Date.now(),
      batchSize,
    });

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  recordPrismaQuery(operation: string, duration: number) {
    if (!this.prismaEnabled) return;

    this.prismaMetrics.push({
      operation,
      duration,
      timestamp: Date.now(),
    });

    if (this.prismaMetrics.length > this.maxMetrics) {
      this.prismaMetrics = this.prismaMetrics.slice(-this.maxMetrics);
    }
  }

  /**
   * Detect potential N+1 queries
   * Returns suspicious patterns where many similar queries are made in quick succession
   */
  detectN1Patterns() {
    const patterns: Record<string, QueryMetric[]> = {};

    // Group queries by path
    for (const metric of this.metrics) {
      if (!patterns[metric.path]) {
        patterns[metric.path] = [];
      }
      patterns[metric.path].push(metric);
    }

    const suspicious = [];

    // Find paths with many queries in short time window
    for (const [path, queries] of Object.entries(patterns)) {
      if (queries.length < 5) continue; // Ignore small batches

      // Check if queries happened within 1 second
      const timeWindow = 1000;
      const recentQueries = queries.filter(
        (q) => Date.now() - q.timestamp < timeWindow,
      );

      if (recentQueries.length >= 5) {
        suspicious.push({
          path,
          count: recentQueries.length,
          totalDuration: recentQueries.reduce((sum, q) => sum + q.duration, 0),
          avgDuration:
            recentQueries.reduce((sum, q) => sum + q.duration, 0) /
            recentQueries.length,
        });
      }
    }

    return suspicious;
  }

  /**
   * Get performance summary
   */
  getSummary() {
    if (this.metrics.length === 0) {
      return { totalQueries: 0, avgDuration: 0, totalDuration: 0 };
    }

    const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    const avgDuration = totalDuration / this.metrics.length;

    return {
      totalQueries: this.metrics.length,
      avgDuration: Math.round(avgDuration),
      totalDuration: Math.round(totalDuration),
    };
  }

  /**
   * Log performance report to console
   */
  logReport() {
    if (!this.enabled) return;

    const summary = this.getSummary();
    const suspicious = this.detectN1Patterns();

    console.group("📊 Query Performance Report");
    console.log("Total Queries:", summary.totalQueries);
    console.log("Avg Duration:", summary.avgDuration + "ms");
    console.log("Total Duration:", summary.totalDuration + "ms");

    if (suspicious.length > 0) {
      console.group("⚠️ Potential N+1 Patterns Detected");
      suspicious.forEach((pattern) => {
        console.warn(
          `${pattern.path}: ${pattern.count} queries in 1s (${pattern.avgDuration}ms avg)`,
        );
      });
      console.groupEnd();
    }

    console.groupEnd();
  }

  getPrismaQueryCount(): number {
    return this.prismaMetrics.length;
  }

  clear() {
    this.metrics = [];
    this.prismaMetrics = [];
  }
}

export const queryMonitor = new QueryMonitor();

/**
 * Wrap a fetch call with query monitoring
 */
export async function monitoredFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const method = init?.method || "GET";
  const startTime = performance.now();

  try {
    const response = await fetch(path, init);
    const duration = performance.now() - startTime;

    // Extract batch size from request body if available
    let batchSize: number | undefined;
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if (Array.isArray(body.creatorIds)) {
          batchSize = body.creatorIds.length;
        }
      } catch {
        // Ignore parse errors
      }
    }

    queryMonitor.recordQuery(path, method, duration, batchSize);
    return response.json();
  } catch (error) {
    const duration = performance.now() - startTime;
    queryMonitor.recordQuery(path, method, duration);
    throw error;
  }
}
