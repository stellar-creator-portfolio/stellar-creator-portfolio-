pragma circom 2.1.0;

include "circomlib/poseidon.circom";
include "circomlib/comparators.circom";

template ReviewCredential() {

    signal input subjectId;
    signal input expiresAt;
    signal input rating;
    signal input reviewerId;
    signal input credential;

    signal output commitment;
    signal output nullifier;

    signal output expiresAtOut;
    signal output ratingOut;
    signal output reviewerIdOut;

    expiresAtOut <== expiresAt;
    ratingOut <== rating;
    reviewerIdOut <== reviewerId;

    component ratingGe1 = GreaterEqThan(8);
    ratingGe1.in[0] <== rating;
    ratingGe1.in[1] <== 1;
    ratingGe1.out === 1;

    component ratingLe5 = LessEqThan(8);
    ratingLe5.in[0] <== rating;
    ratingLe5.in[1] <== 5;
    ratingLe5.out === 1;

    component commitmentHash = Poseidon(1);
    commitmentHash.inputs[0] <== credential;
    commitment <== commitmentHash.out;

    component nullifierHash = Poseidon(4);
    nullifierHash.inputs[0] <== credential;
    nullifierHash.inputs[1] <== subjectId;
    nullifierHash.inputs[2] <== expiresAt;
    nullifierHash.inputs[3] <== reviewerId;
    nullifier <== nullifierHash.out;
}

component main = ReviewCredential();
