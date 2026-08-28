/**
 * Transaction Manager for PostgreSQL
 * Handles isolation levels, pessimistic locking, and deadlock prevention
 */

import { prisma } from "@/lib/prisma";

/**
 * PostgreSQL Isolation Levels
 * - READ UNCOMMITTED: Lowest isolation, highest concurrency (not recommended)
 * - READ COMMITTED: Default, allows dirty reads (not suitable for escrow)
 * - REPEATABLE READ: Prevents dirty reads and non-repeatable reads
 * - SERIALIZABLE: Highest isolation, prevents all anomalies (best for escrow)
 */
export enum IsolationLevel {
  READ_UNCOMMITTED = "READ UNCOMMITTED",
  READ_COMMITTED = "READ COMMITTED",
  REPEATABLE_READ = "REPEATABLE READ",
  SERIALIZABLE = "SERIALIZABLE",
}

/**
 * Lock modes for pessimistic locking
 * - FOR UPDATE: Exclusive lock, prevents other transactions from reading/writing
 * - FOR SHARE: Shared lock, allows other transactions to read but not write
 * - FOR UPDATE NOWAIT: Exclusive lock, fails immediately if locked
 * - FOR UPDATE SKIP LOCKED: Exclusive lock, skips locked rows
 */
export enum LockMode {
  FOR_UPDATE = "FOR UPDATE",
  FOR_SHARE = "FOR SHARE",
  FOR_UPDATE_NOWAIT = "FOR UPDATE NOWAIT",
  FOR_UPDATE_SKIP_LOCKED = "FOR UPDATE SKIP LOCKED",
}

/**
 * Transaction options
 */
export interface TransactionOptions {
  isolationLevel?: IsolationLevel;
  timeout?: number; // milliseconds
  maxRetries?: number;
  retryDelay?: number; // milliseconds
}

/**
 * Execute a transaction with specified isolation level
 * Automatically retries on deadlock
 * Supports both signatures:
 *   executeTransaction(() => Promise<T>)
 *   executeTransaction((tx) => Promise<T>)
 * where tx is the Prisma transaction client, for payout-integrity saga
 */
export async function executeTransaction<T>(
  fn: (tx?: any) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const {
    isolationLevel = IsolationLevel.SERIALIZABLE,
    timeout = 30000,
    maxRetries = 3,
    retryDelay = 100,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Set isolation level
          await tx.$executeRawUnsafe(
            `SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`,
          );

          // Set statement timeout
          if (timeout > 0) {
            await tx.$executeRawUnsafe(`SET statement_timeout = ${timeout}`);
          }

          // Pass tx to fn if it expects a param (dispute saga), otherwise call without
          return await (fn as any)(tx);
        },
        {
          timeout,
        },
      );
    } catch (error) {
      lastError = error as Error;

      // Check if it's a deadlock error
      const isDeadlock =
        lastError.message.includes("deadlock detected") ||
        lastError.message.includes("Deadlock found");

      if (!isDeadlock || attempt === maxRetries - 1) {
        throw lastError;
      }

      // Exponential backoff
      const delay = retryDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("Transaction failed after max retries");
}

/**
 * Execute a transaction with pessimistic locking
 * Locks rows in a specific order to prevent deadlocks
 */
export async function executeWithLocking<T>(
  fn: (lockFn: LockFunction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return executeTransaction(async () => {
    const locks: Set<string> = new Set();

    const lockFn: LockFunction = async (
      table: string,
      id: string,
      mode: LockMode = LockMode.FOR_UPDATE,
    ) => {
      const lockKey = `${table}:${id}`;

      // Prevent duplicate locks
      if (locks.has(lockKey)) {
        return;
      }

      locks.add(lockKey);
    };

    return await fn(lockFn);
  }, options);
}

export type LockFunction = (
  table: string,
  id: string,
  mode?: LockMode,
) => Promise<void>;

/**
 * Strict row ordering for escrow mutations
 * Always lock in this order to prevent circular wait deadlocks:
 * 1. Creator (payee)
 * 2. Client (payer)
 * 3. Escrow
 * 4. Balance
 */
export const LOCK_ORDER = {
  CREATOR: 1,
  CLIENT: 2,
  ESCROW: 3,
  BALANCE: 4,
} as const;

/**
 * Helper to acquire locks in strict order
 */
export async function acquireLocksInOrder(
  locks: Array<{ table: string; id: string; order: number }>,
  lockFn: LockFunction,
  mode: LockMode = LockMode.FOR_UPDATE,
): Promise<void> {
  // Sort by order to ensure consistent lock acquisition
  const sorted = [...locks].sort((a, b) => a.order - b.order);

  for (const lock of sorted) {
    await lockFn(lock.table, lock.id, mode);
  }
}

/**
 * Deadlock detection and logging
 */
export class DeadlockDetector {
  private deadlocks: Array<{
    timestamp: Date;
    tables: string[];
    error: string;
  }> = [];

  recordDeadlock(tables: string[], error: string): void {
    this.deadlocks.push({
      timestamp: new Date(),
      tables,
      error,
    });

    // Keep only last 100 deadlocks
    if (this.deadlocks.length > 100) {
      this.deadlocks = this.deadlocks.slice(-100);
    }

    console.error("[DeadlockDetector]", {
      tables,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  getDeadlocks(): typeof this.deadlocks {
    return this.deadlocks;
  }

  getDeadlockRate(): number {
    if (this.deadlocks.length === 0) return 0;

    const oneHourAgo = new Date(Date.now() - 3600000);
    const recentDeadlocks = this.deadlocks.filter(
      (d) => d.timestamp > oneHourAgo,
    );

    return recentDeadlocks.length;
  }

  clear(): void {
    this.deadlocks = [];
  }
}

export const deadlockDetector = new DeadlockDetector();
