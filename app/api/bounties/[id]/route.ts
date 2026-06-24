import { NextRequest, NextResponse } from 'next/server';

import { apiFailure, apiSuccess } from '@/lib/api-models';
import { toApiBounty } from '@/lib/api-route-helpers';
import { getBountyById } from '@/lib/services/creators-data';

type BountyRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: BountyRouteContext) {
  const { id } = await context.params;
  const bounty = getBountyById(id);

  if (!bounty) {
    return NextResponse.json(apiFailure('NOT_FOUND', 'Bounty not found'), { status: 404 });
  }

  return NextResponse.json(apiSuccess(toApiBounty(bounty)));
}
