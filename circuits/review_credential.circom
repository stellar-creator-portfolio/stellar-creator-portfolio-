pragma circom 2.1.5;

include "../node_modules/circomlib/circuits/poseidon.circom";

template ReviewCredential() {
    signal input credential; // private
    signal input subjectId;  // public
    signal input rating;     // public
    
    signal output credentialHash;
    signal output nullifier;

    // Hash the credential
    component poseidonCred = Poseidon(1);
    poseidonCred.inputs[0] <== credential;
    credentialHash <== poseidonCred.out;

    // Hash the credential and subjectId to create the nullifier
    component poseidonNullifier = Poseidon(2);
    poseidonNullifier.inputs[0] <== credential;
    poseidonNullifier.inputs[1] <== subjectId;
    nullifier <== poseidonNullifier.out;

    // Bind rating to the proof so it can't be tampered with
    signal ratingSquare <== rating * rating;
}

component main { public [subjectId, rating] } = ReviewCredential();
