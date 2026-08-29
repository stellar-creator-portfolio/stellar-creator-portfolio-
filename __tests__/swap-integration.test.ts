import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  getSwapQuote,
  executeSwap,
  getSwapStatus,
  QuoteExpiredError,
  IdempotentSwapError,
  type SwapQuote,
} from '@/lib/swap/cross-chain-sdk';

const TEST_SENDER = 'GBPLWXDOQAHNI5G5N3ST3QW7BFOJTBOK3C5RIBBWFL4N7THHSHQQOPHR';

async function getValidQuote(): Promise<SwapQuote> {
  return getSwapQuote('stellar', 'polygon', '1000', 50);
}

describe('cross-chain-sdk', () => {
  beforeEach(async () => {
    await prisma.crossChainSwap.deleteMany({});
  });

  describe('getSwapQuote', () => {
    it('returns a quote with validUntil set', async () => {
      const quote = await getValidQuote();
      expect(quote.validUntil).toBeGreaterThan(Date.now());
      expect(quote.validUntil).toBeLessThanOrEqual(Date.now() + 30_000);
    });

    it('enforces minimum 100 bps slippage for Ethereum routes', async () => {
      const quote = await getSwapQuote('stellar', 'ethereum', '1000', 30);
      expect(quote.slippageBps).toBeGreaterThanOrEqual(100);
    });

    it('uses provided slippage for non-Ethereum routes', async () => {
      const quote = await getSwapQuote('stellar', 'polygon', '1000', 50);
      expect(quote.slippageBps).toBe(50);
    });
  });

  describe('executeSwap', () => {
    it('returns a SwapReceipt with status pending for valid non-expired quote', async () => {
      const quote = await getValidQuote();
      const receipt = await executeSwap(quote, TEST_SENDER);
      expect(receipt.status).toBe('completed');
      expect(receipt.id).toBeTruthy();
      expect(receipt.fromTxHash).toBeTruthy();
    });

    it('rejects expired quotes with QuoteExpiredError', async () => {
      const quote = await getValidQuote();
      quote.validUntil = Date.now() - 1;
      await expect(executeSwap(quote, TEST_SENDER)).rejects.toThrow(QuoteExpiredError);
    });

    it('is idempotent within 5 minutes', async () => {
      const quote = await getValidQuote();
      const first = await executeSwap(quote, TEST_SENDER);
      expect(first.status).toBe('completed');

      await expect(executeSwap(quote, TEST_SENDER)).rejects.toThrow(IdempotentSwapError);
      try {
        await executeSwap(quote, TEST_SENDER);
      } catch (err) {
        expect(err).toBeInstanceOf(IdempotentSwapError);
        const idempotent = err as IdempotentSwapError;
        expect(idempotent.existingReceipt.id).toBe(first.id);
      }
    });
  });

  describe('getSwapStatus', () => {
    it('returns null for unknown swap', async () => {
      const result = await getSwapStatus('nonexistent');
      expect(result).toBeNull();
    });

    it('returns swap data for existing swap', async () => {
      const quote = await getValidQuote();
      const receipt = await executeSwap(quote, TEST_SENDER);
      const status = await getSwapStatus(receipt.id);
      expect(status).not.toBeNull();
      expect(status!.id).toBe(receipt.id);
      expect(status!.status).toBe('completed');
    });
  });

  describe('CrossChainSwap persistence', () => {
    it('stores all required fields after execution', async () => {
      const quote = await getValidQuote();
      const receipt = await executeSwap(quote, TEST_SENDER);
      const record = await prisma.crossChainSwap.findUnique({ where: { id: receipt.id } });
      expect(record).not.toBeNull();
      expect(record!.fromTxHash).toBeTruthy();
      expect(record!.bridgeTxHash).toBeTruthy();
      expect(record!.toTxHash).toBeTruthy();
      expect(record!.amountOut).toBeTruthy();
      expect(record!.status).toBe('completed');
      expect(record!.completedAt).toBeTruthy();
    });
  });
});
