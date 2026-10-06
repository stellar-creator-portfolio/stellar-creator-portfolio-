#!/usr/bin/env bash
# scripts/build-reproducible.sh
#
# Builds all Soroban contracts inside the pinned Docker environment and copies
# the WASM artifacts + their SHA-256 hashes to ./artifacts/.
#
# Usage:
#   ./scripts/build-reproducible.sh
#
# Output:
#   artifacts/{bounty,escrow,freelancer,governance}.wasm
#   artifacts/hashes.sha256

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACTS_DIR="$REPO_ROOT/artifacts"
IMAGE_TAG="stellar-contracts-builder:local"

echo "🔨 Building reproducible contracts…"

# Build the Docker image (layer-cached on subsequent runs).
docker build \
  --file "$REPO_ROOT/Dockerfile" \
  --tag  "$IMAGE_TAG" \
  --target builder \
  "$REPO_ROOT"

# Extract WASM artifacts from the image without running a container.
mkdir -p "$ARTIFACTS_DIR"

for CONTRACT in bounty escrow freelancer governance; do
  docker run --rm --entrypoint cat "$IMAGE_TAG" \
    "/build/target/wasm32-unknown-unknown/release/${CONTRACT}.wasm" \
    > "$ARTIFACTS_DIR/${CONTRACT}.wasm"
  echo "  ✅ Extracted ${CONTRACT}.wasm"
done

# Write canonical hash file.
(cd "$ARTIFACTS_DIR" && sha256sum bounty.wasm escrow.wasm freelancer.wasm governance.wasm) \
  > "$ARTIFACTS_DIR/hashes.sha256"

echo ""
echo "📋 SHA-256 hashes:"
cat "$ARTIFACTS_DIR/hashes.sha256"
echo ""
echo "Artifacts written to: $ARTIFACTS_DIR"
