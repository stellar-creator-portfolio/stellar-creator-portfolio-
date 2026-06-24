'use client'

import { useEffect } from 'react'
import { flush, clearStaleMutations } from '@/lib/sw/offline-queue'
import { toast } from '@/hooks/use-toast'

export function useOfflineQueue() {
  useEffect(() => {
    clearStaleMutations()

    const handleOnline = async () => {
      const result = await flush()
      if (result.replayed > 0 || result.failed > 0 || result.authFailed > 0) {
        toast({
          title: 'Offline Queue Synced',
          description: `Replayed: ${result.replayed}, Failed: ${result.failed}`,
          variant: result.failed > 0 || result.authFailed > 0 ? 'destructive' : 'default',
        })
      }
      if (result.failed > 0 || result.authFailed > 0) {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'FLUSH_RESULT',
            ...result,
          })
        }
      }
    }

    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'FLUSH_OFFLINE_QUEUE') {
        handleOnline()
      }
    }

    window.addEventListener('online', handleOnline)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage)
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage)
      }
    }
  }, [])
}
