#!/bin/bash
set -e

echo "Building Review Credential Circuit..."

mkdir -p public/wasm

# Compile circuit
circom circuits/review_credential.circom --r1cs --wasm -o public/wasm

# Move WASM to the right place and rename it to zk_review.wasm
mv public/wasm/review_credential_js/review_credential.wasm public/wasm/zk_review.wasm

# Download powers of tau (dummy setup for testing, using generic one for Groth16)
# We will use snarkjs powersoftau to create a local one to ensure it runs without external deps.
echo "Generating dummy Powers of Tau..."
npx snarkjs powersoftau new bn128 12 public/wasm/pot12_0000.ptau -v
npx snarkjs powersoftau contribute public/wasm/pot12_0000.ptau public/wasm/pot12_0001.ptau --name="First contribution" -v -e="random text"
npx snarkjs powersoftau prepare phase2 public/wasm/pot12_0001.ptau public/wasm/pot12_final.ptau -v

# Setup
echo "Running Groth16 Setup..."
npx snarkjs groth16 setup public/wasm/review_credential.r1cs public/wasm/pot12_final.ptau public/wasm/circuit_0000.zkey
npx snarkjs zkey contribute public/wasm/circuit_0000.zkey public/wasm/circuit_final.zkey --name="Second contribution" -v -e="random text"
npx snarkjs zkey export verificationkey public/wasm/circuit_final.zkey public/wasm/vkey.json

# Cleanup intermediates to save space
rm -rf public/wasm/review_credential_js
rm public/wasm/pot12_0000.ptau public/wasm/pot12_0001.ptau public/wasm/pot12_final.ptau
rm public/wasm/circuit_0000.zkey public/wasm/review_credential.r1cs

echo "Done! Artifacts are in public/wasm/"
