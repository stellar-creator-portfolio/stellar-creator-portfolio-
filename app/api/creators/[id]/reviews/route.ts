import { NextRequest, NextResponse } from 'next/server';

import { apiFailure, apiSuccess } from '@/lib/api-models';
import { parsePositiveInt, toPaginatedReviews, toReputationAggregation } from '@/lib/api-route-helpers';
import { getCreatorById, isValidCreatorId } from '@/lib/services/creators-data';
import { getReviewsForCreator } from '@/lib/services/review-service';

type CreatorRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: NextRequest, context: CreatorRouteContext) {
  const { id } = await context.params;

  if (!isValidCreatorId(id)) {
    return NextResponse.json(apiFailure('BAD_REQUEST', 'Invalid creator id'), { status: 400 });
  }

  const creator = getCreatorById(id);
  if (!creator) {
    return NextResponse.json(apiFailure('NOT_FOUND', 'Creator not found'), { status: 404 });
  }

  const { searchParams } = request.nextUrl;
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const limit = parsePositiveInt(searchParams.get('limit'), 10);
  const minRating = searchParams.get('minRating');
  const maxRating = searchParams.get('maxRating');
  const exactRating =
    minRating && maxRating && minRating === maxRating ? Number.parseInt(minRating, 10) : undefined;

  const allReviews = getReviewsForCreator(id, { limit: Number.MAX_SAFE_INTEGER }).reviews;
  const { reviews, total } = getReviewsForCreator(id, {
    page,
    limit,
    filterRating: Number.isFinite(exactRating) ? exactRating : undefined,
  });

  return NextResponse.json(
    apiSuccess({
      creatorId: id,
      aggregation: toReputationAggregation(allReviews),
      filteredAggregation: toReputationAggregation(reviews),
      reviews: toPaginatedReviews(reviews, total, page, limit),
      appliedFilters: Object.fromEntries(searchParams.entries()),
    }),
  );
}
