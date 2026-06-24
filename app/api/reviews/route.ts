import { NextRequest, NextResponse } from 'next/server';

import { apiFailure, apiSuccess, validateReview, type ReviewSubmission } from '@/lib/api-models';
import { toPaginatedReviews, toReputationAggregation } from '@/lib/api-route-helpers';
import { creators } from '@/lib/services/creators-data';
import { createReview, getReviewsForCreator } from '@/lib/services/review-service';

export async function GET(request: NextRequest) {
  const page = Number.parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10);
  const limit = Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10);
  const reviews = creators.flatMap((creator) =>
    getReviewsForCreator(creator.id, { limit: Number.MAX_SAFE_INTEGER }).reviews,
  );
  const start = (page - 1) * limit;
  const pagedReviews = reviews.slice(start, start + limit);

  return NextResponse.json(
    apiSuccess({
      reviews: toPaginatedReviews(pagedReviews, reviews.length, page, limit),
      overallAggregation: toReputationAggregation(reviews),
      appliedFilters: Object.fromEntries(request.nextUrl.searchParams.entries()),
    }),
  );
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<ReviewSubmission>;
  const fieldErrors = validateReview(body);

  if (fieldErrors) {
    return NextResponse.json(apiFailure('VALIDATION_ERROR', 'Invalid review submission', fieldErrors), {
      status: 422,
    });
  }

  const review = createReview({
    creatorId: body.creatorId!,
    reviewerId: body.reviewerName!,
    reviewerName: body.reviewerName!,
    rating: body.rating!,
    title: body.title!,
    body: body.body!,
    isVerifiedPurchase: true,
  });

  return NextResponse.json(apiSuccess({ reviewId: review.id }));
}
