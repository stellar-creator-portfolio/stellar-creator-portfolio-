/**
 * ZK Proof module for anonymous job reviews (#628).
 *
 * Uses a WASM-compiled proving circuit to generate a zero-knowledge proof
 * that the reviewer holds a valid credential (e.g. completed a bounty) without
 * revealing their wallet address.
 */

import * as snarkjs from 'snarkjs';

export type ProofStatus = 'idle' | 'loading_wasm' | 'proving' | 'verified' | 'failed';

export interface ZkProofResult {
  proof: any;       // json object from snarkjs
  publicSignals: string[]; // public inputs committed to the proof
  nullifier: string;   // prevents double-submission of the same review
}

export interface ZkReviewInput {
  /** Reviewer's private credential (e.g. bounty completion secret). Never leaves the browser. */
  credential: string;
  /** The bounty / creator being reviewed – becomes a public signal. */
  subjectId: string;
  /** Star rating 1-5 – becomes a public signal. */
  rating: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Proof generation
// ---------------------------------------------------------------------------

const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export async function generateReviewProof(
  input: ZkReviewInput,
  onStatusChange?: (status: ProofStatus) => void,
): Promise<ZkProofResult> {
  onStatusChange?.('loading_wasm');

  const encoder = new TextEncoder();
  const credBytes = encoder.encode(input.credential);
  const subjBytes = encoder.encode(input.subjectId);
  
  const credHashBuf = await crypto.subtle.digest('SHA-256', credBytes);
  const subjHashBuf = await crypto.subtle.digest('SHA-256', subjBytes);
  
  const credNum = BigInt('0x' + bufferToHex(credHashBuf)) % SNARK_FIELD;
  const subjNum = BigInt('0x' + bufferToHex(subjHashBuf)) % SNARK_FIELD;

  onStatusChange?.('proving');

  let proof, publicSignals;

  try {
    const result = await snarkjs.groth16.fullProve(
      {
        credential: credNum.toString(),
        subjectId: subjNum.toString(),
        rating: input.rating,
      },
      '/wasm/zk_review.wasm',
      '/wasm/circuit_final.zkey'
    );
    proof = result.proof;
    publicSignals = result.publicSignals;
  } catch (err) {
    console.error("ZK Proof generation failed:", err);
    onStatusChange?.('failed');
    throw new Error('Proof generation failed. Ensure you are in a valid environment.');
  }

  // The nullifier is output as publicSignals[1] by our circuit
  const nullifierField = publicSignals[1];
  // convert nullifier to 64-char hex string to match previous DB size
  const nullifier = BigInt(nullifierField).toString(16).padStart(64, '0');

  onStatusChange?.('verified');

  return { proof, publicSignals, nullifier };
}

export async function verifyProofLocally(result: ZkProofResult): Promise<boolean> {
  try {
    // In browser, this path is relative to the origin. In node, we might need absolute path.
    // For local verification inside the browser before submit, fetch is fine.
    const vkeyRes = await fetch('/wasm/vkey.json');
    if (!vkeyRes.ok) return false;
    const vkey = await vkeyRes.json();
    
    return await snarkjs.groth16.verify(vkey, result.publicSignals, result.proof);
  } catch (err) {
    console.error("verifyProofLocally failed:", err);
    return false;
  }
}
