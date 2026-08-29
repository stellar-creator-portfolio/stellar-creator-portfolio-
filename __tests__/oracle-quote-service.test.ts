import { describe, expect, it } from 'vitest'

import {
  createLockedOracleQuote,
  deriveMinimumXlmOutStroops,
  OracleQuoteError,
  verifyLockedOracleQuote,
} from '@/lib/payments/oracle-quote-service'

const SECRET = 'a'.repeat(64)
const NOW = 2_000
const BASE_VALUATION = {
  usdAmountMicro: '1000000',
  tokenAmountStroops: '83333334',
  priceMicroUsd: '120000',
  timestamp: NOW,
  sources: 3,
  expiresAt: NOW + 60,
}

function quote() {
  return createLockedOracleQuote({
    bountyId: 'bounty-100',
    assetContract: 'C_XLM_ASSET',
    valuation: BASE_VALUATION,
    secret: SECRET,
    nowSeconds: NOW,
    quoteId: '550e8400-e29b-41d4-a716-446655440000',
  })
}

describe('fail-closed oracle quotes', () => {
  it('rounds the minimum upward so a deposit cannot underpay', () => {
    expect(deriveMinimumXlmOutStroops('1000000', '300000')).toBe('33333334')
  })

  it('rejects zero-source production valuations', () => {
    expect(() =>
      createLockedOracleQuote({
        bountyId: 'bounty-100',
        assetContract: 'C_XLM_ASSET',
        valuation: { ...BASE_VALUATION, sources: 0 },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toThrowError(expect.objectContaining({ code: 'ORACLE_NO_SOURCES' }))
  })

  it('rejects stale feeds instead of using a fallback price', () => {
    expect(() =>
      createLockedOracleQuote({
        bountyId: 'bounty-100',
        assetContract: 'C_XLM_ASSET',
        valuation: { ...BASE_VALUATION, timestamp: NOW - 301 },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toThrowError(expect.objectContaining({ code: 'ORACLE_STALE' }))
  })

  it('rejects a contract adapter response that would underpay', () => {
    expect(() =>
      createLockedOracleQuote({
        bountyId: 'bounty-100',
        assetContract: 'C_XLM_ASSET',
        valuation: { ...BASE_VALUATION, tokenAmountStroops: '83333333' },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toThrowError(expect.objectContaining({ code: 'UNDERPAYMENT' }))
  })

  it('detects tampering with the signed minimum', () => {
    const tampered = { ...quote(), minXlmOutStroops: '1' }
    expect(() =>
      verifyLockedOracleQuote({
        quote: tampered,
        secret: SECRET,
        expectedBountyId: 'bounty-100',
        expectedUsdAmountMicro: '1000000',
        nowSeconds: NOW + 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'QUOTE_TAMPERED' }))
  })

  it('rejects client slippage looser than the locked server minimum', () => {
    expect(() =>
      verifyLockedOracleQuote({
        quote: quote(),
        secret: SECRET,
        expectedBountyId: 'bounty-100',
        expectedUsdAmountMicro: '1000000',
        clientMinXlmOutStroops: '83333333',
        nowSeconds: NOW + 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'UNDERPAYMENT' }))
  })

  it('rejects an otherwise valid quote after its TTL', () => {
    const locked = quote()
    expect(() =>
      verifyLockedOracleQuote({
        quote: locked,
        secret: SECRET,
        expectedBountyId: 'bounty-100',
        expectedUsdAmountMicro: '1000000',
        nowSeconds: locked.expiresAt,
      }),
    ).toThrowError(OracleQuoteError)
  })
})
