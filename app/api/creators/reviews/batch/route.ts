import { NextRequest, NextResponse } from "next/server";
import { apiFailure, apiSuccess } from "@/lib/api-models";
import { getReviewsForCreator } from "@/lib/services/review-service";

/**
 * POST /api/creators/reviews/batch
 * Batch fetch reviews for multiple creators
 * Prevents N+1 queries by fetching all reviews in a single request
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

    // Limit batch size to prevent abuse
    if (creatorIds.length > 100) {
      return NextResponse.json(
        apiFailure("VALIDATION_ERROR", "Maximum 100 creators per batch"),
        { status: 400 },
      );
    }

    // Fetch reviews for all creators in parallel
    const results: Record<string, any> = {};
    await Promise.all(
      creatorIds.map(async (creatorId) => {
        try {
          const { reviews, total } = await getReviewsForCreator(creatorId, {
            limit: 10,
            page: 1,
          });
          results[creatorId] = { reviews, total };
        } catch (error) {
          results[creatorId] = { reviews: [], total: 0, error: String(error) };
        }
      }),
    );

    return NextResponse.json(apiSuccess(results));
  } catch (error) {
    console.error("Batch reviews fetch error:", error);
    return NextResponse.json(
      apiFailure("INTERNAL_SERVER_ERROR", "Failed to fetch reviews"),
      { status: 500 },
    );
  }
}
