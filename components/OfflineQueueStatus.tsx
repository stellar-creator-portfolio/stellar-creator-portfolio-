'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, WifiOff, AlertTriangle } from 'lucide-react'
import { getQueueStats, retryFailed, flush } from '@/lib/sw/offline-queue'

export function OfflineQueueStatus() {
  const [stats, setStats] = useState<{ pending: number; failed: number }>({ pending: 0, failed: 0 })
  const [isFlushing, setIsFlushing] = useState(false)

  const refresh = useCallback(async () => {
    const s = await getQueueStats()
    setStats(s)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 30000)
    return () => clearInterval(interval)
  }, [refresh])

  const handleRetry = async () => {
    setIsFlushing(true)
    await retryFailed()
    await refresh()
    setIsFlushing(false)
  }

  const handleFlush = async () => {
    setIsFlushing(true)
    await flush()
    await refresh()
    setIsFlushing(false)
  }

  if (stats.pending === 0 && stats.failed === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border bg-background p-3 shadow-lg">
      {stats.pending > 0 && (
        <Badge variant="secondary" className="gap-1">
          <WifiOff className="h-3 w-3" />
          {stats.pending} pending
        </Badge>
      )}
      {stats.failed > 0 && (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {stats.failed} failed
        </Badge>
      )}
      {stats.failed > 0 && (
        <Button variant="outline" size="sm" onClick={handleRetry} disabled={isFlushing}>
          <RefreshCw className={`h-3 w-3 ${isFlushing ? 'animate-spin' : ''}`} />
          Retry
        </Button>
      )}
      {stats.pending > 0 && (
        <Button variant="outline" size="sm" onClick={handleFlush} disabled={isFlushing}>
          <RefreshCw className={`h-3 w-3 ${isFlushing ? 'animate-spin' : ''}`} />
          Sync
        </Button>
      )}
    </div>
  )
}
