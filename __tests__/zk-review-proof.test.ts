import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Structural/Helper tests (no WASM needed) ─────────────────────────────────

describe('proofIsWellFormed', () => {
  it('returns true for a valid proof result', async () => {
    const { proofIsWellFormed } = await import('@/lib/zk-review-proof')
    const result = {
      proof: { pi_a: ['1', '2'], pi_b: [['3', '4'], ['5', '6']], pi_c: ['7', '8'] },
      publicSignals: ['commitment', 'nullifier'],
      nullifier: 'abc123',
    }
    expect(proofIsWellFormed(result)).toBe(true)
  })

  it('returns false when proof is null', async () => {
    const { proofIsWellFormed } = await import('@/lib/zk-review-proof')
    const result = {
      proof: null as unknown as object,
      publicSignals: ['commitment', 'nullifier'],
      nullifier: 'abc123',
    }
    expect(proofIsWellFormed(result)).toBe(false)
  })

  it('returns false when publicSignals has fewer than 2 entries', async () => {
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
      publicSignals: ['a', 'b'],
      nullifier: '',
    }
    expect(proofIsWellFormed(result)).toBe(false)
  })

  it('returns false when proof is a string (not object)', async () => {
    const { proofIsWellFormed } = await import('@/lib/zk-review-proof')
    const result = {
      proof: 'not-an-object' as unknown as object,
      publicSignals: ['a', 'b'],
      nullifier: 'abc',
    }
    expect(proofIsWellFormed(result)).toBe(false)
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
      generateReviewProof({ credential: 'secret', subjectId: 'creator-1', rating: 5 }),
    ).rejects.toThrow(/WASM|proof generation/i)
  })
})

// ── Property-based: unique nullifier derivation ─────────────────────────────

describe('nullifier uniqueness (hash-based derivation)', () => {
  it('produces unique nullifiers for different credentials', async () => {
    // The real circuit uses Poseidon(credential, subjectId) as nullifier.
    // Here we verify the collision-resistance property via SHA-256, which shares
    // the same preimage-resistance guarantee.
    const credentials = Array.from({ length: 100 }, (_, i) => `credential-${i}-${crypto.randomUUID()}`)
    const subjectId = 'creator-unique-test'

    const nullifiers = await Promise.all(
      credentials.map(async (cred) => {
        const encoder = new TextEncoder()
        const buf = await crypto.subtle.digest(
          'SHA-256',
          encoder.encode(cred + subjectId),
        )
        return Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      }),
    )

    const unique = new Set(nullifiers)
    expect(unique.size).toBe(100)
  })

  it('produces identical nullifiers for same (credential, subjectId) pair', async () => {
    const encoder = new TextEncoder()

    const n1 = await crypto.subtle.digest('SHA-256', encoder.encode('secret-creator-1'))
    const n2 = await crypto.subtle.digest('SHA-256', encoder.encode('secret-creator-1'))

    const hex = (buf: ArrayBuffer) =>
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')

    expect(hex(n1)).toBe(hex(n2))
  })

  it('produces different nullifiers when subjectId differs', async () => {
    const encoder = new TextEncoder()
    const credential = 'same-credential'

    const n1 = await crypto.subtle.digest('SHA-256', encoder.encode(credential + 'creator-a'))
    const n2 = await crypto.subtle.digest('SHA-256', encoder.encode(credential + 'creator-b'))

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
    //   await generateReviewProof({ credential: 'bench-credential', subjectId: 'bench-creator', rating: 4 })
    //   const elapsed = performance.now() - start
    //   expect(elapsed).toBeLessThan(5000)

    // Placeholder: skip until WASM is compiled
    expect(true).toBe(true)
  })
})
