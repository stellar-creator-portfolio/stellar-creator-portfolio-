/**
 * Soroban Sequence Number Manager
 * Manages account sequence numbers to prevent nonce collisions under concurrent load
 *
 * Problem: Multiple concurrent transactions fetch the same sequence number,
 * causing all but one to fail with "bad sequence number" error.
 *
 * Solution: Distributed locking via atomic Prisma updateMany (CAS) + local queue
 */

import { prisma } from "@/lib/prisma";

/**
 * Sequence lock entry in database
 * Ensures only one transaction can increment sequence at a time
 */
export interface SequenceLock {
  accountId: string;
  lockedAt: Date;
  lockedBy: string; // transaction ID
  sequence: bigint;
  expiresAt: Date;
}

/**
 * Sequence manager for a single account
 * Handles local queuing and distributed locking
 */
export class SequenceManager {
  private accountId: string;
  private localQueue: Array<{
    id: string;
    resolve: (seq: bigint) => void;
    reject: (err: Error) => void;
  }> = [];
  private isProcessing = false;
  private lockTimeout = 5000; // 5 seconds
  private maxRetries = 3;

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  /**
   * Get next sequence number with distributed locking
   * Ensures no two transactions get the same sequence
   */
  async getNextSequence(): Promise<bigint> {
    return new Promise((resolve, reject) => {
      this.localQueue.push({
        id: `${Date.now()}-${Math.random()}`,
        resolve,
        reject,
      });

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process queued sequence requests one at a time
   * Ensures strict ordering and no collisions
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.localQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.localQueue.length > 0) {
        const request = this.localQueue.shift();
        if (!request) break;

        try {
          const sequence = await this.acquireSequenceWithLock(request.id);
          request.resolve(sequence);
        } catch (error) {
          request.reject(error as Error);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Acquire sequence number with distributed lock
   * Uses atomic compare-and-swap (CAS) to ensure exclusivity across processes
   */
  private async acquireSequenceWithLock(
    transactionId: string,
  ): Promise<bigint> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // Try to acquire lock via atomic CAS
        const acquired = await this.tryAcquireLock(transactionId);
        if (!acquired) {
          // Lock held by another process, wait and retry
          await this.sleep(100 * Math.pow(2, attempt));
          continue;
        }

        try {
          // Get current sequence from Soroban RPC
          const currentSequence = await this.fetchCurrentSequence();

          // Increment and store
          const nextSequence = currentSequence + 1n;

          // Update lock with new sequence (no CAS needed — we own the lock)
          await this.updateLockSequence(transactionId, nextSequence);

          return nextSequence;
        } finally {
          // Always release lock
          await this.releaseLock(transactionId);
        }
      } catch (error) {
        lastError = error as Error;

        // If lock timeout, retry
        if ((error as Error).message.includes("lock timeout")) {
          continue;
        }

        // For other errors, fail immediately
        throw error;
      }
    }

    throw (
      lastError ||
      new Error(
        `Failed to acquire sequence lock after ${this.maxRetries} attempts`,
      )
    );
  }

  /**
   * Atomically acquire distributed lock using compare-and-swap (CAS).
   *
   * The old code raced between upsert + check + update — two concurrent
   * callers could both see an expired lock and both try to claim it.
   *
   * Fix: single `updateMany` with a WHERE clause that atomically tests
   * whether the lock is available (unowned OR expired).  If `count > 0`
   * the calling process exclusively owns the lock.
   */
  private async tryAcquireLock(
    transactionId: string,
  ): Promise<SequenceLock | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.lockTimeout);

    try {
      // Step 1 — atomic CAS: only claim the lock if it is unowned or expired.
      // We use updateMany so the WHERE clause is evaluated inside the same
      // database transaction as the write.
      const { count } = await prisma.sequenceLock.updateMany({
        where: {
          accountId: this.accountId,
          OR: [
            { lockedBy: "" },                // unowned
            { expiresAt: { lt: now } },      // stale lock
          ],
        },
        data: {
          lockedBy: transactionId,
          lockedAt: now,
          expiresAt,
        },
      });

      if (count > 0) {
        // We own the lock — fetch the full row for return value
        const lock = await prisma.sequenceLock.findUnique({
          where: { accountId: this.accountId },
        });
        return lock as SequenceLock;
      }

      // Lock is held by another live transaction
      return null;
    } catch (error) {
      throw new Error(`Failed to acquire lock: ${(error as Error).message}`);
    }
  }

  /**
   * Release distributed lock — only if WE hold it (guard by lockedBy).
   */
  private async releaseLock(transactionId: string): Promise<void> {
    try {
      await prisma.sequenceLock.updateMany({
        where: {
          accountId: this.accountId,
          lockedBy: transactionId,
        },
        data: {
          lockedBy: "",
          expiresAt: new Date(), // expire immediately
        },
      });
    } catch (error) {
      console.error(`Failed to release lock: ${(error as Error).message}`);
    }
  }

  /**
   * Update lock with new sequence number
   */
  private async updateLockSequence(
    transactionId: string,
    sequence: bigint,
  ): Promise<void> {
    await prisma.sequenceLock.updateMany({
      where: {
        accountId: this.accountId,
        lockedBy: transactionId,
      },
      data: { sequence },
    });
  }

  /**
   * Fetch current sequence from Soroban RPC
   */
  private async fetchCurrentSequence(): Promise<bigint> {
    // This would call Soroban RPC to get current sequence
    // For now, return cached value from database
    const lock = await prisma.sequenceLock.findUnique({
      where: { accountId: this.accountId },
    });

    return lock?.sequence ?? 0n;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Global sequence managers per account
 */
const managers = new Map<string, SequenceManager>();

/**
 * Get or create sequence manager for account
 */
export function getSequenceManager(accountId: string): SequenceManager {
  if (!managers.has(accountId)) {
    managers.set(accountId, new SequenceManager(accountId));
  }
  return managers.get(accountId)!;
}

/**
 * Clear all sequence managers (for testing)
 */
export function clearSequenceManagers(): void {
  managers.clear();
}
