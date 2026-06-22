/**
 * Soroban Transaction Queue
 * Manages transaction submission with automatic retry and exponential backoff
 *
 * Features:
 * - Queues transactions per account
 * - Automatic retry on transient failures
 * - Exponential backoff
 * - Sequence number management
 * - Transaction status tracking
 * - Real Soroban RPC submission via Stellar SDK
 */

import { getSequenceManager } from "./sequence-manager";
import {
  Server,
  TransactionBuilder,
  Keypair,
  Account,
  Contract,
  TimeoutInfinite,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { StellarClient } from "@/services/api/stellar/client";

/**
 * Transaction queue entry
 */
export interface QueuedTransaction {
  id: string;
  accountId: string;
  contractId: string;
  method: string;
  args: any[];
  status: "pending" | "submitted" | "confirmed" | "failed";
  sequence?: bigint;
  txHash?: string;
  error?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  submittedAt?: Date;
  confirmedAt?: Date;
}

/**
 * Transaction submission result
 */
export interface SubmissionResult {
  success: boolean;
  txHash?: string;
  sequence?: bigint;
  error?: string;
  attempts: number;
}

/**
 * Transaction queue for a single account
 */
export class TransactionQueue {
  private accountId: string;
  private queue: QueuedTransaction[] = [];
  private isProcessing = false;
  private maxConcurrent = 1; // Process one at a time to maintain sequence order
  private retryDelays = [100, 500, 2000, 5000]; // Exponential backoff in ms

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  /**
   * Enqueue a transaction for submission
   */
  async enqueue(
    contractId: string,
    method: string,
    args: any[],
    maxAttempts: number = 3,
  ): Promise<string> {
    const transaction: QueuedTransaction = {
      id: `${Date.now()}-${Math.random()}`,
      accountId: this.accountId,
      contractId,
      method,
      args,
      status: "pending",
      attempts: 0,
      maxAttempts,
      createdAt: new Date(),
    };

    this.queue.push(transaction);

    // Start processing if not already running.
    // Fire-and-forget: enqueue returns immediately; queue processes in background.
    if (!this.isProcessing) {
      this.processQueue().catch((err) => {
        console.error(
          `[TransactionQueue] processQueue crashed for account ${this.accountId}:`,
          err,
        );
      });
    }

    return transaction.id;
  }

  /**
   * Get transaction status
   */
  async getStatus(txId: string): Promise<QueuedTransaction | null> {
    return this.queue.find((tx) => tx.id === txId) || null;
  }

  /**
   * Process queued transactions
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const transaction = this.queue[0];

        try {
          const result = await this.submitTransaction(transaction);

          if (result.success) {
            // Remove from queue on success
            this.queue.shift();
          } else {
            // Retry on failure
            transaction.attempts++;
            transaction.error = result.error;

            if (transaction.attempts >= transaction.maxAttempts) {
              // Max retries exceeded, remove from queue
              this.queue.shift();
              transaction.status = "failed";
            } else {
              // Wait before retry
              const delay = this.retryDelays[transaction.attempts - 1] || 5000;
              await this.sleep(delay);
            }
          }
        } catch (error) {
          // Unexpected error, retry
          transaction.attempts++;
          transaction.error = (error as Error).message;

          if (transaction.attempts >= transaction.maxAttempts) {
            this.queue.shift();
            transaction.status = "failed";
          } else {
            const delay = this.retryDelays[transaction.attempts - 1] || 5000;
            await this.sleep(delay);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Submit a single transaction
   */
  private async submitTransaction(
    transaction: QueuedTransaction,
  ): Promise<SubmissionResult> {
    try {
      // Get next sequence number
      const sequenceManager = getSequenceManager(this.accountId);
      const sequence = await sequenceManager.getNextSequence();
      transaction.sequence = sequence;

      // Submit transaction to Soroban RPC (build → simulate → assemble → sign → send → poll)
      const txHash = await this.submitToSoroban(transaction, sequence);

      // submitToSoroban polls for confirmation internally, so the tx is
      // already confirmed (or threw) by the time we get here.
      transaction.status = "confirmed";
      transaction.submittedAt = new Date();
      transaction.confirmedAt = new Date();
      transaction.txHash = txHash;

      return {
        success: true,
        txHash,
        sequence,
        attempts: transaction.attempts + 1,
      };
    } catch (error) {
      const errorMsg = (error as Error).message;

      return {
        success: false,
        error: errorMsg,
        attempts: transaction.attempts + 1,
      };
    }
  }

  /**
   * Submit transaction to Soroban RPC.
   *
   * Full lifecycle: Build → Simulate → Assemble → Sign → Send → Poll.
   * Signs with the admin keypair resolved via StellarClient (KMS-backed).
   */
  private async submitToSoroban(
    transaction: QueuedTransaction,
    sequence: bigint,
  ): Promise<string> {
    // Resolve StellarClient (cached singleton after first call)
    const client = await StellarClient.getInstance();
    const rpcServer: Server = client.rpc;
    const networkPassphrase: string = client.config.networkPassphrase;
    const adminSecret: string | undefined = client.config.adminSecret;
    if (!adminSecret) {
      throw new Error(
        "StellarClient has no adminSecret — cannot sign transactions",
      );
    }
    const adminKp = Keypair.fromSecret(adminSecret);
    const contract = new Contract(transaction.contractId);

    // 1. Build the raw transaction
    const scArgs = transaction.args.map((arg) => nativeToScVal(arg));
    const call = contract.call(transaction.method, ...scArgs);

    let tx = new TransactionBuilder(
      new Account(transaction.accountId, sequence.toString()),
      {
        fee: "100",
        networkPassphrase,
      },
    )
      .addOperation(call)
      .setTimeout(TimeoutInfinite)
      .build();

    // 2. Simulate to get resource footprint + assembled transaction envelope
    const simulation = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(
        `Simulation failed: ${JSON.stringify(simulation.error)}`,
      );
    }

    // 3. Assemble — applies sorobanData, resource fee, etc. from simulation
    tx = rpc.assembleTransaction(tx, simulation).build();

    // 4. Sign with admin keypair (required before sendTransaction)
    tx.sign(adminKp);

    // 5. Send signed transaction to network
    const sendResp = await rpcServer.sendTransaction(tx);

    if (sendResp.status === "ERROR") {
      throw new Error(
        `Send failed: ${JSON.stringify(sendResp.errorResult)}`,
      );
    }

    // 6. Poll for confirmation
    return await this.pollForConfirmation(sendResp.hash, rpcServer);
  }

  /**
   * Poll Soroban RPC until the transaction is confirmed or failed.
   */
  private async pollForConfirmation(
    txHash: string,
    rpcServer: Server,
  ): Promise<string> {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      const status = await rpcServer.getTransaction(txHash);

      switch (status.status) {
        case rpc.Api.GetTransactionStatus.SUCCESS:
          return txHash;
        case rpc.Api.GetTransactionStatus.FAILED:
          throw new Error(
            `Transaction ${txHash} failed: ${JSON.stringify(status.resultXdr)}`,
          );
        case rpc.Api.GetTransactionStatus.NOT_FOUND:
          // May take a moment — wait and retry
          break;
      }

      await this.sleep(1000);
    }

    throw new Error(`Transaction ${txHash} timed out after ${maxAttempts}s`);
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: string): boolean {
    const retryableErrors = [
      "timeout",
      "EAGAIN",
      "ECONNRESET",
      "ECONNREFUSED",
      "bad sequence number", // Retry on sequence mismatch
      "transaction already in ledger", // Already submitted, wait
    ];

    return retryableErrors.some((err) => error.includes(err));
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    size: number;
    pending: number;
    submitted: number;
    confirmed: number;
    failed: number;
  } {
    return {
      size: this.queue.length,
      pending: this.queue.filter((tx) => tx.status === "pending").length,
      submitted: this.queue.filter((tx) => tx.status === "submitted").length,
      confirmed: this.queue.filter((tx) => tx.status === "confirmed").length,
      failed: this.queue.filter((tx) => tx.status === "failed").length,
    };
  }
}

/**
 * Global transaction queues per account
 */
const queues = new Map<string, TransactionQueue>();

/**
 * Get or create transaction queue for account
 */
export function getTransactionQueue(accountId: string): TransactionQueue {
  if (!queues.has(accountId)) {
    queues.set(accountId, new TransactionQueue(accountId));
  }
  return queues.get(accountId)!;
}

/**
 * Clear all transaction queues (for testing)
 */
export function clearTransactionQueues(): void {
  queues.clear();
}
