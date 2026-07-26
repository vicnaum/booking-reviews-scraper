import {
  buildPrioritiesMatrix,
  type PrioritiesMatrix,
} from '@cli/priorities-matrix';
import type { ReviewJobListing } from '../types.js';

export function buildReviewJobPrioritiesMatrix(
  listings: ReviewJobListing[],
  options: { generatedAt?: string } = {},
): PrioritiesMatrix {
  return buildPrioritiesMatrix(
    listings.map((listing) => ({
      id: listing.id,
      platform: listing.platform,
      name: listing.name,
      url: listing.url,
      triage: listing.analysis?.triage ?? null,
      availability: {
        status: listing.staySnapshot.availability.status,
        freshness: listing.staySnapshot.freshness.availability,
        eligibility: listing.staySnapshot.bookingEligibility.status,
        reasonCode: listing.staySnapshot.bookingEligibility.reasonCode,
        reason: listing.staySnapshot.bookingEligibility.reason,
        capturedAt: listing.staySnapshot.availability.capturedAt,
        availableRange:
          listing.staySnapshot.availability.availableRange ?? null,
      },
      affordability: {
        status: listing.affordability.status,
        reasonCode: listing.affordability.reasonCode,
        reason: listing.affordability.reason,
        budgetAmount: listing.affordability.budgetAmount,
        priceAmount: listing.affordability.priceAmount,
        currency: listing.affordability.currency,
        overByAmount: listing.affordability.overByAmount,
        overByPercent: listing.affordability.overByPercent,
      },
      reviewSample: listing.analysis?.reviewSample ?? null,
    })),
    options,
  );
}
