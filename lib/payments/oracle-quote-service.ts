import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const ORACLE_MAX_AGE_SECONDS = 300
export const ORACLE_QUOTE_TTL_SECONDS = 60
const STROOPS_PER_XLM = 10_000_000n

export type OracleQuoteErrorCode =
  | 'ORACLE_UNAVAILABLE'
  | 'ORACLE_STALE'
  | 'ORACLE_NO_SOURCES'
  | 'ORACLE_INVALID'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_TAMPERED'
  | 'QUOTE_MISMATCH'
  | 'UNDERPAYMENT'

export class OracleQuoteError extends Error {
  constructor(
    public readonly code: OracleQuoteErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OracleQuoteError'
  }
}

export interface ContractValuation {
  usdAmountMicro: string
  tokenAmountStroops: string
  priceMicroUsd: string
  timestamp: number
  sources: number
  expiresAt?: number
}

export interface LockedOracleQuote {
  version: 1
  quoteId: string
  bountyId: string
  assetContract: string
  usdAmountMicro: string
  priceMicroUsd: string
  minXlmOutStroops: string
  sources: number
  issuedAt: number
  expiresAt: number
  signature: string
}

function parsePositiveInteger(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new OracleQuoteError('ORACLE_INVALID', `${field} must be an integer`)
  }
  const parsed = BigInt(value)
  if (parsed <= 0n) {
    throw new OracleQuoteError('ORACLE_INVALID', `${field} must be positive`)
  }
  return parsed
}

export function deriveMinimumXlmOutStroops(
  usdAmountMicro: string,
  priceMicroUsd: string,
): string {
  const usd = parsePositiveInteger(usdAmountMicro, 'usdAmountMicro')
  const price = parsePositiveInteger(priceMicroUsd, 'priceMicroUsd')
  return ((usd * STROOPS_PER_XLM + price - 1n) / price).toString()
}

function unsignedPayload(quote: Omit<LockedOracleQuote, 'signature'>): string {
  return [
    quote.version,
    quote.quoteId,
    quote.bountyId,
    quote.assetContract,
    quote.usdAmountMicro,
    quote.priceMicroUsd,
    quote.minXlmOutStroops,
    quote.sources,
    quote.issuedAt,
    quote.expiresAt,
  ].join('|')
}

function sign(
  quote: Omit<LockedOracleQuote, 'signature'>,
  secret: string,
): string {
  return createHmac('sha256', secret).update(unsignedPayload(quote)).digest('hex')
}

function signaturesMatch(expected: string, received: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(received)) return false
  const left = Buffer.from(expected, 'hex')
  const right = Buffer.from(received, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

export function createLockedOracleQuote(params: {
  bountyId: string
  assetContract: string
  valuation: ContractValuation
  secret: string
  nowSeconds?: number
  quoteId?: string
}): LockedOracleQuote {
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000)
  const { valuation } = params
  if (valuation.sources <= 0) {
    throw new OracleQuoteError(
      'ORACLE_NO_SOURCES',
      'Live oracle consensus is unavailable',
    )
  }
  if (
    !Number.isSafeInteger(valuation.timestamp) ||
    valuation.timestamp > now ||
    now - valuation.timestamp > ORACLE_MAX_AGE_SECONDS
  ) {
    throw new OracleQuoteError('ORACLE_STALE', 'Oracle valuation is stale')
  }
  if (!params.secret || params.secret.length < 32) {
    throw new OracleQuoteError(
      'ORACLE_INVALID',
      'Oracle quote signing secret is not configured securely',
    )
  }
  if (!params.bountyId || !params.assetContract) {
    throw new OracleQuoteError('ORACLE_INVALID', 'Quote scope is incomplete')
  }

  const derivedMinimum = deriveMinimumXlmOutStroops(
    valuation.usdAmountMicro,
    valuation.priceMicroUsd,
  )
  if (valuation.tokenAmountStroops !== derivedMinimum) {
    throw new OracleQuoteError(
      'UNDERPAYMENT',
      'Contract valuation does not match the fail-safe minimum',
    )
  }

  const feedExpiry = valuation.timestamp + ORACLE_MAX_AGE_SECONDS
  const contractExpiry = valuation.expiresAt ?? Number.MAX_SAFE_INTEGER
  const expiresAt = Math.min(
    now + ORACLE_QUOTE_TTL_SECONDS,
    feedExpiry,
    contractExpiry,
  )
  if (expiresAt <= now) {
    throw new OracleQuoteError('ORACLE_STALE', 'Oracle valuation has expired')
  }

  const unsigned: Omit<LockedOracleQuote, 'signature'> = {
    version: 1,
    quoteId: params.quoteId ?? randomUUID(),
    bountyId: params.bountyId,
    assetContract: params.assetContract,
    usdAmountMicro: valuation.usdAmountMicro,
    priceMicroUsd: valuation.priceMicroUsd,
    minXlmOutStroops: derivedMinimum,
    sources: valuation.sources,
    issuedAt: now,
    expiresAt,
  }
  return { ...unsigned, signature: sign(unsigned, params.secret) }
}

export function verifyLockedOracleQuote(params: {
  quote: LockedOracleQuote
  secret: string
  expectedBountyId: string
  expectedUsdAmountMicro: string
  clientMinXlmOutStroops?: string
  nowSeconds?: number
}): string {
  const { quote } = params
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000)
  const { signature: _signature, ...unsigned } = quote
  if (!signaturesMatch(sign(unsigned, params.secret), quote.signature)) {
    throw new OracleQuoteError('QUOTE_TAMPERED', 'Oracle quote signature is invalid')
  }
  if (quote.version !== 1 || quote.sources <= 0) {
    throw new OracleQuoteError('ORACLE_NO_SOURCES', 'Quote has no live sources')
  }
  if (quote.expiresAt <= now || quote.issuedAt > now) {
    throw new OracleQuoteError('QUOTE_EXPIRED', 'Oracle quote has expired')
  }
  if (
    quote.bountyId !== params.expectedBountyId ||
    quote.usdAmountMicro !== params.expectedUsdAmountMicro
  ) {
    throw new OracleQuoteError('QUOTE_MISMATCH', 'Quote does not match this bounty')
  }

  const derivedMinimum = deriveMinimumXlmOutStroops(
    quote.usdAmountMicro,
    quote.priceMicroUsd,
  )
  if (quote.minXlmOutStroops !== derivedMinimum) {
    throw new OracleQuoteError('QUOTE_TAMPERED', 'Quoted minimum was modified')
  }
  if (
    params.clientMinXlmOutStroops !== undefined &&
    parsePositiveInteger(params.clientMinXlmOutStroops, 'clientMinXlmOutStroops') <
      BigInt(derivedMinimum)
  ) {
    throw new OracleQuoteError(
      'UNDERPAYMENT',
      'Client minimum is looser than the server-locked valuation',
    )
  }
  return derivedMinimum
}

/** Fetch `lock_price`/`value_in_tokens` output from the trusted contract adapter. */
export async function fetchContractValuation(
  usdAmountMicro: string,
): Promise<ContractValuation> {
  const url = process.env.ORACLE_VALUATION_URL
  if (!url) {
    throw new OracleQuoteError(
      'ORACLE_UNAVAILABLE',
      'Oracle contract valuation endpoint is not configured',
    )
  }
  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...(process.env.ORACLE_VALUATION_TOKEN
        ? { authorization: `Bearer ${process.env.ORACLE_VALUATION_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ method: 'lock_price', usdAmountMicro }),
  })
  if (!response.ok) {
    throw new OracleQuoteError(
      'ORACLE_UNAVAILABLE',
      `Oracle valuation failed with status ${response.status}`,
    )
  }
  const body = (await response.json()) as
    | ContractValuation
    | { data: ContractValuation }
  return 'data' in body ? body.data : body
}

export function getOracleQuoteSecret(): string {
  const secret = process.env.ORACLE_QUOTE_SIGNING_SECRET
  if (!secret || secret.length < 32) {
    throw new OracleQuoteError(
      'ORACLE_INVALID',
      'ORACLE_QUOTE_SIGNING_SECRET must contain at least 32 characters',
    )
  }
  return secret
}
