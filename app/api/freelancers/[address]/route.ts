import { NextRequest, NextResponse } from 'next/server';

import { apiFailure, apiSuccess } from '@/lib/api-models';
import { getCreatorById, isValidCreatorId } from '@/lib/services/creators-data';

type FreelancerRouteContext = {
  params: Promise<{
    address: string;
  }>;
};

export async function GET(_request: NextRequest, context: FreelancerRouteContext) {
  const { address } = await context.params;

  if (!isValidCreatorId(address)) {
    return NextResponse.json(apiFailure('BAD_REQUEST', 'Invalid freelancer address'), { status: 400 });
  }

  const freelancer = getCreatorById(address);
  if (!freelancer) {
    return NextResponse.json(apiFailure('NOT_FOUND', 'Freelancer not found'), { status: 404 });
  }

  return NextResponse.json(apiSuccess(freelancer));
}
