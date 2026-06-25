pragma circom 2.1.0;

include "circomlib/poseidon.circom";

// ── Review Credential Circuit ────────────────────────────────────────────────
//
// Proves knowledge of a private credential whose hash matches a public
// commitment, without revealing the credential itself.
//
// Public signals:
//   commitment  — Poseidon(credential), committed before proof generation
//   nullifier   — Poseidon(credential, subjectId), prevents double reviews
//
// Private signals:
//   credential  — known only to the prover, never transmitted
//
// The verifier checks that commitment equals the previously registered
// value for this user, and that nullifier has not been used before for
// the same subjectId.

template ReviewCredential() {

    // ── Public inputs ──────────────────────────────────────────────────────
    signal input subjectId;

    // ── Private inputs ─────────────────────────────────────────────────────
    signal private input credential;

    // ── Public outputs ─────────────────────────────────────────────────────
    signal output commitment;
    signal output nullifier;

    // ── Constraints ────────────────────────────────────────────────────────

    // commitment = Poseidon(credential)
    component commitmentHash = Poseidon(1);
    commitmentHash.inputs[0] <== credential;
    commitment <== commitmentHash.out;

    // nullifier = Poseidon(credential, subjectId)
    component nullifierHash = Poseidon(2);
    nullifierHash.inputs[0] <== credential;
    nullifierHash.inputs[1] <== subjectId;
    nullifier <== nullifierHash.out;
}

component main = ReviewCredential();
