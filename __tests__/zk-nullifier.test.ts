import { describe, it, expect } from 'vitest';
import { buildPoseidon } from 'circomlibjs';

async function computeNullifier(credential: string, subjectId: string, poseidon: any): Promise<string> {
  const encoder = new TextEncoder();
  const credBytes = encoder.encode(credential);
  const subjBytes = encoder.encode(subjectId);
  
  const credHashBuf = await crypto.subtle.digest('SHA-256', credBytes);
  const subjHashBuf = await crypto.subtle.digest('SHA-256', subjBytes);
  
  const bufferToHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const credNum = BigInt('0x' + bufferToHex(credHashBuf)) % SNARK_FIELD;
  const subjNum = BigInt('0x' + bufferToHex(subjHashBuf)) % SNARK_FIELD;

  const nullifierField = poseidon([credNum, subjNum]);
  return BigInt(poseidon.F.toString(nullifierField)).toString(16).padStart(64, '0');
}

describe('ZK Proof Nullifier Uniqueness', () => {
  it('generates unique nullifiers for 100 random credentials against the same subject', async () => {
    const nullifiers = new Set<string>();
    const subjectId = 'creator-123';
    const poseidon = await buildPoseidon();
    
    for (let i = 0; i < 100; i++) {
      const randomCredential = `cred-${i}-${Math.random()}`;
      const nullifier = await computeNullifier(randomCredential, subjectId, poseidon);
      
      expect(nullifiers.has(nullifier)).toBe(false);
      nullifiers.add(nullifier);
    }
    
    expect(nullifiers.size).toBe(100);
  });
  
  it('generates the same nullifier for the same credential and subject', async () => {
    const poseidon = await buildPoseidon();
    const cred = 'my-secret-credential';
    const subj = 'creator-123';
    const n1 = await computeNullifier(cred, subj, poseidon);
    const n2 = await computeNullifier(cred, subj, poseidon);
    expect(n1).toEqual(n2);
  });
});
