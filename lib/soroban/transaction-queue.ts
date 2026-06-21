import { SorobanRpc, TransactionBuilder, Account } from '@stellar/stellar-sdk';
import { RpcFallbackManager } from '../config/rpc-fallback';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();


export interface SorobanTransaction {
  fee: string;
  operation: any;
  timeout: number;
  secretKey: string;
}

export interface SubmissionResult {
  success: boolean;
  txHash: string;
  ledger?: number;
}

export class TransactionQueue {
  private rpcFallbackManager: RpcFallbackManager;
 
  private sequenceManager: any; 

  constructor(sequenceManager: any) {
    this.rpcFallbackManager = new RpcFallbackManager();
    this.sequenceManager = sequenceManager;
  }

  async submitToSoroban(
    tx: SorobanTransaction,
    account: string,
    networkPassphrase: string
  ): Promise<SubmissionResult> {
 
    let txHash: string | undefined;

    try {
      const sequence = await this.sequenceManager.getNextSequence(account);
      const preparedTx = new TransactionBuilder(
        new Account(account, sequence),
        {
          fee: tx.fee,
          networkPassphrase,
        }
      )
        .addOperation(tx.operation)
        .setTimeout(tx.timeout)
        .build();

      const signedTx = preparedTx.sign(tx.secretKey);
      txHash = signedTx.hash().toString('hex');

    
      await prisma.transactionQueue.create({
        data: {
          txHash,
          account,
          sequence,
          status: 'PENDING',
          xdr: signedTx.toXDR(),
          createdAt: new Date(),
        },
      });

     
      const rpcServer = this.rpcFallbackManager.getCurrentServer();
      const sendResponse = await rpcServer.sendTransaction(signedTx);

      if (sendResponse.status === 'ERROR') {
        throw new Error(sendResponse.error);
      }

     
      const pollResult = await this.pollTransaction(
        txHash,
        rpcServer,
        Date.now()
      );

      if (pollResult.status !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${pollResult.error}`);
      }

   
      await prisma.transactionQueue.update({
        where: { txHash },
        data: {
          status: 'SUCCESS',
          ledger: pollResult.ledger,
          resultXdr: pollResult.resultXdr,
        },
      });

      return {
        success: true,
        txHash,
        ledger: pollResult.ledger,
      };
    } catch (error: any) {
     
      if (txHash) {
        await prisma.transactionQueue.update({
          where: { txHash: txHash },
          data: {
            status: 'FAILED',
            error: error.message,
          },
        });
      }

      if (this.isRetryable(error)) {
        throw new Error(`RetryableError: ${error.message}`);
      }
      throw error;
    }
  }

  private async pollTransaction(
    txHash: string,
    rpcServer: SorobanRpc.Server,
    startTime: number,
    attempt = 0
  ): Promise<SorobanRpc.Api.GetTransactionResponse> {
    const response = await rpcServer.getTransaction(txHash);

    if (response.status === 'SUCCESS') {
      return response;
    }

    if (response.status === 'NOT_FOUND') {
     
      if (Date.now() - startTime > 60000) {
        throw new Error('Transaction polling timeout');
      }

     
      const delay = Math.min(
        4000,
        500 * Math.pow(2, Math.min(attempt, 3))
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.pollTransaction(txHash, rpcServer, startTime, attempt + 1);
    }

    throw new Error(`Transaction failed: ${response.error}`);
  }

  private isRetryable(error: any): boolean {
    return error.message && error.message.toLowerCase().includes('timeout');
  }
}