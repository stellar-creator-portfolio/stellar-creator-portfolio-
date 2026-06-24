import { NextRequest, NextResponse } from 'next/server';

import { apiSuccess } from '@/lib/api-models';

type WebhookPayload = {
  escrow_id?: string;
};

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as Partial<WebhookPayload>;

  return NextResponse.json(
    apiSuccess({
      received: true,
      escrow_id: payload.escrow_id ?? 'unknown',
      action_taken: 'acknowledged',
    }),
  );
}
