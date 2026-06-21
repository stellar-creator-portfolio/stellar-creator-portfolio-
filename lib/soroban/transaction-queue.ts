import { SorobanRpc } from '@stellar/stellar-sdk';
import { RpcFallbackManager } from '../config/rpc-fallback';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface SorobanSubmitFn {
  (transaction: any): Promise<any>;
}

export class TransactionQueue {
  private submitFn: SorobanSubmitFn;
  private rpcFallbackManager: RpcFallbackManager;

  constructor(submitFn: SorobanSubmitFn) {
    this.submitFn = submitFn;
    this.rpcFallbackManager = new RpcFallbackManager();
  }

  async submitToSoroban(transaction: any): Promise<any> {
    const txHash = await this.rpcFallbackManager.execute(async (endpoint) => {
      const response = await this.submitFn(transaction);
      return response;
    });

    // Polling for transaction status
    const result = await this.pollTransaction(txHash);
    if (result.status === 'SUCCESS') {
      await prisma.sorobanTransaction.create({
        data: {
          txHash: txHash,
          sequence: transaction.sequence,
          error: null
        }
      });
      return result;
    } else {
      await prisma.sorobanTransaction.create({
        data: {
          txHash: txHash,
          sequence: transaction.sequence,
          error: result.error
        }
      });
      throw new Error(result.error);
    }
  }

  private async pollTransaction(txHash: string): Promise<any> {
    const maxRetries = 12;
    const intervals = [500, 500, 500];
    let retryCount = 0;

    while (retryCount < maxRetries) {
      const status = await SorobanRpc.Server.getTransactionStatus(txHash);
      if (status === 'SUCCESS') {
        return { status: 'SUCCESS', txHash: txHash };
      } else if (status === 'ERROR' || status === 'FAILED') {
        const errorXDR = await SorobanRpc.Server.getTransactionError(txHash);
        return { status: 'ERROR', error: errorXDR };
      }
      await this.sleep(intervals[retryCount] || 4000);
      retryCount++;
    }
    throw new Error('Transaction timed out');
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
