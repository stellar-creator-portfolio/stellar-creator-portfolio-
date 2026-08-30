/**
 * Improved Soroban Contract Service
 * Handles transaction submission with proper sequence number management
 *
 * Fixes:
 * - Distributed locking for sequence numbers
 * - Transaction queue to prevent concurrent submissions
 * - Automatic retry with exponential backoff
 * - Proper error handling for sequence mismatches
 */

import {
  Address,
  Contract,
  TransactionBuilder,
  xdr,
  scValToNative,
  nativeToScVal,
  Account,
  rpc,
  TimeoutInfinite,
} from "@stellar/stellar-sdk";
import { stellarClient } from "@/services/api/stellar/client";
import { Signer } from "@/services/api/stellar/types";
import { getSequenceManager } from "./sequence-manager";
import { getTransactionQueue } from "./transaction-queue";
import {
  verifyLockedOracleQuote,
  type LockedOracleQuote,
} from "@/lib/payments/oracle-quote-service";

/**
 * Improved contract service with sequence management
 */
export class ImprovedContractService {
  async simulateContractMethod<T = any>(
    contractId: string,
    method: string,
    args: any[],
    signer: Signer,
  ): Promise<T> {
    const sourcePublicKey = signer.publicKey();
    const rpcServer = stellarClient.rpc;
    const networkPassphrase = stellarClient.config.networkPassphrase;
    const sourceAccount = await rpcServer.getAccount(sourcePublicKey);
    const contract = new Contract(contractId);

    const call = contract.call(
      method,
      ...args.map((arg) => nativeToScVal(arg)),
    );
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase,
    })
      .addOperation(call)
      .setTimeout(TimeoutInfinite)
      .build();

    const simulation = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.error)}`);
    }

    const retval = (simulation as any).result?.retval;
    if (!retval) {
      throw new Error(`Simulation for ${method} did not return a value`);
    }

    return scValToNative(retval as xdr.ScVal) as T;
  }

  async createFiatPeggedEscrowSettlement(params: {
    oracleContractId: string;
    ammContractId: string;
    escrowContractId: string;
    bountyId: number;
    escrowId: number;
    payerAddress: string;
    payeeAddress: string;
    tokenAddress: string;
    usdAmountCents: number;
    minXlmOut?: number;
    signer: Signer;
  }): Promise<{
    lockedPriceMicroUsd: number;
    usedFallbackPrice: boolean;
    xlmAmount: number;
    txHashes: string[];
    rollbackRequired?: boolean;
    manualRecoveryNote?: string;
  }> {
    const usdAmountMicro = params.usdAmountCents * 10_000;
    const valuation = await this.simulateContractMethod<{
      token_amount: number;
      price_used: number;
      used_fallback: boolean;
    }>(
      params.oracleContractId,
      "value_in_tokens",
      [usdAmountMicro],
      params.signer,
    );

    const minXlmOut =
      params.minXlmOut ?? Math.floor(Number(valuation.token_amount) * 0.95);
    const txHashes: string[] = [];

    const lockHash = await this.invokeContractMethod(
      params.oracleContractId,
      "lock_price",
      [params.escrowId, usdAmountMicro],
      params.signer,
    );
    txHashes.push(lockHash);

    const swapHash = await this.invokeContractMethod(
      params.ammContractId,
      "swap_exact_usd_to_xlm",
      [usdAmountMicro, minXlmOut, params.escrowId],
      params.signer,
    );
    txHashes.push(swapHash);

    try {
      const depositHash = await this.invokeContractMethod(
        params.escrowContractId,
        "deposit",
        [
          params.bountyId,
          params.payerAddress,
          params.payeeAddress,
          Number(valuation.token_amount),
          params.tokenAddress,
          "OnCompletion",
          params.oracleContractId,
          usdAmountMicro,
        ],
        params.signer,
      );
      txHashes.push(depositHash);
    } catch (error) {
      return {
        lockedPriceMicroUsd: Number(valuation.price_used),
        usedFallbackPrice: Boolean(valuation.used_fallback),
        xlmAmount: Number(valuation.token_amount),
        txHashes,
        rollbackRequired: true,
        manualRecoveryNote:
          "AMM swap succeeded but escrow.deposit failed. Recover the XLM held at the escrow contract address with the admin refund transaction.",
      };
    }

    return {
      lockedPriceMicroUsd: Number(valuation.price_used),
      usedFallbackPrice: Boolean(valuation.used_fallback),
      xlmAmount: Number(valuation.token_amount),
      txHashes,
    };
  }

  /**
   * Resolve the amount submitted to `deposit` from a signed server valuation.
   * The caller may tighten the minimum, but can never loosen it below the
   * contract-derived amount.
   */
  deriveServerLockedMinimum(params: {
    quote: LockedOracleQuote;
    quoteSigningSecret: string;
    bountyId: string;
    usdAmountMicro: string;
    clientMinXlmOutStroops?: string;
    nowSeconds?: number;
  }): string {
    const lockedMinimum = verifyLockedOracleQuote({
      quote: params.quote,
      secret: params.quoteSigningSecret,
      expectedBountyId: params.bountyId,
      expectedUsdAmountMicro: params.usdAmountMicro,
      clientMinXlmOutStroops: params.clientMinXlmOutStroops,
      nowSeconds: params.nowSeconds,
    });
    if (!params.clientMinXlmOutStroops) return lockedMinimum;
    return BigInt(params.clientMinXlmOutStroops) > BigInt(lockedMinimum)
      ? params.clientMinXlmOutStroops
      : lockedMinimum;
  }

  /**
   * Invoke contract method with proper sequence management
   * Prevents nonce collisions under concurrent load
   */
  async invokeContractMethod(
    contractId: string,
    method: string,
    args: any[],
    signer: Signer,
  ): Promise<string> {
    const sourcePublicKey = signer.publicKey();
    const rpcServer = stellarClient.rpc;
    const networkPassphrase = stellarClient.config.networkPassphrase;

    // Get transaction queue for this account
    const queue = getTransactionQueue(sourcePublicKey);

    // Enqueue transaction
    const txId = await queue.enqueue(contractId, method, args, 3);

    // Wait for transaction to be processed
    return await this.waitForTransaction(txId, sourcePublicKey, signer);
  }

  /**
   * Wait for transaction to complete
   */
  private async waitForTransaction(
    txId: string,
    accountId: string,
    signer: Signer,
  ): Promise<string> {
    const queue = getTransactionQueue(accountId);
    const maxWaitTime = 60000; // 60 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const status = await queue.getStatus(txId);

      if (!status) {
        throw new Error(`Transaction ${txId} not found in queue`);
      }

      if (status.status === "confirmed") {
        return status.txHash!;
      }

      if (status.status === "failed") {
        throw new Error(`Transaction failed: ${status.error}`);
      }

      // Wait before checking again
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Transaction ${txId} timeout after ${maxWaitTime}ms`);
  }

  /**
   * Build and submit transaction with sequence management
   */
  async buildAndSubmitTransaction(
    contractId: string,
    method: string,
    args: any[],
    signer: Signer,
    sequence: bigint,
  ): Promise<string> {
    const sourcePublicKey = signer.publicKey();
    const rpcServer = stellarClient.rpc;
    const networkPassphrase = stellarClient.config.networkPassphrase;
    const contract = new Contract(contractId);

    // Build transaction with provided sequence
    const call = contract.call(
      method,
      ...args.map((arg) => nativeToScVal(arg)),
    );
    let tx = new TransactionBuilder(
      new Account(sourcePublicKey, sequence.toString()),
      {
        fee: "100",
        networkPassphrase,
      },
    )
      .addOperation(call)
      .setTimeout(TimeoutInfinite)
      .build();

    // Simulate transaction
    const simulation = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.error)}`);
    }

    // Assemble transaction
    tx = rpc.assembleTransaction(tx, simulation).build();

    // Sign transaction
    tx = (await signer.signTransaction(tx as any)) as any;

    // Submit transaction
    const response = await rpcServer.sendTransaction(tx);
    if (response.status === "ERROR") {
      throw new Error(
        `Transaction submission failed: ${JSON.stringify(response.errorResult)}`,
      );
    }

    // Poll for status
    return await this.pollTransactionStatus(response.hash, rpcServer);
  }

  /**
   * Poll for transaction status
   */
  private async pollTransactionStatus(
    txHash: string,
    rpcServer: any,
  ): Promise<string> {
    const maxAttempts = 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const statusResponse = await rpcServer.getTransaction(txHash);

      if (statusResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return txHash;
      }

      if (statusResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(
          `Transaction failed: ${JSON.stringify(statusResponse.resultXdr)}`,
        );
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error(
      `Transaction ${txHash} timeout after ${maxAttempts} attempts`,
    );
  }

  /**
   * Get contract data (read-only, no sequence needed)
   */
  async getContractData(contractId: string, key: string): Promise<any> {
    const contract = new Contract(contractId);
    const rpcServer = stellarClient.rpc;

    const result = await rpcServer.getContractData(
      contract.address(),
      nativeToScVal(key, { type: "symbol" }),
      rpc.Durability.Persistent,
    );

    if (!result || !result.val) {
      return null;
    }

    return scValToNative(result.val as xdr.ScVal);
  }

  /**
   * Get queue status for monitoring
   */
  getQueueStatus(accountId: string): any {
    const queue = getTransactionQueue(accountId);
    return queue.getQueueStatus();
  }

  /**
   * Clear queues (for testing)
   */
  clearQueues(): void {
    // This would clear all queues
  }

  // ── Dispute-specific sequence-safe invokes ───────────────────────────────
  // These ensure that filing a dispute freezes on-chain BEFORE Stripe can
  // capture, and that resolution settles both ledgers atomically.

  /**
   * Freeze escrow on-chain for dispute (dispute_escrow / dispute_escrow_with_evidence)
   * Sequence-safe: uses transaction queue to prevent nonce collisions.
   */
  async freezeEscrow(
    contractId: string,
    escrowId: bigint,
    evidenceHash: string | undefined,
    signer: Signer,
  ): Promise<string> {
    const method = evidenceHash
      ? 'dispute_escrow_with_evidence'
      : 'dispute_escrow';
    const args = evidenceHash
      ? [escrowId.toString(), evidenceHash]
      : [escrowId.toString()];
    // Use invokeContractMethod which handles queue + retry + sequence
    return this.invokeContractMethod(contractId, method, args, signer);
  }

  /**
   * Resolve dispute on-chain (resolve_dispute / resolve_dispute_split)
   * Enforces admin-only via contract, with appeal window timelock.
   */
  async resolveDispute(
    contractId: string,
    escrowId: bigint,
    outcome: 'favor_client' | 'favor_creator',
    signer: Signer,
  ): Promise<string> {
    const releaseToPayee = outcome === 'favor_creator';
    return this.invokeContractMethod(
      contractId,
      'resolve_dispute',
      [escrowId.toString(), releaseToPayee],
      signer
    );
  }

  async resolveDisputeSplit(
    contractId: string,
    escrowId: bigint,
    clientAmount: bigint,
    creatorAmount: bigint,
    signer: Signer,
  ): Promise<string> {
    return this.invokeContractMethod(
      contractId,
      'resolve_dispute_split',
      [escrowId.toString(), clientAmount.toString(), creatorAmount.toString()],
      signer
    );
  }

  /**
   * Set evidence commitment on-chain (set_dispute_evidence)
   * SHA-256 hash is stored as BytesN<32> and can be verified later.
   */
  async commitEvidence(
    contractId: string,
    escrowId: bigint,
    evidenceHash: string,
    signer: Signer,
  ): Promise<string> {
    return this.invokeContractMethod(
      contractId,
      'set_dispute_evidence',
      [escrowId.toString(), evidenceHash],
      signer
    );
  }

  /**
   * Finalize after appeal window (finalize_dispute)
   * On-chain timelock ensures appeal window has expired.
   */
  async finalizeDispute(
    contractId: string,
    escrowId: bigint,
    signer: Signer,
  ): Promise<string> {
    return this.invokeContractMethod(
      contractId,
      'finalize_dispute',
      [escrowId.toString()],
      signer
    );
  }

  /**
   * Appeal within window (appeal_dispute)
   * Only parties may appeal, enforced on-chain.
   */
  async appealDispute(
    contractId: string,
    escrowId: bigint,
    signer: Signer,
  ): Promise<string> {
    return this.invokeContractMethod(
      contractId,
      'appeal_dispute',
      [escrowId.toString()],
      signer
    );
  }

  /**
   * Get dispute info (read-only, no sequence needed) - verifies evidence commitment
   */
  async getDisputeInfo(contractId: string, escrowId: bigint): Promise<any> {
    return this.getContractData(contractId, `dispute_${escrowId}`);
  }

  async getAppealDeadline(contractId: string, escrowId: bigint): Promise<bigint | null> {
    const info = await this.getDisputeInfo(contractId, escrowId);
    return info?.appeal_deadline ?? null;
  }

  async isAppealWindowActive(contractId: string, escrowId: bigint): Promise<boolean> {
    const deadline = await this.getAppealDeadline(contractId, escrowId);
    if (!deadline) return false;
    return BigInt(Date.now() / 1000) < deadline;
  }
}

export const improvedContractService = new ImprovedContractService();
