export const STAY_SNAPSHOT_SCHEMA_VERSION = 1;

export type StaySnapshotPlatform = 'airbnb' | 'booking';
export type StaySnapshotFreshness = 'fresh' | 'stale' | 'unknown';
export type StayAvailabilityStatus = 'yes' | 'no' | 'partial' | 'unknown';

export interface StayDateRange {
  checkIn: string;
  checkOut: string;
}

export interface StayRequestFingerprint {
  platform: StaySnapshotPlatform;
  listingId: string;
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  linkedRoomId: string | null;
}

export interface PriceForStaySnapshot {
  amount: number;
  currency: string;
  basis: 'stay';
  capturedAt: string;
  source: string;
  rateType: 'public';
  mandatoryChargesResolved: boolean;
}

export interface StayAvailabilitySnapshot {
  status: StayAvailabilityStatus;
  capturedAt: string | null;
  reasonCode: string;
  availableRange?: StayDateRange;
}

export interface StayProviderEvidence {
  availabilityText?: string;
  priceText?: string;
  chargesText?: string;
  alternativeRanges?: StayDateRange[];
}

export interface StaySnapshot {
  schemaVersion: typeof STAY_SNAPSHOT_SCHEMA_VERSION;
  request: StayRequestFingerprint;
  priceForStay: PriceForStaySnapshot | null;
  availability: StayAvailabilitySnapshot;
  providerEvidence: StayProviderEvidence;
}

export interface StaySnapshotRefreshAttempt {
  attemptedAt: string;
  status: 'succeeded' | 'failed';
  error: string | null;
}

export interface StayBookingEligibility {
  status: 'eligible' | 'excluded' | 'conditional' | 'unknown';
  actionable: boolean;
  reasonCode: string;
  reason: string;
}

export interface StaySnapshotReadModel extends StaySnapshot {
  legacy: boolean;
  freshness: {
    price: StaySnapshotFreshness;
    availability: StaySnapshotFreshness;
  };
  bookingEligibility: StayBookingEligibility;
  refreshAttempt: StaySnapshotRefreshAttempt | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  );
}

function parseDateRange(value: unknown): StayDateRange | null {
  if (!isRecord(value) || !isIsoDate(value.checkIn) || !isIsoDate(value.checkOut)) {
    return null;
  }
  return {
    checkIn: value.checkIn,
    checkOut: value.checkOut,
  };
}

function parseRequestFingerprint(value: unknown): StayRequestFingerprint | null {
  if (!isRecord(value)) return null;
  if (
    (value.platform !== 'airbnb' && value.platform !== 'booking')
    || typeof value.listingId !== 'string'
    || (value.checkIn !== null && !isIsoDate(value.checkIn))
    || (value.checkOut !== null && !isIsoDate(value.checkOut))
    || (value.adults !== null
      && (typeof value.adults !== 'number'
        || !Number.isInteger(value.adults)
        || value.adults <= 0))
    || (value.linkedRoomId !== null && typeof value.linkedRoomId !== 'string')
  ) {
    return null;
  }

  return {
    platform: value.platform,
    listingId: value.listingId,
    checkIn: value.checkIn,
    checkOut: value.checkOut,
    adults: value.adults,
    linkedRoomId: value.linkedRoomId,
  };
}

function parsePriceForStay(value: unknown): PriceForStaySnapshot | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.amount !== 'number'
    || !Number.isFinite(value.amount)
    || value.amount < 0
    || typeof value.currency !== 'string'
    || !/^[A-Z]{3}$/.test(value.currency)
    || value.basis !== 'stay'
    || typeof value.capturedAt !== 'string'
    || !Number.isFinite(Date.parse(value.capturedAt))
    || typeof value.source !== 'string'
    || value.rateType !== 'public'
    || typeof value.mandatoryChargesResolved !== 'boolean'
  ) {
    return null;
  }

  return {
    amount: value.amount,
    currency: value.currency,
    basis: 'stay',
    capturedAt: value.capturedAt,
    source: value.source,
    rateType: 'public',
    mandatoryChargesResolved: value.mandatoryChargesResolved,
  };
}

function parseAvailability(value: unknown): StayAvailabilitySnapshot | null {
  if (!isRecord(value)) return null;
  if (
    value.status !== 'yes'
    && value.status !== 'no'
    && value.status !== 'partial'
    && value.status !== 'unknown'
  ) {
    return null;
  }
  if (
    (value.capturedAt !== null
      && (typeof value.capturedAt !== 'string'
        || !Number.isFinite(Date.parse(value.capturedAt))))
    || typeof value.reasonCode !== 'string'
  ) {
    return null;
  }

  const availableRange = parseDateRange(value.availableRange);
  return {
    status: value.status,
    capturedAt: value.capturedAt,
    reasonCode: value.reasonCode,
    ...(availableRange ? { availableRange } : {}),
  };
}

function parseProviderEvidence(value: unknown): StayProviderEvidence {
  if (!isRecord(value)) return {};

  const alternativeRanges = Array.isArray(value.alternativeRanges)
    ? value.alternativeRanges
        .map(parseDateRange)
        .filter((range): range is StayDateRange => range != null)
    : [];

  return {
    ...(typeof value.availabilityText === 'string'
      ? { availabilityText: value.availabilityText }
      : {}),
    ...(typeof value.priceText === 'string'
      ? { priceText: value.priceText }
      : {}),
    ...(typeof value.chargesText === 'string'
      ? { chargesText: value.chargesText }
      : {}),
    ...(alternativeRanges.length > 0 ? { alternativeRanges } : {}),
  };
}

export function parseStaySnapshot(value: unknown): StaySnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== STAY_SNAPSHOT_SCHEMA_VERSION) {
    return null;
  }

  const request = parseRequestFingerprint(value.request);
  const availability = parseAvailability(value.availability);
  if (!request || !availability) return null;

  const priceForStay =
    value.priceForStay === null ? null : parsePriceForStay(value.priceForStay);
  if (value.priceForStay !== null && !priceForStay) return null;

  return {
    schemaVersion: STAY_SNAPSHOT_SCHEMA_VERSION,
    request,
    priceForStay,
    availability,
    providerEvidence: parseProviderEvidence(value.providerEvidence),
  };
}

/**
 * A dated details artifact is reusable only when it contains provider evidence
 * that can improve the exact-stay read model. Undated details remain reusable
 * because they are not an inventory assertion.
 */
export function isStaySnapshotCacheable(snapshot: StaySnapshot): boolean {
  const requestsDates =
    snapshot.request.checkIn != null || snapshot.request.checkOut != null;
  if (!requestsDates) return true;

  return (
    snapshot.priceForStay != null
    || (
      snapshot.availability.status !== 'unknown'
      && snapshot.availability.capturedAt != null
    )
  );
}

export function parseStaySnapshotRefreshAttempt(
  value: unknown,
): StaySnapshotRefreshAttempt | null {
  if (!isRecord(value)) return null;
  if (
    (value.status !== 'succeeded' && value.status !== 'failed')
    || typeof value.attemptedAt !== 'string'
    || !Number.isFinite(Date.parse(value.attemptedAt))
    || (value.error !== null && typeof value.error !== 'string')
  ) {
    return null;
  }
  return {
    attemptedAt: value.attemptedAt,
    status: value.status,
    error: value.error,
  };
}

export function deriveStaySnapshotFreshness(
  capturedAt: string | null | undefined,
  ttlMs: number,
  now: Date | number = Date.now(),
): StaySnapshotFreshness {
  if (!capturedAt) return 'unknown';
  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedMs) || !Number.isFinite(ttlMs) || ttlMs < 0) {
    return 'unknown';
  }
  if (ttlMs === 0) return 'stale';

  const nowMs = typeof now === 'number' ? now : now.getTime();
  if (!Number.isFinite(nowMs)) return 'unknown';
  return Math.max(0, nowMs - capturedMs) <= ttlMs ? 'fresh' : 'stale';
}

export function getStayBookingEligibility(
  availability: StayAvailabilitySnapshot,
  freshness: StaySnapshotFreshness,
): StayBookingEligibility {
  if (freshness === 'stale') {
    return {
      status: 'conditional',
      actionable: false,
      reasonCode: 'availability_stale',
      reason: `Last known availability (${availability.status}) is stale.`,
    };
  }
  if (freshness === 'unknown') {
    return {
      status: 'unknown',
      actionable: false,
      reasonCode: 'availability_freshness_unknown',
      reason: 'Availability freshness is unknown.',
    };
  }

  if (availability.status === 'yes') {
    return {
      status: 'eligible',
      actionable: true,
      reasonCode: 'available',
      reason: 'Available for the recorded dates and guest count.',
    };
  }
  if (availability.status === 'no') {
    return {
      status: 'excluded',
      actionable: false,
      reasonCode: availability.reasonCode || 'provider_unavailable',
      reason: 'Not available for the recorded dates and guest count.',
    };
  }
  if (availability.status === 'partial') {
    return {
      status: 'conditional',
      actionable: false,
      reasonCode: availability.reasonCode || 'provider_alternative_range',
      reason: availability.availableRange
        ? (
            `Requested stay is unavailable; provider offered `
            + `${availability.availableRange.checkIn} to `
            + `${availability.availableRange.checkOut}.`
          )
        : 'Requested stay is unavailable; the provider offered different dates.',
    };
  }
  return {
    status: 'unknown',
    actionable: false,
    reasonCode: availability.reasonCode || 'availability_unknown',
    reason:
      availability.reasonCode === 'airbnb_inventory_not_verified'
        ? (
            'Airbnb public price was captured, but exact-stay inventory '
            + 'could not be independently verified.'
          )
        : 'Availability could not be confirmed.',
  };
}

export function buildLegacyStaySnapshot(
  request: StayRequestFingerprint,
): StaySnapshot {
  return {
    schemaVersion: STAY_SNAPSHOT_SCHEMA_VERSION,
    request,
    priceForStay: null,
    availability: {
      status: 'unknown',
      capturedAt: null,
      reasonCode: 'legacy_snapshot_missing',
    },
    providerEvidence: {},
  };
}

export function getStaySnapshotReadModel(input: {
  snapshot: unknown;
  fallbackRequest: StayRequestFingerprint;
  refreshAttempt?: unknown;
  ttlMs: number;
  now?: Date | number;
}): StaySnapshotReadModel {
  const parsed = parseStaySnapshot(input.snapshot);
  const snapshot = parsed ?? buildLegacyStaySnapshot(input.fallbackRequest);
  const priceFreshness = deriveStaySnapshotFreshness(
    snapshot.priceForStay?.capturedAt,
    input.ttlMs,
    input.now,
  );
  const availabilityFreshness = deriveStaySnapshotFreshness(
    snapshot.availability.capturedAt,
    input.ttlMs,
    input.now,
  );

  return {
    ...snapshot,
    legacy: !parsed,
    freshness: {
      price: priceFreshness,
      availability: availabilityFreshness,
    },
    bookingEligibility: getStayBookingEligibility(
      snapshot.availability,
      availabilityFreshness,
    ),
    refreshAttempt: parseStaySnapshotRefreshAttempt(input.refreshAttempt),
  };
}

export function getStaySnapshotAgeMs(
  capturedAt: string | null | undefined,
  now: Date | number = Date.now(),
): number | null {
  if (!capturedAt) return null;
  const capturedMs = Date.parse(capturedAt);
  const nowMs = typeof now === 'number' ? now : now.getTime();
  if (!Number.isFinite(capturedMs) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, nowMs - capturedMs);
}
