'use client';

import { useEffect, useState } from 'react';
import type { ApiResponse, CreatorReputationPayload, PublicReview, ReputationAggregation } from '@/lib/api-models';
import { isApiSuccess } from '@/lib/api-models';
import { ReviewList } from '@/components/review-list';
import { ReviewFilters, type ReviewFilterOptions } from '@/components/review-filters';
import { ReviewForm } from '@/components/review-form';
import { ErrorAlert } from '@/components/error-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, ChevronLeft, ChevronRight, Info, Star } from 'lucide-react';
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from '@/components/ui/tooltip';
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface FilteredReputationPayload {
  creatorId: string;
  aggregation: ReputationAggregation;
  filteredAggregation?: ReputationAggregation;
  reviews: {
    reviews: PublicReview[];
    totalCount: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  appliedFilters: ReviewFilterOptions;
}

function StarRow({ value, max = 5 }: { value: number; max?: number }) {
  const rounded = Math.round(value);
  return (
    <div className="flex gap-0.5" aria-label={`${value.toFixed(2)} out of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          size={16}
          className={i < rounded ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground/40'}
          aria-hidden
        />
      ))}
    </div>
  );
}

function Histogram({
  aggregation,
  title = "Rating breakdown"
}: {
  aggregation: ReputationAggregation;
  title?: string;
}) {
  const total = aggregation.totalReviews;
  if (total === 0) return null;

  const rows: { label: string; count: number }[] = [
    { label: '5 stars', count: aggregation.stars5 },
    { label: '4 stars', count: aggregation.stars4 },
    { label: '3 stars', count: aggregation.stars3 },
    { label: '2 stars', count: aggregation.stars2 },
    { label: '1 star', count: aggregation.stars1 },
  ];

  return (
    <div className="space-y-2 mt-6" aria-label="Rating breakdown">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {rows.map((row) => {
        const pct = Math.round((row.count / total) * 100);
        return (
          <div key={row.label} className="flex items-center gap-3 text-sm">
            <span className="w-16 text-muted-foreground shrink-0">{row.label}</span>
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 text-right tabular-nums text-muted-foreground">{row.count}</span>
          </div>
        );
      })}
    </div>
  );
}

export function CreatorReputation({ creatorId }: { creatorId: string }) {
  const [payload, setPayload] = useState<FilteredReputationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [filters, setFilters] = useState<ReviewFilterOptions>({
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });

  const loadReviews = async (newFilters: ReviewFilterOptions) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams();
      Object.entries(newFilters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.set(key, value.toString());
        }
      });
      
      const queryString = params.toString();
      const url = `${API_BASE}/api/creators/${encodeURIComponent(creatorId)}/reviews${queryString ? `?${queryString}` : ''}`;
      
      const res = await fetch(url, { 
        headers: { Accept: 'application/json' } 
      });
      
      if (!res.ok) {
        setError('Failed to load reviews');
        return;
      }
      
      const body = (await res.json()) as ApiResponse<FilteredReputationPayload>;
      if (isApiSuccess(body)) {
        setPayload(body.data);
        setError(null);
      } else {
        setError(body.error.message || 'Failed to load reviews');
      }
    } catch (err) {
      setError('Failed to load reviews');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReviews(filters);
  }, [creatorId, filters]);

  const handleFiltersChange = (newFilters: ReviewFilterOptions) => {
    setFilters(newFilters);
  };

  const handlePageChange = (newPage: number) => {
    setFilters(prev => ({ ...prev, page: newPage }));
  };

  if (error) {
    return (
      <section className="border-b border-border bg-muted/20 py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-foreground mb-8">Client reviews</h2>
          <ErrorAlert message={error} onDismiss={() => setError(null)} />
        </div>
      </section>
    );
  }

  // Return null while loading or if no payload exists
  if (isLoading || !payload) {
    return null;
  }

  const { aggregation, filteredAggregation, reviews } = payload;
  const displayAggregation = filteredAggregation || aggregation;
  const hasFilters = filteredAggregation !== undefined;

  // Return empty section if no reviews, but show form option
  if (aggregation.totalReviews === 0 && !showReviewForm) {
    return (
      <section className="border-b border-border bg-muted/20 py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">No reviews yet</h2>
          <p className="text-muted-foreground mb-8">Be the first to share your experience working with this creator.</p>
          <Button onClick={() => setShowReviewForm(true)}>Write a Review</Button>
          {showReviewForm && (
            <div className="mt-8 text-left max-w-2xl mx-auto">
              <ReviewForm 
                creatorId={creatorId} 
                creatorName="this creator" 
                bountyId={`demo-${Math.random().toString(36).substring(7)}`}
                onSuccess={() => {
                  setShowReviewForm(false);
                  loadReviews(filters);
                }}
              />
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="border-b border-border bg-muted/20 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-foreground">Client reviews</h2>
              {aggregation.isVerified && (
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 px-3 py-1 gap-1.5 rounded-full hover:bg-emerald-500/15 transition-colors">
                  <CheckCircle size={14} className="fill-emerald-600/10" />
                  Verified Creator
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              Ratings from verified clients who worked with this creator.
            </p>
          </div>
          
          <Button 
            onClick={() => setShowReviewForm(!showReviewForm)}
            variant={showReviewForm ? "outline" : "default"}
          >
            {showReviewForm ? "Cancel Review" : "Write a Review"}
          </Button>
        </div>

        {showReviewForm && (
          <div className="mb-12 animate-in fade-in slide-in-from-top-4 duration-300">
            <ReviewForm 
              creatorId={creatorId} 
              creatorName="this creator" 
              bountyId={`demo-${Math.random().toString(36).substring(7)}`}
              onSuccess={() => {
                setShowReviewForm(false);
                loadReviews(filters); // Refresh reviews
              }}
              onCancel={() => setShowReviewForm(false)}
            />
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
            <div className="text-center sm:text-left">
              <div className="text-4xl font-bold text-primary tabular-nums">
                {displayAggregation.averageRating.toFixed(2)}
              </div>
              <div className="text-sm text-muted-foreground">out of 5</div>
            </div>
            <div className="flex flex-col gap-2">
              <StarRow value={displayAggregation.averageRating} />
              <p className="text-sm text-muted-foreground">
                Based on {displayAggregation.totalReviews}{' '}
                {displayAggregation.totalReviews === 1 ? 'review' : 'reviews'}
                {hasFilters && ` (filtered from ${aggregation.totalReviews} total)`}
              </p>
            </div>
            
            {/* Reliability Index - NEW FEATURE #364 */}
            <div className="flex-1 flex justify-end">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 flex flex-col items-center min-w-[140px] cursor-help transition-all hover:bg-primary/10 group">
                      <div className="text-2xl font-bold text-primary group-hover:scale-110 transition-transform">
                        {Math.round(aggregation.reliabilityScore * 100)}%
                      </div>
                      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-primary/60 mt-1">
                        Reliability Index
                        <Info size={10} />
                      </div>
                      <div className="w-full h-1 bg-primary/20 rounded-full mt-3 overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-1000 ease-out" 
                          style={{ width: `${Math.round(aggregation.reliabilityScore * 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2 text-center leading-tight">
                        Weighted by recency & <br/>review consistency
                      </p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs p-3">
                    <p className="text-xs leading-relaxed">
                      This index uses a time-decayed algorithm where recent reviews have more weight. 
                      It also factors in rating consistency to provide a realistic measure of current performance.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <Histogram 
            aggregation={displayAggregation} 
            title={hasFilters ? "Filtered rating breakdown" : "Rating breakdown"}
          />

          {/* Show overall stats when filtered */}
          {hasFilters && (
            <div className="mt-6 p-4 bg-muted/50 rounded-lg">
              <h4 className="text-sm font-semibold mb-2">Overall Statistics</h4>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>Total Reviews: {aggregation.totalReviews}</span>
                <span>Overall Rating: {aggregation.averageRating.toFixed(2)}</span>
                <span>Verified: {aggregation.isVerified ? 'Yes' : 'No'}</span>
              </div>
            </div>
          )}

          <div className="mt-10">
            <ReviewFilters
              filters={filters}
              onFiltersChange={handleFiltersChange}
              totalReviews={reviews?.totalCount || 0}
              isLoading={isLoading}
            />
            
            <ReviewList reviews={reviews?.reviews || []} />
            
            {/* Pagination */}
            {reviews && reviews.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-6 border-t">
                <div className="text-sm text-muted-foreground">
                  Page {reviews.page} of {reviews.totalPages} 
                  ({reviews.totalCount} total reviews)
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(reviews.page - 1)}
                    disabled={!reviews.hasPrev || isLoading}
                  >
                    <ChevronLeft size={16} />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(reviews.page + 1)}
                    disabled={!reviews.hasNext || isLoading}
                  >
                    Next
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
