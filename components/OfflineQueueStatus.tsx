'use client';
import { useEffect, useState } from 'react';
import { listQueued, flush, OfflineMutation } from '../lib/sw/offline-queue';

export function OfflineQueueStatus() {
  const [mutations, setMutations] = useState<OfflineMutation[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const q = await listQueued();
      setMutations(q);
    }
    load();
    const interval = setInterval(load, 5000);

    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'MUTATION_FAILED') {
        setToastMessage(`Mutation failed: ${event.data.reason || 'Unknown error'}`);
        load();
      }
    };

    navigator.serviceWorker?.addEventListener('message', handleMessage);

    return () => {
      clearInterval(interval);
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
    };
  }, []);

  const pending = mutations.filter(m => m.status === 'pending' || m.status === 'replaying');
  const failed = mutations.filter(m => m.status === 'failed');

  const handleRetry = async () => {
    await flush();
    const q = await listQueued();
    setMutations(q);
  };

  if (pending.length === 0 && failed.length === 0 && !toastMessage) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-white p-4 shadow-lg rounded-lg border border-gray-200 z-50">
      {toastMessage && (
        <div className="mb-2 p-2 bg-red-100 text-red-700 rounded text-sm">
          {toastMessage}
          <button className="ml-2 underline" onClick={() => setToastMessage(null)}>Dismiss</button>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {pending.length > 0 && (
          <div className="text-sm text-gray-700">
            {pending.length} pending mutation{pending.length > 1 ? 's' : ''}
          </div>
        )}
        {failed.length > 0 && (
          <div className="text-sm text-red-600">
            {failed.length} failed mutation{failed.length > 1 ? 's' : ''}
          </div>
        )}
        {failed.length > 0 && (
          <button 
            onClick={handleRetry}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
          >
            Retry Failed
          </button>
        )}
      </div>
    </div>
  );
}
