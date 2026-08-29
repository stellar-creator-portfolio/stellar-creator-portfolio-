import groth16 from 'snarkjs'

export type ProofStatus = 'idle' | 'loading_wasm' | 'proving' | 'verified' | 'failed'

export interface ZkProofResult {
  proof: object
  publicSignals: string[]
  nullifier: string
  expiresAt?: string
}

export interface ZkReviewInput {
  credential: string
  subjectId: string
  rating: number
  reviewerId: string
  expiresAt: number
}

interface VKey {
  protocol: string
  curve: string
  nPublic: number
  [key: string]: unknown
}

let vkey: VKey | null = null
let wasmUrl: string | null = null
let zkeyUrl: string | null = null

function setPaths() {
  if (wasmUrl) return
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  wasmUrl = `${base}/wasm/zk_review.wasm`
  zkeyUrl = `${base}/wasm/zk_review.zkey`
}

async function getVkey(): Promise<VKey> {
  if (vkey) return vkey
  setPaths()
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  const res = await fetch(`${base}/wasm/vkey.json`)
  if (!res.ok) {
    throw new Error(
      `Verification key not found at /wasm/vkey.json. ` +
      `Run \`bash scripts/compile-zk.sh\` to compile the circuit.`,
    )
  }
  vkey = (await res.json()) as VKey
  return vkey
}

export function validateReviewInput(input: ZkReviewInput): void {
  if (!input.credential) throw new Error('credential is required')
  if (!input.subjectId) throw new Error('subjectId is required')
  if (!input.reviewerId) throw new Error('reviewerId is required')
  if (input.rating < 1 || input.rating > 5) throw new Error('rating must be between 1 and 5')
  if (input.expiresAt < Math.floor(Date.now() / 1000)) throw new Error('credential has expired')
}

export async function generateReviewProof(
  input: ZkReviewInput,
  onStatusChange?: (status: ProofStatus) => void,
): Promise<ZkProofResult> {
  validateReviewInput(input)
  onStatusChange?.('loading_wasm')
  setPaths()

  const witness = {
    credential: input.credential,
    subjectId: input.subjectId,
    expiresAt: input.expiresAt.toString(),
    rating: input.rating.toString(),
    reviewerId: input.reviewerId,
  }

  onStatusChange?.('proving')

  let proof: object
  let publicSignals: string[]

  try {
    const result = await groth16.fullProve(witness, wasmUrl!, zkeyUrl!)
    proof = result.proof
    publicSignals = result.publicSignals
  } catch (err) {
    onStatusChange?.('failed')
    throw new Error(
      `Proof generation failed: ${err instanceof Error ? err.message : String(err)}. ` +
      `Ensure WASM circuit is compiled at ${wasmUrl}`,
    )
  }

  const nullifier = publicSignals[1]
  const expiresAt = publicSignals[2]

  onStatusChange?.('verified')

  return { proof, publicSignals, nullifier, expiresAt }
}

export async function verifyProofLocally(result: ZkProofResult): Promise<boolean> {
  try {
    const key = await getVkey()
    if (key.protocol !== 'groth16') {
      throw new Error(`Unsupported proof protocol: ${key.protocol}`)
    }

    const verified = await groth16.verify(key, result.publicSignals, result.proof)
    return verified
  } catch (err) {
    console.error('[ZK] verifyProofLocally failed:', err)
    return false
  }
}

/** Structural check before form submission — faster than a full verify. */
export function proofIsWellFormed(result: ZkProofResult): boolean {
  return (
    typeof result.proof === 'object' &&
    result.proof !== null &&
    Array.isArray(result.publicSignals) &&
    result.publicSignals.length >= 5 &&
    typeof result.nullifier === 'string' &&
    result.nullifier.length > 0
  )
}
