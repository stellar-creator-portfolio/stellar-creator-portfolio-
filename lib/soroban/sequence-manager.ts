import { prisma } from "@/lib/prisma";

export interface SequenceLock {
  accountId: string;
  lockedAt: Date;
  lockedBy: string;
  sequence: bigint;
  expiresAt: Date;
}

export class SequenceManager {
  private accountId: string;
  private localQueue: Array<{
    id: string;
    resolve: (seq: bigint) => void;
    reject: (err: Error) => void;
  }> = [];
  private isProcessing = false;
  private _shuttingDown = false;
  private currentRequest: {
    id: string;
    resolve: (seq: bigint) => void;
    reject: (err: Error) => void;
  } | null = null;
  private lockTimeout: number;
  private maxRetries = 3;
  private fetchSequenceFn: () => Promise<bigint>;

  constructor(
    accountId: string,
    options?: {
      fetchSequenceFn?: () => Promise<bigint>;
      lockTimeout?: number;
    },
  ) {
    this.accountId = accountId;
    this.fetchSequenceFn =
      options?.fetchSequenceFn ?? this.defaultFetchSequence.bind(this);
    this.lockTimeout =
      options?.lockTimeout ??
      parseInt(process.env.SOROBAN_LOCK_TIMEOUT_MS ?? "5000", 10);
  }

  async getNextSequence(): Promise<bigint> {
    return new Promise((resolve, reject) => {
      this.localQueue.push({
        id: `${Date.now()}-${Math.random()}`,
        resolve,
        reject,
      });

      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  drainQueue(): void {
    this._shuttingDown = true;
    const err = new Error("SequenceManager: shutting down");

    if (this.currentRequest) {
      this.currentRequest.reject(err);
      this.currentRequest = null;
    }

    for (const request of this.localQueue) {
      request.reject(err);
    }
    this.localQueue = [];
    this.isProcessing = false;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.localQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.localQueue.length > 0 && !this._shuttingDown) {
        const request = this.localQueue.shift();
        if (!request) break;

        this.currentRequest = request;
        try {
          const sequence = await this.acquireSequenceWithLock(request.id);
          if (this._shuttingDown) {
            this.currentRequest?.reject(
              new Error("SequenceManager: shutting down"),
            );
            return;
          }
          request.resolve(sequence);
        } catch (error) {
          request.reject(error as Error);
        } finally {
          this.currentRequest = null;
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async acquireSequenceWithLock(
    transactionId: string,
  ): Promise<bigint> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const acquired = await this.tryAcquireLock(transactionId);
        if (!acquired) {
          await this.sleep(100 * Math.pow(2, attempt));
          continue;
        }

        try {
          const currentSequence = await this.fetchSequenceFn();
          const nextSequence = currentSequence + 1n;

          await this.updateLockSequence(transactionId, nextSequence);

          return nextSequence;
        } finally {
          await this.releaseLock(transactionId);
        }
      } catch (error) {
        lastError = error as Error;

        if ((error as Error).message.includes("lock timeout")) {
          continue;
        }

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

  private async tryAcquireLock(transactionId: string): Promise<boolean> {
    const now = new Date();

    const result = await prisma.sequenceLock.updateMany({
      where: {
        accountId: this.accountId,
        OR: [
          { lockedBy: "" },
          { expiresAt: { lt: now } },
        ],
      },
      data: {
        lockedBy: transactionId,
        lockedAt: now,
        expiresAt: new Date(Date.now() + this.lockTimeout),
      },
    });

    if (result.count === 1) {
      return true;
    }

    try {
      await prisma.sequenceLock.create({
        data: {
          accountId: this.accountId,
          lockedBy: transactionId,
          lockedAt: now,
          expiresAt: new Date(Date.now() + this.lockTimeout),
          sequence: 0n,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  private async releaseLock(transactionId: string): Promise<void> {
    try {
      await prisma.sequenceLock.updateMany({
        where: {
          accountId: this.accountId,
          lockedBy: transactionId,
        },
        data: {
          lockedBy: "",
          expiresAt: new Date(),
        },
      });
    } catch (error) {
      console.error(`Failed to release lock: ${(error as Error).message}`);
    }
  }

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

  private async defaultFetchSequence(): Promise<bigint> {
    const lock = await prisma.sequenceLock.findUnique({
      where: { accountId: this.accountId },
    });

    return lock?.sequence ?? 0n;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const managers = new Map<string, SequenceManager>();

export function getSequenceManager(
  accountId: string,
  options?: { fetchSequenceFn?: () => Promise<bigint>; lockTimeout?: number },
): SequenceManager {
  if (!managers.has(accountId)) {
    managers.set(accountId, new SequenceManager(accountId, options));
  }
  return managers.get(accountId)!;
}

export function clearSequenceManagers(): void {
  managers.clear();
}
