'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface SwapStatusData {
  id: string;
  status: 'pending' | 'completed' | 'failed';
  fromTxHash: string | null;
  bridgeTxHash: string | null;
  toTxHash: string | null;
  amountOut: string | null;
  completedAt: string | null;
  createdAt: string;
  currentStep: number;
  totalSteps: number;
  stepLabel: string;
}

interface UseSwapStatusResult {
  status: SwapStatusData | null;
  isLoading: boolean;
  error: string | null;
  stopPolling: () => void;
}

const POLL_INTERVAL = 5000;

const STEP_LABELS = ['Initiating source chain transfer', 'Processing bridge transfer', 'Completing destination chain transfer'];

export function useSwapStatus(swapId: string | null): UseSwapStatusResult {
  const [data, setData] = useState<SwapStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!swapId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/swap/${swapId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError('Swap not found');
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const raw = await res.json();

      let currentStep = 0;
      let totalSteps = 3;
      if (raw.status === 'pending') {
        if (raw.fromTxHash && !raw.bridgeTxHash) currentStep = 1;
        else if (raw.bridgeTxHash && !raw.toTxHash) currentStep = 2;
        else currentStep = 0;
      } else if (raw.status === 'completed') {
        currentStep = 3;
      }

      setData({
        ...raw,
        currentStep,
        totalSteps,
        stepLabel: currentStep < totalSteps ? STEP_LABELS[currentStep] ?? 'Processing' : 'Completed',
      });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [swapId]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!swapId) return;
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL);
    return () => stopPolling();
  }, [swapId, fetchStatus, stopPolling]);

  return { status: data, isLoading, error, stopPolling };
}
