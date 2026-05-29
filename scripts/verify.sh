#!/usr/bin/env bash
# scripts/verify.sh
#
# Rebuilds contracts from source and verifies the resulting WASM hashes match
# a committed baseline (artifacts/hashes.sha256).
#
# Usage:
#   ./scripts/verify.sh                  # verify against committed baseline
#   ./scripts/verify.sh --update-baseline  # rebuild baseline and commit it
#
# Exit codes:
#   0  All hashes match (or baseline updated).
#   1  One or more hashes differ — build is not reproducible.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACTS_DIR="$REPO_ROOT/artifacts"
BASELINE="$ARTIFACTS_DIR/hashes.sha256"
UPDATE_BASELINE="${1:-}"

# Always rebuild from scratch inside Docker.
"$REPO_ROOT/scripts/build-reproducible.sh"

if [[ "$UPDATE_BASELINE" == "--update-baseline" ]]; then
  echo "✅ Baseline updated: $BASELINE"
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "❌ No baseline found at $BASELINE."
  echo "   Run with --update-baseline to create one."
  exit 1
fi

echo ""
echo "🔍 Verifying hashes against baseline…"

FAIL=0
while IFS= read -r line; do
  EXPECTED_HASH="${line%% *}"
  FILENAME="${line##* }"
  ACTUAL_HASH="$(sha256sum "$ARTIFACTS_DIR/$FILENAME" | awk '{print $1}')"

  if [[ "$ACTUAL_HASH" == "$EXPECTED_HASH" ]]; then
    echo "  ✅ $FILENAME"
  else
    echo "  ❌ $FILENAME"
    echo "     expected: $EXPECTED_HASH"
    echo "     actual:   $ACTUAL_HASH"
    FAIL=1
  fi
done < "$BASELINE"

if [[ "$FAIL" -eq 1 ]]; then
  echo ""
  echo "❌ Hash mismatch — build is NOT reproducible."
  exit 1
fi

echo ""
echo "✅ All contract hashes verified. Build is reproducible."
