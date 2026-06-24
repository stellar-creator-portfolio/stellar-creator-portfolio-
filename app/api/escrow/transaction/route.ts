import { NextRequest, NextResponse } from 'next/server';

import {
  apiFailure,
  apiSuccess,
  validateEscrowTransaction,
  type EscrowTransactionRequest,
  type EscrowTransactionResponse,
} from '@/lib/api-models';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<EscrowTransactionRequest>;
  const fieldErrors = validateEscrowTransaction(body);

  if (fieldErrors) {
    return NextResponse.json(apiFailure('VALIDATION_ERROR', 'Invalid escrow transaction', fieldErrors), {
      status: 422,
    });
  }

  const response: EscrowTransactionResponse = {
    escrowId: body.escrowId ?? `${body.bountyId}-${body.operation}`,
    txHash: `simulated-${crypto.randomUUID()}`,
    operation: body.operation!,
    status: 'confirmed',
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(apiSuccess(response));
}
