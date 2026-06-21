async submitToSoroban(
  tx: SorobanTransaction,
  account: string,
  networkPassphrase: string
): Promise<SubmissionResult> {
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
    const txHash = signedTx.hash().toString('hex');

    // Store transaction in queue before submission
    await this.prisma.transactionQueue.create({
      data: {
        txHash,
        account,
        sequence,
        status: 'PENDING',
        xdr: signedTx.toXDR(),
        createdAt: new Date(),
      },
    });

    // Submit via RPC with fallback handling
    const rpcServer = this.rpcFallbackManager.getCurrentServer();
    const sendResponse = await rpcServer.sendTransaction(signedTx);

    if (sendResponse.status === 'ERROR') {
      throw new Error(sendResponse.error);
    }

    // Poll for transaction status
    const pollResult = await this.pollTransaction(
      txHash,
      rpcServer,
      Date.now()
    );

    if (pollResult.status !== 'SUCCESS') {
      throw new Error(`Transaction failed: ${pollResult.error}`);
    }

    // Update queue on success
    await this.prisma.transactionQueue.update({
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
  } catch (error) {
    // Handle error and update queue
    await this.prisma.transactionQueue.update({
      where: { txHash: error.txHash },
      data: {
        status: 'FAILED',
        error: error.message,
      },
    });

    if (this.isRetryable(error)) {
      throw new RetryableError(error.message);
    }
    throw error;
  }
}

private async pollTransaction(
  txHash: string,
  rpcServer: SorobanRpc.Server,
  startTime: number,
  attempt = 0
): Promise<GetTransactionResponse> {
  const response = await rpcServer.getTransaction(txHash);

  if (response.status === 'SUCCESS') {
    return response;
  }

  if (response.status === 'NOT_FOUND') {
    if (Date.now() - startTime > 60000) {
      throw new Error('Transaction polling timeout');
    }

    // Adaptive polling intervals
    const delay = Math.min(
      4000,
      500 * Math.pow(2, Math.min(attempt, 3))
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
    return this.pollTransaction(txHash, rpcServer, startTime, attempt + 1);
  }

  throw new Error(`Transaction failed: ${response.error}`);
}