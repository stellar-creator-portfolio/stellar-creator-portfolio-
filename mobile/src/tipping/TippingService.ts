/**
 * Social token tipping with Soroban fast-path and atomic state.
 * Atomicity: optimistic balance lock → submit → commit/rollback.
 * useTipAnimation: Reanimated worklet — all transitions on UI thread.
 */

import {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { useCallback, useState, useRef } from 'react';

export type TipAsset = 'XLM' | 'USDC' | string;

export interface TipRequest {
  fromAddress:    string;
  toAddress:      string;
  amount:         string;
  asset:          TipAsset;
  memo?:          string;
  idempotencyKey: string;
}

export type TipStatus = 'idle' | 'submitting' | 'success' | 'failed' | 'rolled_back';

export interface TipResult {
  status: TipStatus;
  txHash?: string;
  error?: string;
  confirmedAmount?: string;
}

export interface TipState {
  balance: number;
  pendingTips: Map<string, TipRequest>;
  completedTips: TipResult[];
  status: TipStatus;
  lastError?: string;
}

export class TipLock {
  private locks = new Set<string>();
  acquire(key: string): boolean { if (this.locks.has(key)) return false; this.locks.add(key); return true; }
  release(key: string): void { this.locks.delete(key); }
  isLocked(key: string): boolean { return this.locks.has(key); }
}

export class TippingStateManager {
  private state: TipState;
  private lock = new TipLock();
  private listeners: Array<(state: TipState) => void> = [];

  constructor(initialBalance: number) {
    this.state = { balance: initialBalance, pendingTips: new Map(), completedTips: [], status: 'idle' };
  }

  getState(): Readonly<TipState> { return { ...this.state }; }

  subscribe(fn: (state: TipState) => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private notify(): void {
    for (const fn of this.listeners) { try { fn(this.getState() as TipState); } catch { /* isolated */ } }
  }

  beginTip(request: TipRequest): (() => void) | null {
    if (!this.lock.acquire(request.idempotencyKey)) return null;
    const amount = parseFloat(request.amount);
    if (!isFinite(amount) || amount <= 0) { this.lock.release(request.idempotencyKey); return null; }
    if (this.state.balance < amount) {
      this.lock.release(request.idempotencyKey);
      this.state = { ...this.state, lastError: 'Insufficient balance' };
      this.notify();
      return null;
    }
    const previousBalance = this.state.balance;
    this.state = {
      ...this.state,
      balance: this.state.balance - amount,
      status: 'submitting',
      pendingTips: new Map(this.state.pendingTips).set(request.idempotencyKey, request),
    };
    this.notify();
    return () => {
      const pending = new Map(this.state.pendingTips);
      pending.delete(request.idempotencyKey);
      this.state = { ...this.state, balance: previousBalance, status: 'rolled_back', pendingTips: pending, lastError: 'Tip failed — balance restored' };
      this.lock.release(request.idempotencyKey);
      this.notify();
    };
  }

  commitTip(idempotencyKey: string, result: TipResult): void {
    const pending = new Map(this.state.pendingTips);
    pending.delete(idempotencyKey);
    this.state = { ...this.state, status: 'success', pendingTips: pending, completedTips: [...this.state.completedTips, result], lastError: undefined };
    this.lock.release(idempotencyKey);
    this.notify();
  }

  get balance(): number { return this.state.balance; }
  get pendingCount(): number { return this.state.pendingTips.size; }
}

export interface SorobanTipClient {
  submitTip(request: TipRequest): Promise<TipResult>;
}

/**
 * Default stub. Wire with real Soroban SDK:
 *   const contract = new StellarSdk.Contract(TIPPING_CONTRACT_ID);
 *   const op = contract.call('tip', nativeToScVal(request.toAddress, { type: 'address' }),
 *     nativeToScVal(BigInt(Math.round(parseFloat(request.amount) * 1e7)), { type: 'i128' }));
 */
export const defaultSorobanTipClient: SorobanTipClient = {
  async submitTip(request: TipRequest): Promise<TipResult> {
    await new Promise(resolve => setTimeout(resolve, 300));
    return { status: 'success', txHash: `mock_tx_${request.idempotencyKey}`, confirmedAmount: request.amount };
  },
};

export function useTipAnimation() {
  const scale      = useSharedValue(0);
  const translateY = useSharedValue(0);
  const opacity    = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const triggerTipAnimation = useCallback(() => {
    scale.value = 0; translateY.value = 0; opacity.value = 0;
    scale.value = withSequence(
      withSpring(1.4, { stiffness: 400, damping: 12 }),
      withTiming(1.0, { duration: 150 }),
    );
    translateY.value = withTiming(-80, { duration: 800, easing: Easing.out(Easing.quad) });
    opacity.value = withSequence(
      withTiming(1.0, { duration: 100 }),
      withTiming(1.0, { duration: 400 }),
      withTiming(0.0, { duration: 300 }),
    );
  }, [scale, translateY, opacity]);

  return { animatedStyle, triggerTipAnimation };
}

export interface UseTippingOptions {
  stateManager: TippingStateManager;
  sorobanClient?: SorobanTipClient;
}

export function useTipping({ stateManager, sorobanClient = defaultSorobanTipClient }: UseTippingOptions) {
  const [status, setStatus] = useState<TipStatus>('idle');
  const [error, setError]   = useState<string | null>(null);
  const { animatedStyle, triggerTipAnimation } = useTipAnimation();
  const submitting = useRef(false);

  const sendTip = useCallback(async (request: TipRequest) => {
    if (submitting.current) return;
    submitting.current = true;
    const rollback = stateManager.beginTip(request);
    if (!rollback) { submitting.current = false; setError(stateManager.getState().lastError ?? 'Tip unavailable'); return; }
    setStatus('submitting'); setError(null);
    triggerTipAnimation();
    try {
      const result = await sorobanClient.submitTip(request);
      if (result.status === 'success') { stateManager.commitTip(request.idempotencyKey, result); setStatus('success'); }
      else { rollback(); setStatus('failed'); setError(result.error ?? 'Tip failed'); }
    } catch (err: any) {
      rollback(); setStatus('failed'); setError(err?.message ?? 'Network error');
    } finally { submitting.current = false; }
  }, [stateManager, sorobanClient, triggerTipAnimation]);

  return { sendTip, status, error, animatedStyle };
}
