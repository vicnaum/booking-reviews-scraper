import type {
  ReviewJobDuplicatePair,
  ReviewJobListing,
} from '../types.js';
import { getListingResultsSnapshot } from './results.js';

const TIER_RANK = new Map([
  ['top_pick', 0],
  ['shortlist', 1],
  ['consider', 2],
  ['unlikely', 3],
  ['no_go', 4],
]);

export function duplicateListingKeys(
  pair: Pick<
    ReviewJobDuplicatePair,
    'airbnbListingId' | 'bookingListingId'
  >,
): [string, string] {
  return [
    `airbnb:${pair.airbnbListingId}`,
    `booking:${pair.bookingListingId}`,
  ];
}

export function isActiveDuplicatePair(
  pair: Pick<
    ReviewJobDuplicatePair,
    'decision' | 'detectorConfidence'
  >,
): boolean {
  return (
    pair.decision === 'confirmed'
    || (
      pair.decision === 'suggested'
      && pair.detectorConfidence === 'likely_same'
    )
  );
}

export function isMaterialDuplicateConflict(
  pair: ReviewJobDuplicatePair,
  listingsByKey: ReadonlyMap<string, ReviewJobListing>,
): boolean {
  if (!isActiveDuplicatePair(pair)) return false;
  const [airbnbKey, bookingKey] = duplicateListingKeys(pair);
  const airbnb = listingsByKey.get(airbnbKey);
  const booking = listingsByKey.get(bookingKey);
  if (!airbnb || !booking) return false;

  const airbnbTier = getListingResultsSnapshot(airbnb).triage?.tier;
  const bookingTier = getListingResultsSnapshot(booking).triage?.tier;
  const airbnbRank = airbnbTier ? TIER_RANK.get(airbnbTier) : null;
  const bookingRank = bookingTier ? TIER_RANK.get(bookingTier) : null;
  return (
    airbnbRank != null
    && bookingRank != null
    && Math.abs(airbnbRank - bookingRank) >= 2
  );
}

export function getMaterialDuplicateConflictKeys(
  pairs: ReviewJobDuplicatePair[],
  listings: ReviewJobListing[],
): Set<string> {
  const listingsByKey = new Map(
    listings.map((listing) => [
      `${listing.platform}:${listing.id}`,
      listing,
    ]),
  );
  const keys = new Set<string>();
  for (const pair of pairs) {
    if (!isMaterialDuplicateConflict(pair, listingsByKey)) continue;
    for (const key of duplicateListingKeys(pair)) keys.add(key);
  }
  return keys;
}
