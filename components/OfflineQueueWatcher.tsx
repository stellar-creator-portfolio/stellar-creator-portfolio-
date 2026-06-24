'use client'

import { useOfflineQueue } from '@/hooks/useOfflineQueue'
import { OfflineQueueStatus } from '@/components/OfflineQueueStatus'

export function OfflineQueueWatcher() {
  useOfflineQueue()
  return <OfflineQueueStatus />
}
