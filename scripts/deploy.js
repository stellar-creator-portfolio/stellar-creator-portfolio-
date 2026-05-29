#!/usr/bin/env node
/**
 * scripts/deploy.js
 *
 * Deploys (or simulates) Soroban contracts to the Stellar network.
 *
 * Required env vars:
 *   STELLAR_NETWORK            - "mainnet" | "testnet"
 *   STELLAR_RPC_URL            - Soroban RPC endpoint
 *   STELLAR_NETWORK_PASSPHRASE - Network passphrase
 *   STELLAR_ADMIN_SECRET       - Deployer secret key (skipped in --simulate-only)
 *
 * Flags:
 *   --simulate-only  Run preflight simulations only; do not submit transactions.
 */

"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SIMULATE_ONLY = process.argv.includes("--simulate-only");

const NETWORK = process.env.STELLAR_NETWORK;
const RPC_URL = process.env.STELLAR_RPC_URL;
const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE;
const ADMIN_SECRET = process.env.STELLAR_ADMIN_SECRET;

// Guard: refuse to run against mainnet without an explicit network flag.
if (NETWORK === "mainnet" && !SIMULATE_ONLY && !ADMIN_SECRET) {
  console.error("❌ STELLAR_ADMIN_SECRET is required for mainnet deployments.");
  process.exit(1);
}

if (!RPC_URL) {
  console.error("❌ STELLAR_RPC_URL is not set.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Contracts to deploy (name → wasm path relative to repo root)
// ---------------------------------------------------------------------------

const WASM_DIR = process.env.WASM_DIR || "backend/target/wasm32-unknown-unknown/release";

const CONTRACTS = [
  { name: "bounty",     wasm: `${WASM_DIR}/bounty.wasm`,     outputKey: "bounty_contract_id" },
  { name: "escrow",     wasm: `${WASM_DIR}/escrow.wasm`,     outputKey: "escrow_contract_id" },
  { name: "freelancer", wasm: `${WASM_DIR}/freelancer.wasm`, outputKey: "freelancer_contract_id" },
  { name: "governance", wasm: `${WASM_DIR}/governance.wasm`, outputKey: "governance_contract_id" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts }).trim();
}

/** Emit a GitHub Actions output variable (no-op outside CI). */
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`  → ${key}=${value}`);
}

// ---------------------------------------------------------------------------
// Simulate: preflight each contract upload against the RPC
// ---------------------------------------------------------------------------

function simulateContract(contract) {
  const wasmPath = path.resolve(contract.wasm);
  if (!fs.existsSync(wasmPath)) {
    console.error(`❌ WASM not found: ${wasmPath}`);
    process.exit(1);
  }

  console.log(`  Simulating ${contract.name}…`);
  // stellar contract upload --simulate validates the wasm against the RPC
  // without submitting a transaction.
  run(
    `stellar contract upload \
      --wasm "${wasmPath}" \
      --rpc-url "${RPC_URL}" \
      --network-passphrase "${PASSPHRASE}" \
      --simulate`
  );
  console.log(`  ✅ ${contract.name} simulation passed`);
}

// ---------------------------------------------------------------------------
// Deploy: upload wasm + instantiate contract
// ---------------------------------------------------------------------------

function deployContract(contract) {
  const wasmPath = path.resolve(contract.wasm);
  if (!fs.existsSync(wasmPath)) {
    console.error(`❌ WASM not found: ${wasmPath}`);
    process.exit(1);
  }

  console.log(`  Uploading ${contract.name}…`);
  const wasmHash = run(
    `stellar contract upload \
      --wasm "${wasmPath}" \
      --rpc-url "${RPC_URL}" \
      --network-passphrase "${PASSPHRASE}" \
      --source "${ADMIN_SECRET}"`
  );

  console.log(`  Deploying ${contract.name} (hash: ${wasmHash})…`);
  const contractId = run(
    `stellar contract deploy \
      --wasm-hash "${wasmHash}" \
      --rpc-url "${RPC_URL}" \
      --network-passphrase "${PASSPHRASE}" \
      --source "${ADMIN_SECRET}"`
  );

  setOutput(contract.outputKey, contractId);
  return contractId;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\n🚀 Stellar Contract ${SIMULATE_ONLY ? "Simulation" : "Deployment"}`);
console.log(`   Network : ${NETWORK ?? "(not set)"}`);
console.log(`   RPC     : ${RPC_URL}`);
console.log(`   Mode    : ${SIMULATE_ONLY ? "simulate-only" : "deploy"}\n`);

for (const contract of CONTRACTS) {
  if (SIMULATE_ONLY) {
    simulateContract(contract);
  } else {
    deployContract(contract);
  }
}

console.log(`\n✅ All contracts ${SIMULATE_ONLY ? "simulated" : "deployed"} successfully.\n`);
