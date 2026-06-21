.PHONY: help check-all check-backend check-contracts check-frontend lint-be test-be lint-fe \
        test-integration gen-test-keypair

help:
	@echo "Available commands:"
	@echo "  make check-all           - Run all project lints and tests"
	@echo "  make check-backend       - Run Clippy and tests for backend services"
	@echo "  make check-contracts     - Run tests for Soroban smart contracts"
	@echo "  make check-frontend      - Run linting and build for the Next.js frontend"
	@echo "  make lint-be             - Run cargo clippy on backend"
	@echo "  make test-be             - Run cargo tests on backend"
	@echo "  make lint-fe             - Run next lint on frontend"
	@echo "  make test-integration    - Run full on-chain bounty lifecycle integration tests"
	@echo "  make gen-test-keypair    - Generate a pre-funded Testnet keypair"

# ============================================================================
# Integration Tests — Bounty Lifecycle
# ============================================================================

# Generate a random Testnet keypair and fund it via Friendbot.
gen-test-keypair:
	@echo "Generating Testnet keypair..."
	@node -e "
		const { Keypair } = require('@stellar/stellar-sdk');
		const kp = Keypair.random();
		console.log('Public key:  ' + kp.publicKey());
		console.log('Secret key:  ' + kp.secret());
		console.log('');
		console.log('Export with:');
		console.log('  export STELLAR_TEST_KEYPAIR=' + kp.secret());
		console.log('');
		console.log('Then fund via:');
		console.log('  curl \"https://friendbot.stellar.org?addr=' + kp.publicKey() + '\"');
	"

# Build + run the full integration test suite.
# Prerequisites: STELLAR_TEST_KEYPAIR env var, stellar CLI in PATH.
test-integration:
	@if test -z "$(STELLAR_TEST_KEYPAIR)"; then \
		echo "ERROR: STELLAR_TEST_KEYPAIR is not set."; \
		echo "Run 'make gen-test-keypair' and follow the instructions, then retry."; \
		exit 1; \
	fi
	@echo "Building contract WASM (if needed)..."
	@cd backend && cargo build --target wasm32-unknown-unknown --release 2>&1
	@echo ""
	@echo "Running integration tests..."
	STELLAR_TEST_KEYPAIR="$(STELLAR_TEST_KEYPAIR)" npx vitest run --reporter=verbose --project integration

# ============================================================================
# Existing targets
# ============================================================================

check-all: check-frontend check-backend check-contracts

check-backend: lint-be test-be

check-contracts:
	@echo "Checking smart contracts..."
	cd backend && cargo test --all-features

check-frontend: lint-fe
	@echo "Checking frontend build..."
	npm run build

lint-be:
	@echo "Running clippy on backend..."
	cd backend && cargo clippy --workspace --all-targets --all-features -- -D warnings

test-be:
	@echo "Running backend tests..."
	cd backend && cargo test

lint-fe:
	@echo "Running frontend lint..."
	npm run lint
