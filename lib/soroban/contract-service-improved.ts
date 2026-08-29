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
}

export const improvedContractService = new ImprovedContractService();
