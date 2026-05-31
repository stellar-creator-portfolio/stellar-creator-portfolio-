'use client'

/**
 * AnalyticsDashboard
 *
 * Renders earnings, performance, funnel, trend, and predictive charts.
 * All heavy data-mutation runs in the analytics WebWorker — the main thread
 * only handles rendering, guaranteeing consistent 60fps.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAnalyticsWorker, serializeRange } from '@/hooks/useAnalyticsWorker'
import {
  generateMockBounties,
  generateMockApplications,
  dateRangeFromPreset,
  MOCK_PLATFORM_AVERAGES,
  type EarningsMetrics,
  type PerformanceMetrics,
  type FunnelStage,
  type TrendPoint,
  type PredictiveTrend,
} from '@/lib/analytics/analytics-engine'

const COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e']

interface DashboardState {
  earnings: EarningsMetrics | null
  performance: PerformanceMetrics | null
  funnel: FunnelStage[]
  trend: TrendPoint[]
  predictive: PredictiveTrend | null
  loading: boolean
}

export function AnalyticsDashboard() {
  const { run } = useAnalyticsWorker()
  const [state, setState] = useState<DashboardState>({
    earnings: null,
    performance: null,
    funnel: [],
    trend: [],
    predictive: null,
    loading: true,
  })

  const compute = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))

    const bounties = generateMockBounties(120)
    const applications = generateMockApplications(bounties)
    const range = serializeRange(dateRangeFromPreset('90d'))

    // Dispatch all tasks to the worker in parallel — main thread stays free
    const [earnings, performance, funnel, trend] = await Promise.all([
      run('computeEarningsMetrics', { bounties, applications, range }),
      run('computePerformanceMetrics', { bounties, applications }),
      run('computeConversionFunnel', { bounties, applications }),
      run('computeTrendData', {
        items: bounties.map((b) => ({ date: b.updatedAt, value: b.budget })),
        range,
        granularity: 'weekly',
      }),
    ])

    const predictive = await run('computePredictiveTrends', { historical: trend })

    setState({ earnings, performance, funnel, trend, predictive, loading: false })
  }, [run])

  useEffect(() => { compute() }, [compute])

  if (state.loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader><div className="h-4 w-32 bg-muted rounded" /></CardHeader>
            <CardContent><div className="h-40 bg-muted rounded" /></CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const { earnings, performance, funnel, trend, predictive } = state

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Earnings" value={`$${((earnings?.totalEarnings ?? 0) / 100).toLocaleString()}`} />
        <KpiCard label="Completion Rate" value={`${performance?.completionRate ?? 0}%`} />
        <KpiCard label="Acceptance Rate" value={`${performance?.acceptanceRate ?? 0}%`} />
        <KpiCard label="Active Bounties" value={String(performance?.activeBounties ?? 0)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Earnings by category */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Earnings by Category</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={Object.entries(earnings?.byCategory ?? {}).map(([name, value]) => ({ name, value: value / 100 }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                <Bar dataKey="value">
                  {Object.keys(earnings?.byCategory ?? {}).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Conversion funnel */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Conversion Funnel</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={funnel} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Weekly earnings trend */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Weekly Earnings Trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trend.map((p) => ({ ...p, value: p.value / 100 }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                <Line type="monotone" dataKey="value" stroke="#6366f1" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Predictive summary */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Next Period Forecast</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 pt-2">
            <KpiRow label="Estimated Earnings" value={`$${((predictive?.nextPeriodEstimate ?? 0) / 100).toLocaleString()}`} />
            <KpiRow label="Growth Rate" value={`${predictive?.growthRate ?? 0}%`} />
            <KpiRow label="Model Confidence" value={`${Math.round((predictive?.confidence ?? 0) * 100)}%`} />
            <KpiRow label="Trend" value={`${earnings?.trend ?? 0}% vs prev period`} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  )
}

function KpiRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
