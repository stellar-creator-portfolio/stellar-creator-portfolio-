import { NextRequest, NextResponse } from 'next/server';

import { apiFailure, apiSuccess } from '@/lib/api-models';
import { toPublicReview, toReputationAggregation } from '@/lib/api-route-helpers';
import { getCreatorById, isValidCreatorId } from '@/lib/services/creators-data';
import { getReviewsForCreator } from '@/lib/services/review-service';

type CreatorRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: CreatorRouteContext) {
  const { id } = await context.params;

  if (!isValidCreatorId(id)) {
    return NextResponse.json(apiFailure('BAD_REQUEST', 'Invalid creator id'), { status: 400 });
  }

  const creator = getCreatorById(id);
  if (!creator) {
    return NextResponse.json(apiFailure('NOT_FOUND', 'Creator not found'), { status: 404 });
  }

  const { reviews } = getReviewsForCreator(id);

  return NextResponse.json(
    apiSuccess({
      creatorId: id,
      aggregation: toReputationAggregation(reviews),
      recentReviews: reviews.slice(0, 3).map(toPublicReview),
    }),
  );
}
