#!/usr/bin/env bash
# ── ZK Circuit Compilation ────────────────────────────────────────────────────
# Compiles circuits/review_credential.circom → WASM + proving key.
#
# Prerequisites:
#   npm install -g circom    # or build from https://github.com/iden3/circom
#   pnpm install             # installs snarkjs
#
# Usage:
#   bash scripts/compile-zk.sh
#
# Output (placed in public/wasm/):
#   zk_review.wasm       — Proving circuit WASM (loaded by snarkjs in browser)
#   zk_review.zkey       — Proving key (downloaded at prove time by snarkjs)
#   vkey.json            — Verification key (embedded in client for local verify)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits"
BUILD_DIR="$ROOT/public/wasm"

CIRCUIT="review_credential"
PTAU="$ROOT/circuits/pot16_final.ptau"

echo "==> Compiling $CIRCUIT.circom …"
circom "$CIRCUIT_DIR/$CIRCUIT.circom" \
  --r1cs --wasm --sym \
  --output "$BUILD_DIR"

echo "==> Setting up Groth16 (Powers of Tau ceremony) …"
if [ ! -f "$PTAU" ]; then
  echo "    Downloading Powers of Tau phase-1 (pot16) …"
  curl -fsSL https://hermez.s3.amazonaws.com/powersOfTau28_hez_final_16.ptau \
    -o "$PTAU"
fi

echo "==> Phase 2: circuit-specific setup …"
npx snarkjs groth16 setup \
  "$BUILD_DIR/$CIRCUIT.r1cs" \
  "$PTAU" \
  "$BUILD_DIR/$CIRCUIT.zkey"

echo "==> Exporting verification key …"
npx snarkjs zkey export verificationkey \
  "$BUILD_DIR/$CIRCUIT.zkey" \
  "$BUILD_DIR/vkey.json"

echo "==> Renaming WASM for runtime loading …"
mv "$BUILD_DIR/${CIRCUIT}_js/$CIRCUIT.wasm" "$BUILD_DIR/zk_review.wasm"

echo "==> Cleaning up intermediate artifacts …"
rm -rf "$BUILD_DIR/${CIRCUIT}_js"
rm -f "$BUILD_DIR/$CIRCUIT.r1cs"
rm -f "$BUILD_DIR/$CIRCUIT.sym"

echo "==> Done!"
echo "    ├── public/wasm/zk_review.wasm"
echo "    ├── public/wasm/zk_review.zkey"
echo "    └── public/wasm/vkey.json"
