import { NextRequest, NextResponse } from "next/server";
import { apiFailure, apiSuccess } from "@/lib/api-models";
import { getReviewsForCreator } from "@/lib/services/review-service";

/**
 * POST /api/creators/reputation/batch
 * Batch fetch reputation stats for multiple creators
 * Aggregates review data without fetching individual reviews
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { creatorIds: string[] };
    const { creatorIds } = body;

    if (!Array.isArray(creatorIds) || creatorIds.length === 0) {
      return NextResponse.json(
        apiFailure("VALIDATION_ERROR", "creatorIds must be a non-empty array"),
        { status: 400 },
      );
    }

    if (creatorIds.length > 100) {
      return NextResponse.json(
        apiFailure("VALIDATION_ERROR", "Maximum 100 creators per batch"),
        { status: 400 },
      );
    }

    const results: Record<string, any> = {};

    await Promise.all(
      creatorIds.map(async (creatorId) => {
        try {
          const { reviews, total } = await getReviewsForCreator(creatorId);

          // Calculate aggregated stats
          const avgRating =
            reviews.length > 0
              ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
              : 0;

          const ratingDistribution = {
            5: reviews.filter((r) => r.rating === 5).length,
            4: reviews.filter((r) => r.rating === 4).length,
            3: reviews.filter((r) => r.rating === 3).length,
            2: reviews.filter((r) => r.rating === 2).length,
            1: reviews.filter((r) => r.rating === 1).length,
          };

          results[creatorId] = {
            totalReviews: total,
            averageRating: Math.round(avgRating * 10) / 10,
            ratingDistribution,
            recentReviews: reviews.slice(0, 3),
          };
        } catch (error) {
          results[creatorId] = {
            totalReviews: 0,
            averageRating: 0,
            ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
            error: String(error),
          };
        }
      }),
    );

    return NextResponse.json(apiSuccess(results));
  } catch (error) {
    console.error("Batch reputation fetch error:", error);
    return NextResponse.json(
      apiFailure("INTERNAL_SERVER_ERROR", "Failed to fetch reputation data"),
      { status: 500 },
    );
  }
}
