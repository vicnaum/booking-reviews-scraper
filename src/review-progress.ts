export interface ReviewScrapeProgressInput {
  currentPage: number;
  totalPages?: number;
}

export interface ScrapeProgressFractionInput {
  listingIndex: number;
  listingCount: number;
  currentPage: number;
  totalPages?: number;
}

export function shouldEmitReviewProgressEvent(
  input: ReviewScrapeProgressInput,
): boolean {
  const { currentPage, totalPages } = input;

  if (currentPage <= 1) {
    return true;
  }

  if (totalPages != null && currentPage >= totalPages) {
    return true;
  }

  const interval =
    totalPages != null
      ? totalPages >= 200
        ? 20
        : totalPages >= 80
          ? 10
          : totalPages >= 30
            ? 5
            : 2
      : 5;

  return currentPage % interval === 0;
}

export function formatReviewProgressLabel(input: {
  platform: 'airbnb' | 'booking';
  listingId: string;
  currentPage: number;
  totalPages?: number;
}): string {
  const platformLabel = input.platform === 'airbnb' ? 'Airbnb' : 'Booking';
  const pageLabel =
    input.totalPages != null
      ? `page ${input.currentPage}/${input.totalPages}`
      : `page ${input.currentPage}`;

  return `${platformLabel} reviews · ${input.listingId} · ${pageLabel}`;
}

export function getScrapeProgressFraction(
  input: ScrapeProgressFractionInput,
): number {
  const totalListings = Math.max(1, input.listingCount);
  const listingIndex = Math.min(totalListings, Math.max(1, input.listingIndex));
  const perListingFraction =
    input.totalPages != null && input.totalPages > 0
      ? Math.min(1, Math.max(0, input.currentPage / input.totalPages))
      : Math.min(0.98, Math.max(0.05, input.currentPage / 10));

  return Math.min(
    1,
    Math.max(0, ((listingIndex - 1) + perListingFraction) / totalListings),
  );
}
