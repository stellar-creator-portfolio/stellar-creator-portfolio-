'use client'

/**
 * useAnalyticsWorker
 *
 * Manages a singleton analytics WebWorker and exposes a typed `run` function
 * that dispatches tasks via structured-clone postMessage and resolves with the
 * result — keeping all heavy data-mutation off the main thread.
 */

import { useEffect, useRef, useCallback } from 'react'
import type {
  BountyRecord,
  ApplicationRecord,
  DateRange,
  Granularity,
  EarningsMetrics,
  PerformanceMetrics,
  FunnelStage,
  TrendPoint,
  PeerComparison,
  PredictiveTrend,
  ExportPayload,
} from '@/lib/analytics/analytics-engine'

// ─── Task type map ────────────────────────────────────────────────────────────

type TaskMap = {
  computeEarningsMetrics: {
    payload: { bounties: BountyRecord[]; applications: ApplicationRecord[]; range: { start: string; end: string } }
    result: EarningsMetrics
  }
  computePerformanceMetrics: {
    payload: { bounties: BountyRecord[]; applications: ApplicationRecord[] }
    result: PerformanceMetrics
  }
  computeConversionFunnel: {
    payload: { bounties: BountyRecord[]; applications: ApplicationRecord[] }
    result: FunnelStage[]
  }
  computeTrendData: {
    payload: { items: { date: string; value: number }[]; range: { start: string; end: string }; granularity: Granularity }
    result: TrendPoint[]
  }
  computePeerComparison: {
    payload: { userMetrics: Record<string, number>; platformAverages: Record<string, number> }
    result: PeerComparison[]
  }
  computePredictiveTrends: {
    payload: { historical: TrendPoint[] }
    result: PredictiveTrend
  }
  formatDataForExport: {
    payload: { metrics: Record<string, unknown>; format: 'csv' | 'json' }
    result: ExportPayload
  }
}

type TaskType = keyof TaskMap

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalyticsWorker() {
  const workerRef = useRef<Worker | null>(null)
  // pending promise resolvers keyed by message id
  const pendingRef = useRef<Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>>(new Map())
  const idRef = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const worker = new Worker('/workers/analytics.worker.js')
    workerRef.current = worker

    worker.onmessage = ({ data }: MessageEvent<{ id: string; result?: unknown; error?: string }>) => {
      const pending = pendingRef.current.get(data.id)
      if (!pending) return
      pendingRef.current.delete(data.id)
      if (data.error) {
        pending.reject(new Error(data.error))
      } else {
        pending.resolve(data.result)
      }
    }

    worker.onerror = (e) => {
      console.error('[analytics worker]', e.message)
    }

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  /**
   * Dispatch a task to the worker and await the structured-clone result.
   * Serialisation/deserialisation is handled automatically by the browser.
   */
  const run = useCallback(
    <T extends TaskType>(type: T, payload: TaskMap[T]['payload']): Promise<TaskMap[T]['result']> => {
      return new Promise((resolve, reject) => {
        const worker = workerRef.current
        if (!worker) {
          reject(new Error('Analytics worker not initialised'))
          return
        }
        const id = String(++idRef.current)
        pendingRef.current.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
        })
        // structured clone happens automatically here
        worker.postMessage({ id, type, payload })
      })
    },
    [],
  )

  return { run }
}

// ─── Convenience: serialise DateRange for postMessage ────────────────────────

export function serializeRange(range: DateRange): { start: string; end: string } {
  return {
    start: range.start instanceof Date ? range.start.toISOString() : range.start,
    end: range.end instanceof Date ? range.end.toISOString() : range.end,
  }
}
