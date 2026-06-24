import { NextRequest, NextResponse } from 'next/server';

import { apiFailure, apiSuccess, type EscrowTransactionResponse } from '@/lib/api-models';

type EscrowReleaseRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: EscrowReleaseRouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as { authorizerAddress?: string };

  if (!body.authorizerAddress?.trim()) {
    return NextResponse.json(
      apiFailure('VALIDATION_ERROR', 'authorizerAddress is required', [
        { field: 'authorizerAddress', message: 'Authorizer address is required' },
      ]),
      { status: 422 },
    );
  }

  const response: EscrowTransactionResponse = {
    escrowId: id,
    txHash: `simulated-${crypto.randomUUID()}`,
    operation: 'release',
    status: 'confirmed',
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(apiSuccess(response));
}
