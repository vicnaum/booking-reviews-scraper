import type { Platform } from '../types.js';

export const REVIEW_JOB_DUPLICATE_DETECTOR_VERSION =
  'cross-platform-property-v1';
export const REVIEW_JOB_DUPLICATE_CANDIDATE_RADIUS_METERS = 250;

export type DuplicatePairConfidence =
  | 'likely_same'
  | 'possible_same';
export type DuplicatePairDecision =
  | 'suggested'
  | 'confirmed'
  | 'dismissed';
export type DuplicatePairDecisionSource = 'detector' | 'user';
export type DuplicateNameSource = 'card' | 'host' | 'address' | 'none';

export interface DuplicateListingInput {
  listingId: string;
  platform: Platform;
  name: string;
  coordinates: { lat: number; lng: number } | null;
  propertyType?: string | null;
  details?: unknown;
}

export interface DuplicateNameEvidence {
  score: number;
  source: DuplicateNameSource;
  airbnbName: string | null;
  bookingName: string;
  sharedDistinctiveTokens: string[];
  exactAddressMatch: boolean;
}

export interface DetectedReviewJobDuplicatePair {
  airbnbListingId: string;
  bookingListingId: string;
  detectorVersion: string;
  confidence: DuplicatePairConfidence;
  distanceMeters: number;
  nameScore: number;
  nameSource: DuplicateNameSource;
  evidence: {
    airbnbCardName: string;
    airbnbHostName: string | null;
    bookingName: string;
    sharedDistinctiveTokens: string[];
    exactAddressMatch: boolean;
    mutualNearest: boolean;
    ambiguousStrongName: boolean;
  };
}

const EARTH_RADIUS_METERS = 6_371_000;
const NAME_STOP_WORDS = new Set([
  'a',
  'accommodation',
  'accommodations',
  'an',
  'and',
  'apartment',
  'apartments',
  'apt',
  'at',
  'boutique',
  'by',
  'hotel',
  'hotels',
  'hostel',
  'hostels',
  'in',
  'inn',
  'lodging',
  'private',
  'property',
  'resort',
  'room',
  'rooms',
  'stay',
  'stays',
  'suite',
  'suites',
  'the',
]);
const NON_DISTINCTIVE_LOCATION_TOKENS = new Set([
  'brooklyn',
  'chinatown',
  'city',
  'downtown',
  'east',
  'les',
  'lower',
  'manhattan',
  'midtown',
  'new',
  'nyc',
  'queens',
  'side',
  'soho',
  'tribeca',
  'upper',
  'west',
  'york',
]);
// Real-job negative controls: a private profile and an inventory reseller,
// neither of which is evidence of the property's identity.
const UNTRUSTED_AIRBNB_HOST_NAMES = new Set([
  'jeniffer',
  'roompicks',
]);

function isTrustedAirbnbHostName(value: string): boolean {
  const normalized = normalizeDuplicateName(value);
  const tokens = normalized.split(' ').filter(Boolean);
  const compact = tokens.join('');
  return (
    !UNTRUSTED_AIRBNB_HOST_NAMES.has(compact)
    && !tokens.some((token) =>
      UNTRUSTED_AIRBNB_HOST_NAMES.has(token))
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return (
    value != null
    && typeof value === 'object'
    && !Array.isArray(value)
  )
    ? value as Record<string, unknown>
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null;
}

function getNestedString(
  value: unknown,
  keys: string[],
): string | null {
  let current: unknown = value;
  for (const key of keys) {
    current = asRecord(current)?.[key];
  }
  return asNonEmptyString(current);
}

export function getDuplicateHostName(details: unknown): string | null {
  return getNestedString(details, ['host', 'name']);
}

export function getDuplicateAddress(details: unknown): string | null {
  const record = asRecord(details);
  if (!record) return null;
  const address = record.address;
  return (
    asNonEmptyString(address)
    ?? getNestedString(address, ['full'])
    ?? getNestedString(address, ['address'])
  );
}

function normalizeUnicode(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeDuplicateName(value: string): string {
  return normalizeUnicode(value)
    .split(' ')
    .filter((token) => token && !NAME_STOP_WORDS.has(token))
    .join(' ');
}

function nameTokens(value: string): string[] {
  return normalizeDuplicateName(value).split(' ').filter(Boolean);
}

function isDistinctiveToken(token: string): boolean {
  return (
    token.length >= 3
    && !/^\d+$/.test(token)
    && !NAME_STOP_WORDS.has(token)
    && !NON_DISTINCTIVE_LOCATION_TOKENS.has(token)
  );
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  let previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (
      let rightIndex = 1;
      rightIndex <= right.length;
      rightIndex += 1
    ) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function scoreNames(
  leftName: string,
  rightName: string,
): {
  score: number;
  sharedDistinctiveTokens: string[];
} {
  const left = normalizeDuplicateName(leftName);
  const right = normalizeDuplicateName(rightName);
  if (!left || !right) {
    return { score: 0, sharedDistinctiveTokens: [] };
  }

  const leftTokens = new Set(nameTokens(left));
  const rightTokens = new Set(nameTokens(right));
  const sharedTokens = [...leftTokens].filter((token) =>
    rightTokens.has(token));
  const sharedDistinctiveTokens = sharedTokens.filter(isDistinctiveToken);
  const unionSize =
    new Set([...leftTokens, ...rightTokens]).size;
  const jaccard =
    unionSize > 0 ? sharedTokens.length / unionSize : 0;
  const containment =
    sharedTokens.length
    / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
  const edit =
    1
    - (
      levenshteinDistance(left, right)
      / Math.max(left.length, right.length)
    );
  const distinctiveContainment =
    sharedDistinctiveTokens.length > 0
      ? containment * 0.92
      : 0;

  return {
    score: Math.max(
      left === right ? 1 : 0,
      edit,
      jaccard,
      distinctiveContainment,
    ),
    sharedDistinctiveTokens,
  };
}

function normalizeAddress(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeUnicode(value)
    .replace(/\b(?:apt|apartment|room|suite|unit)\s*[a-z0-9-]+\b/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized && /\d/.test(normalized) ? normalized : null;
}

function getNameEvidence(
  airbnb: DuplicateListingInput,
  booking: DuplicateListingInput,
): DuplicateNameEvidence {
  const capturedHostName = getDuplicateHostName(airbnb.details);
  const hostName =
    capturedHostName
    && isTrustedAirbnbHostName(capturedHostName)
      ? capturedHostName
      : null;
  const signals = [
    {
      source: 'card' as const,
      name: airbnb.name,
      ...scoreNames(airbnb.name, booking.name),
    },
    ...(hostName
      ? [{
          source: 'host' as const,
          name: hostName,
          ...scoreNames(hostName, booking.name),
        }]
      : []),
  ].sort((left, right) =>
    right.score - left.score
    || (
      left.source === 'host' ? -1 : 1
    ));

  const airbnbAddress = normalizeAddress(
    getDuplicateAddress(airbnb.details),
  );
  const bookingAddress = normalizeAddress(
    getDuplicateAddress(booking.details),
  );
  const exactAddressMatch =
    airbnbAddress != null
    && bookingAddress != null
    && airbnbAddress === bookingAddress;
  const strongest = signals[0];

  return {
    score: exactAddressMatch ? 1 : strongest?.score ?? 0,
    source: exactAddressMatch
      ? 'address'
      : strongest?.source ?? 'none',
    airbnbName: exactAddressMatch
      ? getDuplicateAddress(airbnb.details)
      : strongest?.name ?? null,
    bookingName: booking.name,
    sharedDistinctiveTokens:
      strongest?.sharedDistinctiveTokens ?? [],
    exactAddressMatch,
  };
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function duplicateDistanceMeters(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number },
): number {
  const leftLat = toRadians(left.lat);
  const rightLat = toRadians(right.lat);
  const deltaLat = rightLat - leftLat;
  const deltaLng = toRadians(right.lng - left.lng);
  const haversine =
    Math.sin(deltaLat / 2) ** 2
    + (
      Math.cos(leftLat)
      * Math.cos(rightLat)
      * Math.sin(deltaLng / 2) ** 2
    );
  return (
    2
    * EARTH_RADIUS_METERS
    * Math.atan2(
      Math.sqrt(haversine),
      Math.sqrt(1 - haversine),
    )
  );
}

interface PairCandidate {
  airbnb: DuplicateListingInput;
  booking: DuplicateListingInput;
  distanceMeters: number;
  name: DuplicateNameEvidence;
}

function candidateKey(
  airbnbListingId: string,
  bookingListingId: string,
): string {
  return `${airbnbListingId}\u0000${bookingListingId}`;
}

function isStrongName(candidate: PairCandidate): boolean {
  return (
    candidate.name.exactAddressMatch
    || (
      candidate.name.score >= 0.82
      && candidate.name.sharedDistinctiveTokens.length > 0
    )
  );
}

export function detectReviewJobDuplicatePairs(
  listings: DuplicateListingInput[],
): DetectedReviewJobDuplicatePair[] {
  const airbnbListings = listings.filter(
    (listing) =>
      listing.platform === 'airbnb'
      && listing.coordinates != null,
  );
  const bookingListings = listings.filter(
    (listing) =>
      listing.platform === 'booking'
      && listing.coordinates != null,
  );
  const candidates: PairCandidate[] = [];

  for (const airbnb of airbnbListings) {
    for (const booking of bookingListings) {
      const distanceMeters = duplicateDistanceMeters(
        airbnb.coordinates!,
        booking.coordinates!,
      );
      if (
        distanceMeters
        > REVIEW_JOB_DUPLICATE_CANDIDATE_RADIUS_METERS
      ) {
        continue;
      }
      candidates.push({
        airbnb,
        booking,
        distanceMeters,
        name: getNameEvidence(airbnb, booking),
      });
    }
  }

  const nearestBookingByAirbnb = new Map<string, string>();
  for (const airbnb of airbnbListings) {
    const nearest = candidates
      .filter((candidate) =>
        candidate.airbnb.listingId === airbnb.listingId)
      .sort((left, right) =>
        left.distanceMeters - right.distanceMeters
        || left.booking.listingId.localeCompare(
          right.booking.listingId,
        ))[0];
    if (nearest) {
      nearestBookingByAirbnb.set(
        airbnb.listingId,
        nearest.booking.listingId,
      );
    }
  }
  const nearestAirbnbByBooking = new Map<string, string>();
  for (const booking of bookingListings) {
    const nearest = candidates
      .filter((candidate) =>
        candidate.booking.listingId === booking.listingId)
      .sort((left, right) =>
        left.distanceMeters - right.distanceMeters
        || left.airbnb.listingId.localeCompare(
          right.airbnb.listingId,
        ))[0];
    if (nearest) {
      nearestAirbnbByBooking.set(
        booking.listingId,
        nearest.airbnb.listingId,
      );
    }
  }

  const strongByAirbnb = new Map<string, number>();
  const strongByBooking = new Map<string, number>();
  for (const candidate of candidates.filter(isStrongName)) {
    strongByAirbnb.set(
      candidate.airbnb.listingId,
      (strongByAirbnb.get(candidate.airbnb.listingId) ?? 0) + 1,
    );
    strongByBooking.set(
      candidate.booking.listingId,
      (strongByBooking.get(candidate.booking.listingId) ?? 0) + 1,
    );
  }

  return candidates
    .map((candidate) => {
      const mutualNearest =
        nearestBookingByAirbnb.get(candidate.airbnb.listingId)
          === candidate.booking.listingId
        && nearestAirbnbByBooking.get(candidate.booking.listingId)
          === candidate.airbnb.listingId;
      const strong = isStrongName(candidate);
      const ambiguousStrongName =
        strong
        && (
          (strongByAirbnb.get(candidate.airbnb.listingId) ?? 0) > 1
          || (strongByBooking.get(candidate.booking.listingId) ?? 0) > 1
        );
      return {
        airbnbListingId: candidate.airbnb.listingId,
        bookingListingId: candidate.booking.listingId,
        detectorVersion:
          REVIEW_JOB_DUPLICATE_DETECTOR_VERSION,
        confidence:
          strong && !ambiguousStrongName
            ? 'likely_same' as const
            : 'possible_same' as const,
        distanceMeters: candidate.distanceMeters,
        nameScore: candidate.name.score,
        nameSource: candidate.name.source,
        evidence: {
          airbnbCardName: candidate.airbnb.name,
          airbnbHostName: getDuplicateHostName(
            candidate.airbnb.details,
          ),
          bookingName: candidate.booking.name,
          sharedDistinctiveTokens:
            candidate.name.sharedDistinctiveTokens,
          exactAddressMatch: candidate.name.exactAddressMatch,
          mutualNearest,
          ambiguousStrongName,
        },
      };
    })
    .sort((left, right) =>
      (
        left.confidence === right.confidence
          ? 0
          : left.confidence === 'likely_same'
            ? -1
            : 1
      )
      || right.nameScore - left.nameScore
      || left.distanceMeters - right.distanceMeters
      || candidateKey(
        left.airbnbListingId,
        left.bookingListingId,
      ).localeCompare(candidateKey(
        right.airbnbListingId,
        right.bookingListingId,
      )));
}
