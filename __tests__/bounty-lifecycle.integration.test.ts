/**
 * Bounty Lifecycle Integration Test
 *
 * Exercises the full on-chain bounty lifecycle on Stellar Testnet:
 *   deploy → create → apply → accept → fund escrow → complete → release → verify
 *
 * Prerequisites:
 *   - stellar CLI in PATH
 *   - STELLAR_TEST_KEYPAIR env var (creator secret key)
 *   - Rust/wasm32-unknown-unknown target (for contract build)
 *
 * Run:  make test-integration
 *
 * @vitest-environment node
 * @group integration
 */

import {
  Keypair,
  rpc,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  Account,
  Address,
  TimeoutInfinite,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { execFileSync } from "node:child_process";
import { existsSync } from "fs";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const FRIENDBOT_URL = "https://friendbot.stellar.org";

const BOUNTY_AMOUNT_XLM = "10"; // XLM
const BOUNTY_AMOUNT_STROOPS = 10_000_000n; // 10 XLM
const PLATFORM_FEE_XLM = "0.25";
const FREELANCER_PAYOUT_XLM = "9.75";
const FREELANCER_PAYOUT_STROOPS = 9_750_000n;
const FEE_ACCOUNT_PUBLIC = "GBZXN7PJRXOP2KJH6P7X2Y5GXJ3Y5XKJ5VY5X5KJ5VY5X5KJ5VY5"; // placeholder fee collector

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TxRecord {
  step: string;
  txHash: string;
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

let rpcServer: rpc.Server;
let contractId: string;
let creatorKp: Keypair;
let freelancerKp: Keypair;
let escrowKp: Keypair;
const txRecords: TxRecord[] = [];

// ---------------------------------------------------------------------------
// Helpers — CLI
// ---------------------------------------------------------------------------

function stellar(...args: string[]): string {
  return execFileSync("stellar", args, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

// ---------------------------------------------------------------------------
// Helpers — Funding
// ---------------------------------------------------------------------------

async function fundAccount(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!res.ok) {
    throw new Error(
      `Friendbot funding failed for ${publicKey}: ${await res.text()}`,
    );
  }
  await new Promise((r) => setTimeout(r, 3000));
}

// ---------------------------------------------------------------------------
// Helpers — Horizon
// ---------------------------------------------------------------------------

async function getBalanceStroops(publicKey: string): Promise<bigint> {
  const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
  if (!res.ok) throw new Error(`Horizon fetch failed for ${publicKey}`);
  const json = await res.json();
  const xlm = json.balances.find((b: any) => b.asset_type === "native");
  if (!xlm) return 0n;
  const parts = xlm.balance.split(".");
  const whole = BigInt(parts[0]) * 10_000_000n;
  const frac = parts[1] ? BigInt(parts[1].padEnd(7, "0").slice(0, 7)) : 0n;
  return whole + frac;
}

async function verifyTxOnHorizon(txHash: string): Promise<boolean> {
  const res = await fetch(`${HORIZON_URL}/transactions/${txHash}`);
  return res.ok;
}

async function getPaymentsForAccount(
  publicKey: string,
): Promise<any[]> {
  const res = await fetch(
    `${HORIZON_URL}/accounts/${publicKey}/payments?limit=10&order=desc`,
  );
  if (!res.ok) return [];
  const json = await res.json();
  return json._embedded?.records ?? [];
}

// ---------------------------------------------------------------------------
// Helpers — Soroban Contract Invocation
// ---------------------------------------------------------------------------

function toScVal(a: any): any {
  if (a instanceof Address) return nativeToScVal(a);
  if (typeof a === "bigint") return nativeToScVal(a, { type: "i128" });
  if (typeof a === "number" && Number.isInteger(a))
    return nativeToScVal(a, { type: "u64" });
  if (typeof a === "string") return nativeToScVal(a);
  if (typeof a === "boolean") return nativeToScVal(a);
  return nativeToScVal(a);
}

async function invokeContract(
  contractId: string,
  method: string,
  args: any[],
  signer: Keypair,
): Promise<string> {
  const pubKey = signer.publicKey();
  const sourceAccount = await rpcServer.getAccount(pubKey);

  const contract = new Contract(contractId);
  const call = contract.call(method, ...args.map(toScVal));

  let tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(call)
    .setTimeout(TimeoutInfinite)
    .build();

  // simulate
  const simulation = await rpcServer.simulateTransaction(tx);

  // If simulation error for a method that should succeed, throw
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(
      `Simulation failed for ${method}: ${JSON.stringify(simulation.error)}`,
    );
  }

  // assemble
  tx = rpc.assembleTransaction(tx, simulation).build();

  // sign
  tx.sign(signer);

  // submit
  const sendRes = await rpcServer.sendTransaction(tx);
  if (sendRes.status === "ERROR") {
    throw new Error(
      `Submit failed for ${method}: ${JSON.stringify(sendRes.errorResult)}`,
    );
  }

  // poll
  const txHash = sendRes.hash;
  for (let i = 0; i < 60; i++) {
    const st = await rpcServer.getTransaction(txHash);
    if (st.status === rpc.Api.GetTransactionStatus.SUCCESS) return txHash;
    if (st.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(
        `Tx failed for ${method}: ${JSON.stringify(st.resultXdr)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Tx ${txHash} for ${method} timed out`);
}

// ---------------------------------------------------------------------------
// Helpers — Stellar Payment (Horizon)
// ---------------------------------------------------------------------------

async function submitPayment(
  fromKp: Keypair,
  toAddress: string,
  amountXlm: string,
): Promise<string> {
  const pubKey = fromKp.publicKey();
  const accRes = await fetch(`${HORIZON_URL}/accounts/${pubKey}`);
  if (!accRes.ok) throw new Error(`Cannot fetch account ${pubKey}`);
  const accData = await accRes.json();

  const tx = new TransactionBuilder(
    new Account(pubKey, accData.sequence),
    { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE },
  )
    .addOperation(
      Operation.payment({
        destination: toAddress,
        asset: Asset.native(),
        amount: amountXlm,
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(fromKp);

  const body = new URLSearchParams({ tx: tx.toXDR("base64") });
  const res = await fetch(`${HORIZON_URL}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Payment failed: ${json.extras?.result_codes?.transaction ?? JSON.stringify(json)}`,
    );
  }
  return json.hash;
}

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  rpcServer = new rpc.Server(RPC_URL);

  const creatorSecret = process.env.STELLAR_TEST_KEYPAIR;
  if (!creatorSecret) {
    throw new Error("STELLAR_TEST_KEYPAIR env var is required");
  }
  creatorKp = Keypair.fromSecret(creatorSecret);
  freelancerKp = Keypair.random();
  escrowKp = Keypair.random();

  console.log(`Creator:     ${creatorKp.publicKey()}`);
  console.log(`Freelancer:  ${freelancerKp.publicKey()}`);
  console.log(`Escrow:      ${escrowKp.publicKey()}`);

  // Fund all three accounts
  // Friendbot only funds accounts that haven't been funded, so if you re-run
  // with the same STELLAR_TEST_KEYPAIR, it will skip funding (no-op).
  for (const kp of [creatorKp, freelancerKp, escrowKp]) {
    console.log(`Funding ${kp.publicKey()}...`);
    await fundAccount(kp.publicKey());
  }

  // Deploy contract
  const wasmPath = path.resolve(
    "backend/target/wasm32-unknown-unknown/release/stellar_bounty_contract.wasm",
  );
  if (!existsSync(wasmPath)) {
    console.log("Building contract WASM...");
    execSync(
      "cd backend && cargo build --target wasm32-unknown-unknown --release 2>&1",
      { stdio: "inherit", maxBuffer: 50 * 1024 * 1024 },
    );
  }

  console.log("Deploying contract...");
  contractId = stellar(
    "contract",
    "deploy",
    "--wasm",
    wasmPath,
    "--source-account",
    creatorSecret,
    "--network",
    "testnet",
  );
  console.log(`Contract deployed: ${contractId}`);
  await new Promise((r) => setTimeout(r, 3000));
}, 300_000);

afterAll(async () => {
  console.log("\n=== Tx Record ===");
  for (const r of txRecords) {
    const ok = await verifyTxOnHorizon(r.txHash);
    const icon = ok ? "✓" : "✗";
    console.log(`  ${icon} ${r.step}: ${r.txHash}`);
  }
  // Assert all tx hashes are findable
  for (const r of txRecords) {
    expect(await verifyTxOnHorizon(r.txHash)).toBe(true);
  }

  console.log("\n=== Final Balances (XLM) ===");
  for (const [label, kp] of Object.entries({
    Creator: creatorKp,
    Freelancer: freelancerKp,
    Escrow: escrowKp,
  })) {
    const s = await getBalanceStroops(kp.publicKey());
    console.log(`  ${label}: ${(Number(s) / 10_000_000).toFixed(7)}`);
  }
}, 120_000);

// ---------------------------------------------------------------------------
// Happy Path
// ---------------------------------------------------------------------------

describe("Bounty Lifecycle", () => {
  it("1. create — creator creates a bounty on-chain", async () => {
    const creatorAddr = Address.fromString(creatorKp.publicKey());
    const txHash = await invokeContract(contractId, "create_bounty", [
      creatorAddr,
      "Integration Test Bounty",
      "Full lifecycle end-to-end test",
      BOUNTY_AMOUNT_STROOPS,
      2_000_000_000n, // deadline (far future)
    ], creatorKp);
    txRecords.push({ step: "create_bounty", txHash });
    expect(txHash).toHaveLength(64);
  });

  it("2. apply — freelancer applies for the bounty", async () => {
    const freelancerAddr = Address.fromString(freelancerKp.publicKey());
    const txHash = await invokeContract(contractId, "apply_for_bounty", [
      1n,
      freelancerAddr,
      "I will deliver this on time.",
      9_500_000n,
      30n,
    ], freelancerKp);
    txRecords.push({ step: "apply_for_bounty", txHash });
    expect(txHash).toHaveLength(64);
  });

  it("3. accept — creator selects the freelancer", async () => {
    const txHash = await invokeContract(contractId, "select_freelancer", [
      1n,
      1n,
    ], creatorKp);
    txRecords.push({ step: "select_freelancer", txHash });
    expect(txHash).toHaveLength(64);
  });

  it("4. fund escrow — creator locks funds in escrow account", async () => {
    const txHash = await submitPayment(
      creatorKp,
      escrowKp.publicKey(),
      BOUNTY_AMOUNT_XLM,
    );
    txRecords.push({ step: "fund_escrow", txHash });
    expect(txHash).toHaveLength(64);
  });

  it("5. complete — freelancer submits completion", async () => {
    const freelancerAddr = Address.fromString(freelancerKp.publicKey());
    const txHash = await invokeContract(contractId, "submit_completion", [
      1n,
      freelancerAddr,
    ], freelancerKp);
    txRecords.push({ step: "submit_completion", txHash });
    expect(txHash).toHaveLength(64);
  });

  it("6. complete — creator approves the bounty", async () => {
    const txHash = await invokeContract(contractId, "complete_bounty", [
      1n,
    ], creatorKp);
    txRecords.push({ step: "complete_bounty", txHash });
    expect(txHash).toHaveLength(64);
  });

  it("7. release — escrow pays freelancer and platform fee", async () => {
    // Release freelancer payment
    const releaseTx = await submitPayment(
      escrowKp,
      freelancerKp.publicKey(),
      FREELANCER_PAYOUT_XLM,
    );
    txRecords.push({ step: "release_freelancer", txHash: releaseTx });

    // Pay platform fee
    const feeTx = await submitPayment(
      escrowKp,
      FEE_ACCOUNT_PUBLIC,
      PLATFORM_FEE_XLM,
    );
    txRecords.push({ step: "pay_platform_fee", txHash: feeTx });
  });

  it("8. verify — freelancer received correct payout (on-chain check)", async () => {
    // Freelancer balance = friendbot 10k + payout ~9.75 - tx fees
    const balance = await getBalanceStroops(freelancerKp.publicKey());
    const friendbotGrant = 10_000n * 10_000_000n; // ~10,000 XLM from friendbot
    expect(balance).toBeGreaterThan(friendbotGrant + FREELANCER_PAYOUT_STROOPS - 1_000_000n);

    // Verify the payment appears in Horizon payments for the freelancer
    const payments = await getPaymentsForAccount(freelancerKp.publicKey());
    const matchingPayment = payments.find(
      (p: any) =>
        p.type === "payment" &&
        p.asset_type === "native" &&
        p.from === escrowKp.publicKey() &&
        p.amount === FREELANCER_PAYOUT_XLM,
    );
    expect(matchingPayment).toBeTruthy();
  });

  it("9. verify — bounty counter is 1", async () => {
    // Use getContractData with simple symbol key
    const contract = new Contract(contractId);
    const result = await rpcServer.getContractData(
      contract.address(),
      nativeToScVal("bounty_counter", { type: "symbol" }),
      rpc.Durability.Persistent,
    );
    expect(result).toBeTruthy();
    if (result?.val) {
      const val = scValToNative(result.val as any);
      expect(val).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Failure Paths
// ---------------------------------------------------------------------------

describe("Failure paths", () => {
  it("applying to a non-existent bounty returns a contract error", async () => {
    const freelancerAddr = Address.fromString(freelancerKp.publicKey());
    let err: Error | null = null;
    try {
      await invokeContract(contractId, "apply_for_bounty", [
        99_999n,
        freelancerAddr,
        "should fail",
        1n,
        1n,
      ], freelancerKp);
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/simulation|error|Failed|host|Contract/i);
  });

  it("selecting freelancer with a wrong application ID fails", async () => {
    let err: Error | null = null;
    try {
      await invokeContract(contractId, "select_freelancer", [
        1n,
        99_999n,
      ], creatorKp);
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/simulation|error|Failed|host|Contract|Application/i);
  });

  it("completing a bounty that is still 'Open' fails", async () => {
    // Create a new bounty (id=2) that is never applied to
    const creatorAddr = Address.fromString(creatorKp.publicKey());
    const txHash = await invokeContract(contractId, "create_bounty", [
      creatorAddr,
      "Never-assigned bounty",
      "Testing early complete",
      BOUNTY_AMOUNT_STROOPS,
      2_000_000_000n,
    ], creatorKp);
    txRecords.push({ step: "create_bounty_early_complete", txHash });

    let err: Error | null = null;
    try {
      await invokeContract(contractId, "complete_bounty", [2n], creatorKp);
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/simulation|error|Failed|host|Freelancer|submit/i);
  });
});
