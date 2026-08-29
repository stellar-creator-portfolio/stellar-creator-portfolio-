import { getNetworkConfig, type NetworkName } from '@/lib/config/network';
import { prisma } from '@/lib/prisma';

export type ChainId = 'stellar' | 'ethereum' | 'polygon' | 'arbitrum';

export interface ChainInfo {
  id: ChainId;
  name: string;
  icon: string;
  nativeSymbol: string;
  color: string;
}

export interface SwapRoute {
  id: string;
  hops: Array<{ chain: ChainId; protocol: string; feeBps: number }>;
  estimatedMinutes: number;
  reliability: number;
}

export interface GasEstimate {
  sourceGas: string;
  destGas: string;
  bridgeFee: string;
  totalUsd: number;
  updatedAt: number;
}

export interface SwapQuote {
  fromChain: ChainId;
  toChain: ChainId;
  fromAmount: string;
  toAmount: string;
  route: SwapRoute;
  gas: GasEstimate;
  slippageBps: number;
  validUntil: number;
}

export interface SwapReceipt {
  id: string;
  status: 'pending' | 'completed' | 'failed';
  fromTxHash: string | null;
  bridgeTxHash: string | null;
  toTxHash: string | null;
  amountOut: string | null;
  completedAt: string | null;
  createdAt: string;
}

export class QuoteExpiredError extends Error {
  constructor() {
    super('Swap quote has expired. Please request a new quote.');
    this.name = 'QuoteExpiredError';
  }
}

export class IdempotentSwapError extends Error {
  public existingReceipt: SwapReceipt;
  constructor(receipt: SwapReceipt) {
    super('Swap already submitted. Returning existing receipt.');
    this.name = 'IdempotentSwapError';
    this.existingReceipt = receipt;
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(provider: string) {
    super(`Circuit breaker open for ${provider}. Falling back to alternative route.`);
    this.name = 'CircuitBreakerOpenError';
  }
}

const QUOTE_TTL_MS = 30_000;
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const MIN_SLIPPAGE_BPS_ETHEREUM = 100;

const circuitBreakerState = new Map<string, { failures: number[]; open: boolean }>();

function checkCircuitBreaker(provider: string): void {
  const state = circuitBreakerState.get(provider);
  if (!state) {
    circuitBreakerState.set(provider, { failures: [], open: false });
    return;
  }
  if (state.open) throw new CircuitBreakerOpenError(provider);
}

function recordCircuitFailure(provider: string): void {
  let state = circuitBreakerState.get(provider);
  if (!state) {
    state = { failures: [], open: false };
    circuitBreakerState.set(provider, state);
  }
  const now = Date.now();
  state.failures = state.failures.filter((t) => now - t < CIRCUIT_BREAKER_WINDOW_MS);
  state.failures.push(now);
  if (state.failures.length >= CIRCUIT_BREAKER_THRESHOLD) {
    state.open = true;
    setTimeout(() => {
      circuitBreakerState.delete(provider);
    }, CIRCUIT_BREAKER_WINDOW_MS);
  }
}

async function queryBridgeGas(protocol: string, from: ChainId, to: ChainId, amount: number): Promise<{ bridgeFee: string; totalUsd: number }> {
  try {
    checkCircuitBreaker(protocol);
    if (protocol === 'Allbridge') {
      const fee = amount * 0.0025;
      return { bridgeFee: `$${fee.toFixed(2)}`, totalUsd: fee };
    }
    if (protocol === 'Wormhole') {
      const fee = amount * 0.0035;
      return { bridgeFee: `$${fee.toFixed(2)}`, totalUsd: fee };
    }
  } catch {
    recordCircuitFailure(protocol);
    const fallbackFee = amount * 0.004;
    return { bridgeFee: `$${fallbackFee.toFixed(2)}`, totalUsd: fallbackFee };
  }
  const defaultFee = amount * 0.003;
  return { bridgeFee: `$${defaultFee.toFixed(2)}`, totalUsd: defaultFee };
}

export const SUPPORTED_CHAINS: ChainInfo[] = [
  { id: 'stellar', name: 'Stellar', icon: '✦', nativeSymbol: 'XLM', color: '#7B61FF' },
  { id: 'ethereum', name: 'Ethereum', icon: 'Ξ', nativeSymbol: 'ETH', color: '#627EEA' },
  { id: 'polygon', name: 'Polygon', icon: '⬡', nativeSymbol: 'MATIC', color: '#8247E5' },
  { id: 'arbitrum', name: 'Arbitrum', icon: '◆', nativeSymbol: 'ETH', color: '#28A0F0' },
];

const ROUTE_TEMPLATES: Record<string, SwapRoute> = {
  'stellar-polygon': {
    id: 'stellar-polygon-v1',
    hops: [
      { chain: 'stellar', protocol: 'Allbridge', feeBps: 8 },
      { chain: 'polygon', protocol: 'Stellar AMM', feeBps: 5 },
    ],
    estimatedMinutes: 4,
    reliability: 0.97,
  },
  'stellar-ethereum': {
    id: 'stellar-eth-v2',
    hops: [
      { chain: 'stellar', protocol: 'Wormhole', feeBps: 12 },
      { chain: 'ethereum', protocol: 'Uniswap V3', feeBps: 6 },
    ],
    estimatedMinutes: 8,
    reliability: 0.94,
  },
  'ethereum-arbitrum': {
    id: 'eth-arb-native',
    hops: [{ chain: 'arbitrum', protocol: 'Arbitrum Bridge', feeBps: 3 }],
    estimatedMinutes: 2,
    reliability: 0.99,
  },
};

function routeKey(from: ChainId, to: ChainId): string {
  return `${from}-${to}`;
}

export function findSwapRoute(from: ChainId, to: ChainId): SwapRoute {
  const key = routeKey(from, to);
  const reverse = routeKey(to, from);
  return (
    ROUTE_TEMPLATES[key] ??
    ROUTE_TEMPLATES[reverse] ?? {
      id: `${from}-${to}-direct`,
      hops: [{ chain: from, protocol: 'Atomic HTLC', feeBps: 10 }],
      estimatedMinutes: 6,
      reliability: 0.92,
    }
  );
}

export async function estimateGas(
  from: ChainId,
  to: ChainId,
  amount: number,
): Promise<GasEstimate> {
  const network = getNetworkConfig();
  const route = findSwapRoute(from, to);
  const bridgeProtocol = route.hops[0]?.protocol ?? 'Unknown';
  const bridgeEstimate = await queryBridgeGas(bridgeProtocol, from, to, amount);
  const baseGas = network.isTestnet ? 0.002 : 0.015;
  const bridgeMultiplier = from === to ? 1 : 2.4;

  return {
    sourceGas: `${(baseGas * bridgeMultiplier).toFixed(4)} ${SUPPORTED_CHAINS.find((c) => c.id === from)?.nativeSymbol ?? 'XLM'}`,
    destGas: `${(baseGas * 0.6).toFixed(4)} ${SUPPORTED_CHAINS.find((c) => c.id === to)?.nativeSymbol ?? 'ETH'}`,
    bridgeFee: bridgeEstimate.bridgeFee,
    totalUsd: bridgeEstimate.totalUsd + parseFloat((amount * 0.001 * bridgeMultiplier).toFixed(2)),
    updatedAt: Date.now(),
  };
}

export async function getSwapQuote(
  fromChain: ChainId,
  toChain: ChainId,
  fromAmount: string,
  slippageBps = 50,
): Promise<SwapQuote> {
  const amount = parseFloat(fromAmount) || 0;
  const route = findSwapRoute(fromChain, toChain);
  const gas = await estimateGas(fromChain, toChain, amount);

  const effectiveSlippage =
    fromChain === 'ethereum' || toChain === 'ethereum'
      ? Math.max(slippageBps, MIN_SLIPPAGE_BPS_ETHEREUM)
      : slippageBps;

  const feeTotal = route.hops.reduce((acc, h) => acc + h.feeBps, 0);
  const toAmount = (amount * (1 - feeTotal / 10_000) * (1 - effectiveSlippage / 10_000)).toFixed(4);

  return {
    fromChain,
    toChain,
    fromAmount,
    toAmount,
    route,
    gas,
    slippageBps: effectiveSlippage,
    validUntil: Date.now() + QUOTE_TTL_MS,
  };
}

export async function executeSwap(
  quote: SwapQuote,
  senderAddress: string,
): Promise<SwapReceipt> {
  if (Date.now() > quote.validUntil) {
    throw new QuoteExpiredError();
  }

  const existing = await prisma.crossChainSwap.findUnique({
    where: { routeId_senderAddress: { routeId: quote.route.id, senderAddress } },
  });

  if (existing) {
    const age = Date.now() - existing.createdAt.getTime();
    if (age < IDEMPOTENCY_WINDOW_MS) {
      throw new IdempotentSwapError({
        id: existing.id,
        status: existing.status as 'pending' | 'completed' | 'failed',
        fromTxHash: existing.fromTxHash,
        bridgeTxHash: existing.bridgeTxHash,
        toTxHash: existing.toTxHash,
        amountOut: existing.amountOut,
        completedAt: existing.completedAt?.toISOString() ?? null,
        createdAt: existing.createdAt.toISOString(),
      });
    }
  }

  const swap = await prisma.crossChainSwap.create({
    data: {
      routeId: quote.route.id,
      senderAddress,
      fromChain: quote.fromChain,
      toChain: quote.toChain,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      slippageBps: quote.slippageBps,
      status: 'pending',
    },
  });

  await prisma.auditLog.create({
    data: {
      resource: 'cross-chain-swap',
      action: 'execute',
      resourceId: swap.id,
      payload: {
        routeId: quote.route.id,
        senderAddress,
        fromChain: quote.fromChain,
        toChain: quote.toChain,
        fromAmount: quote.fromAmount,
        toAmount: quote.toAmount,
      },
      status: 'SUCCESS',
    },
  });

  let receipt: SwapReceipt;
  try {
    const firstHop = quote.route.hops[0];
    checkCircuitBreaker(firstHop.protocol);

    const fromTxHash = `0x${crypto.randomUUID().replace(/-/g, '')}`;
    await prisma.crossChainSwap.update({
      where: { id: swap.id },
      data: { fromTxHash, status: 'pending' },
    });

    const bridgeTxHash = `0x${crypto.randomUUID().replace(/-/g, '')}`;
    const toTxHash = `0x${crypto.randomUUID().replace(/-/g, '')}`;
    const amountOut = quote.toAmount;

    await prisma.crossChainSwap.update({
      where: { id: swap.id },
      data: {
        bridgeTxHash,
        toTxHash,
        amountOut,
        status: 'completed',
        completedAt: new Date(),
      },
    });

    receipt = {
      id: swap.id,
      status: 'completed',
      fromTxHash,
      bridgeTxHash,
      toTxHash,
      amountOut,
      completedAt: new Date().toISOString(),
      createdAt: swap.createdAt.toISOString(),
    };
  } catch (err) {
    const firstHop = quote.route.hops[0];
    if (err instanceof CircuitBreakerOpenError) {
      recordCircuitFailure(firstHop.protocol);
    } else {
      recordCircuitFailure(firstHop.protocol);
    }

    await prisma.crossChainSwap.update({
      where: { id: swap.id },
      data: { status: 'failed' },
    });

    await prisma.auditLog.create({
      data: {
        resource: 'cross-chain-swap',
        action: 'fail',
        resourceId: swap.id,
        payload: { error: (err as Error).message },
        status: 'FAILURE',
      },
    });

    receipt = {
      id: swap.id,
      status: 'failed',
      fromTxHash: null,
      bridgeTxHash: null,
      toTxHash: null,
      amountOut: null,
      completedAt: null,
      createdAt: swap.createdAt.toISOString(),
    };
  }

  return receipt;
}

export async function getSwapStatus(swapId: string): Promise<SwapReceipt | null> {
  const swap = await prisma.crossChainSwap.findUnique({ where: { id: swapId } });
  if (!swap) return null;
  return {
    id: swap.id,
    status: swap.status as 'pending' | 'completed' | 'failed',
    fromTxHash: swap.fromTxHash,
    bridgeTxHash: swap.bridgeTxHash,
    toTxHash: swap.toTxHash,
    amountOut: swap.amountOut,
    completedAt: swap.completedAt?.toISOString() ?? null,
    createdAt: swap.createdAt.toISOString(),
  };
}

export function formatRoutePath(route: SwapRoute): string {
  return route.hops.map((h) => `${h.protocol} (${h.chain})`).join(' → ');
}

export function getChainInfo(id: ChainId): ChainInfo {
  return SUPPORTED_CHAINS.find((c) => c.id === id) ?? SUPPORTED_CHAINS[0];
}

export function isCrossChain(from: ChainId, to: ChainId): boolean {
  return from !== to;
}

export function getActiveNetworkLabel(): NetworkName {
  return getNetworkConfig().network;
}
