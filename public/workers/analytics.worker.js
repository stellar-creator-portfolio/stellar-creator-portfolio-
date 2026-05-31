/**
 * Analytics WebWorker
 *
 * Runs all heavy data-mutation functions off the main thread.
 * Communicates via structured-clone (postMessage) — no Transferable needed
 * because the payloads are plain objects/arrays.
 *
 * Message protocol:
 *   IN  { id, type, payload }
 *   OUT { id, result }  |  { id, error }
 */

// ─── Inline analytics engine (copied from lib/analytics/analytics-engine.ts) ──
// Workers cannot import TS modules directly; we inline the pure functions.

function isWithinRange(dateStr, range) {
  const d = new Date(dateStr)
  return d >= new Date(range.start) && d <= new Date(range.end)
}

function previousRange(range) {
  const start = new Date(range.start)
  const end = new Date(range.end)
  const durationMs = end - start
  return {
    start: new Date(start - durationMs).toISOString(),
    end: new Date(start - 1).toISOString(),
  }
}

function computeEarningsMetrics(bounties, _applications, range) {
  const inRange = bounties.filter(
    (b) => b.status === 'completed' && isWithinRange(b.updatedAt, range),
  )
  const prev = previousRange(range)
  const inPrev = bounties.filter(
    (b) => b.status === 'completed' && isWithinRange(b.updatedAt, prev),
  )
  const total = inRange.reduce((s, b) => s + b.budget, 0)
  const prevTotal = inPrev.reduce((s, b) => s + b.budget, 0)
  const byCategory = {}
  for (const b of inRange) {
    const cat = b.category || 'Uncategorized'
    byCategory[cat] = (byCategory[cat] || 0) + b.budget
  }
  return {
    totalEarnings: total,
    averagePerBounty: inRange.length ? Math.round(total / inRange.length) : 0,
    completedCount: inRange.length,
    trend: prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0,
    byCategory,
  }
}

function computePerformanceMetrics(bounties, applications) {
  const completed = bounties.filter((b) => b.status === 'completed').length
  const total = bounties.length
  const active = bounties.filter(
    (b) => b.status === 'open' || b.status === 'in-progress',
  ).length
  const accepted = applications.filter((a) => a.status === 'accepted').length
  const totalApps = applications.length
  return {
    completionRate: total ? Math.round((completed / total) * 100) : 0,
    acceptanceRate: totalApps ? Math.round((accepted / totalApps) * 100) : 0,
    activeBounties: active,
    completedBounties: completed,
    avgRating: 4.5,
    totalApplications: totalApps,
  }
}

function computeConversionFunnel(bounties, applications) {
  const posted = bounties.length
  const applied = new Set(applications.map((a) => a.bountyId)).size
  const accepted = applications.filter((a) => a.status === 'accepted').length
  const completed = bounties.filter((b) => b.status === 'completed').length
  const stages = [
    { name: 'Bounties Posted', value: posted },
    { name: 'Received Applications', value: applied },
    { name: 'Applications Accepted', value: accepted },
    { name: 'Bounties Completed', value: completed },
  ]
  return stages.map((s) => ({
    ...s,
    percentage: posted ? Math.round((s.value / posted) * 100) : 0,
  }))
}

function bucketKey(date, granularity) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  if (granularity === 'daily') return `${y}-${m}-${d}`
  if (granularity === 'weekly') {
    const day = date.getDay() || 7
    const monday = new Date(date)
    monday.setDate(date.getDate() - day + 1)
    const wm = String(monday.getMonth() + 1).padStart(2, '0')
    const wd = String(monday.getDate()).padStart(2, '0')
    return `${monday.getFullYear()}-${wm}-${wd}`
  }
  return `${y}-${m}`
}

function computeTrendData(items, range, granularity) {
  const filtered = items.filter((i) => isWithinRange(i.date, range))
  const buckets = {}
  for (const item of filtered) {
    const key = bucketKey(new Date(item.date), granularity)
    buckets[key] = (buckets[key] || 0) + item.value
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }))
}

function computePeerComparison(userMetrics, platformAverages) {
  return Object.keys(userMetrics).map((metric) => {
    const you = userMetrics[metric]
    const avg = platformAverages[metric] || 1
    const percentile = Math.min(99, Math.round((you / avg) * 50))
    return { metric, you, average: avg, percentile }
  })
}

function computePredictiveTrends(historical) {
  if (historical.length < 2) return { nextPeriodEstimate: 0, growthRate: 0, confidence: 0 }
  const n = historical.length
  const xs = historical.map((_, i) => i)
  const ys = historical.map((p) => p.value)
  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0)
  const sumX2 = xs.reduce((a, x) => a + x * x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return { nextPeriodEstimate: ys[n - 1], growthRate: 0, confidence: 0 }
  const m = (n * sumXY - sumX * sumY) / denom
  const b = (sumY - m * sumX) / n
  const nextEstimate = Math.max(0, Math.round(m * n + b))
  const lastValue = ys[n - 1] || 1
  const growthRate = Math.round((m / lastValue) * 100)
  const yMean = sumY / n
  const ssTot = ys.reduce((a, y) => a + (y - yMean) ** 2, 0)
  const ssRes = ys.reduce((a, y, i) => a + (y - (m * xs[i] + b)) ** 2, 0)
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0
  return {
    nextPeriodEstimate: nextEstimate,
    growthRate,
    confidence: Math.max(0, Math.min(1, parseFloat(r2.toFixed(2)))),
  }
}

function formatDataForExport(metrics, format) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  if (format === 'json') {
    return { format: 'json', data: JSON.stringify(metrics, null, 2), filename: `analytics-${timestamp}.json` }
  }
  const rows = [['Metric', 'Value']]
  function flatten(obj, prefix = '') {
    for (const [key, val] of Object.entries(obj)) {
      const label = prefix ? `${prefix}.${key}` : key
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        flatten(val, label)
      } else {
        rows.push([label, String(val)])
      }
    }
  }
  flatten(metrics)
  return {
    format: 'csv',
    data: rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n'),
    filename: `analytics-${timestamp}.csv`,
  }
}

// ─── Message dispatcher ───────────────────────────────────────────────────────

const HANDLERS = {
  computeEarningsMetrics: ({ bounties, applications, range }) =>
    computeEarningsMetrics(bounties, applications, range),

  computePerformanceMetrics: ({ bounties, applications }) =>
    computePerformanceMetrics(bounties, applications),

  computeConversionFunnel: ({ bounties, applications }) =>
    computeConversionFunnel(bounties, applications),

  computeTrendData: ({ items, range, granularity }) =>
    computeTrendData(items, range, granularity),

  computePeerComparison: ({ userMetrics, platformAverages }) =>
    computePeerComparison(userMetrics, platformAverages),

  computePredictiveTrends: ({ historical }) =>
    computePredictiveTrends(historical),

  formatDataForExport: ({ metrics, format }) =>
    formatDataForExport(metrics, format),
}

self.onmessage = function ({ data }) {
  const { id, type, payload } = data
  const handler = HANDLERS[type]
  if (!handler) {
    self.postMessage({ id, error: `Unknown task type: ${type}` })
    return
  }
  try {
    // structured clone happens automatically via postMessage
    const result = handler(payload)
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
