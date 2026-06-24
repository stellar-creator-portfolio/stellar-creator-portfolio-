import type {
  Bounty as ApiBounty,
  PaginatedReviews,
  PublicReview,
  ReputationAggregation,
} from '@/lib/api-models';
import type { Bounty as SourceBounty } from '@/lib/services/creators-data';
import type { Review } from '@/lib/services/review-service';

export function toApiBounty(bounty: SourceBounty): ApiBounty {
  return {
    id: bounty.id,
    title: bounty.title,
    description: bounty.description,
    budget: bounty.budget,
    currency: bounty.currency,
    deadline: bounty.deadline.toISOString(),
    difficulty: bounty.difficulty,
    category: bounty.category,
    tags: bounty.tags,
    applicants: bounty.applicants,
    status: bounty.status,
    requiredSkills: bounty.requiredSkills,
    deliverables: bounty.deliverables,
    creatorAddress: bounty.postedBy,
  };
}

export function toPublicReview(review: Review): PublicReview {
  return {
    id: review.id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    reviewerName: review.reviewerName,
    createdAt: review.createdAt,
  };
}

export function toReputationAggregation(reviews: Review[]): ReputationAggregation {
  const totalReviews = reviews.length;
  const averageRating =
    totalReviews === 0
      ? 0
      : Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / totalReviews) * 10) / 10;

  return {
    averageRating,
    totalReviews,
    stars5: reviews.filter((review) => review.rating === 5).length,
    stars4: reviews.filter((review) => review.rating === 4).length,
    stars3: reviews.filter((review) => review.rating === 3).length,
    stars2: reviews.filter((review) => review.rating === 2).length,
    stars1: reviews.filter((review) => review.rating === 1).length,
    isVerified: totalReviews >= 3 && averageRating >= 4.5,
    reliabilityScore:
      totalReviews === 0 ? 0 : Math.round(Math.min(1, (averageRating / 5) * (totalReviews / 3)) * 100) / 100,
  };
}

export function toPaginatedReviews(reviews: Review[], total: number, page: number, limit: number): PaginatedReviews {
  return {
    reviews: reviews.map(toPublicReview),
    totalCount: total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}

export function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
