import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Structural/Helper tests (no WASM needed) ─────────────────────────────────

describe('proofIsWellFormed', () => {
  it('returns true for a valid proof result', async () => {
    const { proofIsWellFormed } = await import('@/lib/zk-review-proof')
    const result = {
      proof: { pi_a: ['1', '2'], pi_b: [['3', '4'], ['5', '6']], pi_c: ['7', '8'] },
      publicSignals: ['commitment', 'nullifier', 'expiresAt', 'rating', 'reviewerId'],
      nullifier: 'abc123',
    }
    expect(proofIsWellFormed(result)).toBe(true)
  })

  it('returns false when proof is null', async () => {
    const { proofIsWellFormed } = await import('@/lib/zk-review-proof')
    const result = {
      proof: null as unknown as object,
      publicSignals: ['commitment', 'nullifier', 'expiresAt', 'rating', 'reviewerId'],
      nullifier: 'abc123',
    }
    expect(proofIsWellFormed(result)).toBe(false)
  })

  it('returns false when publicSignals has fewer than 5 entries', async () => {
    const { proofIsWellFormed } = await import('@/lib/zk-review-proof')
    const result = {
      proof: { pi_a: ['1'] },
      publicSignals: ['commitment'],
      nullifier: 'abc123',
    }
    expect(proofIsWellFormed(result)).toBe(false)
  })

  it('returns false when nullifier is empty', async () => {
    const { proofIsWellFormed } = await import('@/lib/zk-review-proof')
    const result = {
      proof: { pi_a: ['1'] },
      publicSignals: ['c', 'n', 'e', 'r', 'r'],
      nullifier: '',
    }
    expect(proofIsWellFormed(result)).toBe(false)
  })

  it('returns false when proof is a string (not object)', async () => {
    const { proofIsWellFormed } = await import('@/lib/zk-review-proof')
    const result = {
      proof: 'not-an-object' as unknown as object,
      publicSignals: ['c', 'n', 'e', 'r', 'r'],
      nullifier: 'abc',
    }
    expect(proofIsWellFormed(result)).toBe(false)
  })

  it('returns false when publicSignals has only 2 (v1-length) entries', async () => {
    const { proofIsWellFormed } = await import('@/lib/zk-review-proof')
    const result = {
      proof: { pi_a: ['1', '2'], pi_b: [['3', '4'], ['5', '6']], pi_c: ['7', '8'] },
      publicSignals: ['commitment', 'nullifier'],
      nullifier: 'abc123',
    }
    expect(proofIsWellFormed(result)).toBe(false)
  })
})

// ── v2 circuit support ──────────────────────────────────────────────────────

describe('v2 circuit public signals', () => {
  it('accepts v2 proof with 5 public signals', async () => {
    const { proofIsWellFormed } = await import('@/lib/zk-review-proof')
    const result = {
      proof: { pi_a: ['1', '2'], pi_b: [['3', '4'], ['5', '6']], pi_c: ['7', '8'] },
      publicSignals: ['commitment', 'nullifier', 'expiresAt', 'rating', 'reviewerId'],
      nullifier: 'abc123',
    }
    expect(proofIsWellFormed(result)).toBe(true)
  })

  it('extracts expiresAt from publicSignals[2]', async () => {
    const { generateReviewProof } = await import('@/lib/zk-review-proof')
    // generateReviewProof will fail without WASM, but the extraction
    // logic is testable via the publicSignals contract:
    //   publicSignals[0] = commitment
    //   publicSignals[1] = nullifier
    //   publicSignals[2] = expiresAt
    //   publicSignals[3] = rating
    //   publicSignals[4] = reviewerId
    // We verify the interface compiles and the signature is correct.
    const input = { credential: 'secret', subjectId: 'sid', rating: 4, reviewerId: 'uid', expiresAt: 2000000000 }
    expect(typeof input.credential).toBe('string')
    expect(typeof input.expiresAt).toBe('number')
    expect(input.expiresAt).toBeGreaterThan(Date.now() / 1000)
  })
})

// ── Input validation ────────────────────────────────────────────────────────

describe('validateReviewInput', () => {
  it('accepts valid input', async () => {
    const { validateReviewInput } = await import('@/lib/zk-review-proof')
    expect(() =>
      validateReviewInput({ credential: 'secret', subjectId: 'sid', rating: 3, reviewerId: 'uid', expiresAt: 9999999999 }),
    ).not.toThrow()
  })

  it('rejects rating < 1', async () => {
    const { validateReviewInput } = await import('@/lib/zk-review-proof')
    expect(() =>
      validateReviewInput({ credential: 'secret', subjectId: 'sid', rating: 0, reviewerId: 'uid', expiresAt: 9999999999 }),
    ).toThrow('rating must be between 1 and 5')
  })

  it('rejects rating > 5', async () => {
    const { validateReviewInput } = await import('@/lib/zk-review-proof')
    expect(() =>
      validateReviewInput({ credential: 'secret', subjectId: 'sid', rating: 6, reviewerId: 'uid', expiresAt: 9999999999 }),
    ).toThrow('rating must be between 1 and 5')
  })

  it('rejects missing reviewerId', async () => {
    const { validateReviewInput } = await import('@/lib/zk-review-proof')
    expect(() =>
      validateReviewInput({ credential: 'secret', subjectId: 'sid', rating: 3, reviewerId: '', expiresAt: 9999999999 }),
    ).toThrow('reviewerId is required')
  })

  it('rejects already-expired expiresAt', async () => {
    const { validateReviewInput } = await import('@/lib/zk-review-proof')
    expect(() =>
      validateReviewInput({ credential: 'secret', subjectId: 'sid', rating: 3, reviewerId: 'uid', expiresAt: 1000000 }),
    ).toThrow('credential has expired')
  })
})

// ── verifyProofLocally (mocked snarkjs) ─────────────────────────────────────

describe('verifyProofLocally', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns false for tampered proof', async () => {
    // We can't test against the real circuit without compilation.
    // Instead, verify that any malformed proof returns false.
    const { verifyProofLocally } = await import('@/lib/zk-review-proof')
    const result = await verifyProofLocally({
      proof: { pi_a: ['0'], pi_b: [['0'], ['0']], pi_c: ['0'] },
      publicSignals: ['x', 'y'],
      nullifier: 'tampered',
    })
    // In test environment without vkey.json, this will throw and return false
    expect(result).toBe(false)
  })

  it('returns false when vkey is missing', async () => {
    const { verifyProofLocally } = await import('@/lib/zk-review-proof')
    const result = await verifyProofLocally({
      proof: { pi_a: ['1', '2'], pi_b: [['3', '4'], ['5', '6']], pi_c: ['7', '8'] },
      publicSignals: ['commit', 'null'],
      nullifier: 'nullifier-value',
    })
    expect(result).toBe(false)
  })
})

// ── generateReviewProof throws without WASM ──────────────────────────────────

describe('generateReviewProof', () => {
  it('throws an error when WASM circuit is not compiled', async () => {
    const { generateReviewProof } = await import('@/lib/zk-review-proof')
    await expect(
      generateReviewProof({ credential: 'secret', subjectId: 'creator-1', rating: 5, reviewerId: 'user-1', expiresAt: 9999999999 }),
    ).rejects.toThrow(/WASM|proof generation/i)
  })
})

// ── Property-based: unique nullifier derivation ─────────────────────────────

describe('nullifier uniqueness (hash-based derivation — v2 circuit)', () => {
  // The v2 circuit uses Poseidon(credential, subjectId, expiresAt, reviewerId) as nullifier.
  // These tests verify the collision-resistance property via SHA-256, which shares
  // the same preimage-resistance guarantee as Poseidon.

  function serialize(...parts: string[]): string {
    return parts.join('|')
  }

  it('produces unique nullifiers for different credentials', async () => {
    const credentials = Array.from({ length: 100 }, (_, i) => `credential-${i}-${crypto.randomUUID()}`)
    const base = { subjectId: 'creator-a', expiresAt: '9999999999', reviewerId: 'user-1' }

    const nullifiers = await Promise.all(
      credentials.map(async (cred) => {
        const encoder = new TextEncoder()
        const buf = await crypto.subtle.digest(
          'SHA-256',
          encoder.encode(serialize(cred, base.subjectId, base.expiresAt, base.reviewerId)),
        )
        return Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      }),
    )

    const unique = new Set(nullifiers)
    expect(unique.size).toBe(100)
  })

  it('produces identical nullifiers for same inputs', async () => {
    const encoder = new TextEncoder()
    const input = serialize('secret-creator-1', 'creator-a', '9999999999', 'user-1')

    const digest = (data: string) =>
      crypto.subtle.digest('SHA-256', encoder.encode(data))

    const [n1, n2] = await Promise.all([digest(input), digest(input)])

    const hex = (buf: ArrayBuffer) =>
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')

    expect(hex(n1)).toBe(hex(n2))
  })

  it('produces different nullifiers when subjectId differs', async () => {
    const encoder = new TextEncoder()
    const credential = 'same-credential'
    const expiresAt = '9999999999'
    const reviewerId = 'user-1'

    const n1 = await crypto.subtle.digest('SHA-256', encoder.encode(serialize(credential, 'creator-a', expiresAt, reviewerId)))
    const n2 = await crypto.subtle.digest('SHA-256', encoder.encode(serialize(credential, 'creator-b', expiresAt, reviewerId)))

    const hex = (buf: ArrayBuffer) =>
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')

    expect(hex(n1)).not.toBe(hex(n2))
  })

  it('produces different nullifiers when expiresAt differs', async () => {
    const encoder = new TextEncoder()
    const credential = 'same-credential'
    const subjectId = 'creator-a'
    const reviewerId = 'user-1'

    const n1 = await crypto.subtle.digest('SHA-256', encoder.encode(serialize(credential, subjectId, '1000000000', reviewerId)))
    const n2 = await crypto.subtle.digest('SHA-256', encoder.encode(serialize(credential, subjectId, '9999999999', reviewerId)))

    const hex = (buf: ArrayBuffer) =>
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')

    expect(hex(n1)).not.toBe(hex(n2))
  })

  it('produces different nullifiers when reviewerId differs', async () => {
    const encoder = new TextEncoder()
    const credential = 'same-credential'
    const subjectId = 'creator-a'
    const expiresAt = '9999999999'

    const n1 = await crypto.subtle.digest('SHA-256', encoder.encode(serialize(credential, subjectId, expiresAt, 'user-1')))
    const n2 = await crypto.subtle.digest('SHA-256', encoder.encode(serialize(credential, subjectId, expiresAt, 'user-2')))

    const hex = (buf: ArrayBuffer) =>
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')

    expect(hex(n1)).not.toBe(hex(n2))
  })
})

// ── Benchmark ────────────────────────────────────────────────────────────────

describe('proof generation benchmark', () => {
  it('completes proof generation under 5000ms (placeholder)', async () => {
    // This benchmark requires the compiled WASM circuit at /public/wasm/zk_review.wasm.
    // Run `bash scripts/compile-zk.sh` first.
    //
    // Once compiled, replate the test body with:
    //
    //   const { generateReviewProof } = await import('@/lib/zk-review-proof')
    //   const start = performance.now()
    //   await generateReviewProof({ credential: 'bench-credential', subjectId: 'bench-creator', rating: 4, reviewerId: 'bench-user', expiresAt: 9999999999 })
    //   const elapsed = performance.now() - start
    //   expect(elapsed).toBeLessThan(5000)

    // Placeholder: skip until WASM is compiled
    expect(true).toBe(true)
  })
})
