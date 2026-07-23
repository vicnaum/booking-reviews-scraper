export const AI_REVIEW_LIMIT_ENV = 'AI_REVIEW_MAX_REVIEWS';
export const DEFAULT_AI_REVIEW_LIMIT = 250;

export interface ReviewSelection<T> {
  reviews: T[];
  eligibleCount: number;
  includedCount: number;
  limit: number;
  capped: boolean;
}

export function resolveAiReviewLimit(
  explicitValue?: number | string | null,
  envValue: string | undefined = process.env[AI_REVIEW_LIMIT_ENV],
): number {
  const rawValue =
    explicitValue != null && explicitValue !== ''
      ? explicitValue
      : envValue?.trim() || DEFAULT_AI_REVIEW_LIMIT;
  const parsed = typeof rawValue === 'number' ? rawValue : Number(rawValue);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${AI_REVIEW_LIMIT_ENV} must be a positive integer; received "${rawValue}"`,
    );
  }

  return parsed;
}

export function selectMostRecentReviews<T>(
  reviews: readonly T[],
  getDate: (review: T) => string,
  limit: number,
): ReviewSelection<T> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Review analysis limit must be a positive integer; received "${limit}"`);
  }

  const eligibleCount = reviews.length;
  if (eligibleCount <= limit) {
    return {
      reviews: [...reviews],
      eligibleCount,
      includedCount: eligibleCount,
      limit,
      capped: false,
    };
  }

  const selected = reviews
    .map((review, index) => {
      const parsedDate = Date.parse(getDate(review));
      return {
        review,
        index,
        timestamp: Number.isNaN(parsedDate) ? Number.NEGATIVE_INFINITY : parsedDate,
      };
    })
    .sort((left, right) => right.timestamp - left.timestamp || left.index - right.index)
    .slice(0, limit)
    .map(({ review }) => review);

  return {
    reviews: selected,
    eligibleCount,
    includedCount: selected.length,
    limit,
    capped: true,
  };
}
