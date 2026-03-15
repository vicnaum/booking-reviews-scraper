import type {
  Prisma,
  SearchJob as SearchJobModel,
  SearchResult as SearchResultModel,
} from '@prisma/client';
import type {
  BoundingBox,
  CircleFilter,
  FullSearchRequest,
  PriceDisplayMode,
  SearchJobState,
  SearchPricing,
  SearchResult,
} from '../types.js';

export interface PersistedSearchFilters {
  circle?: CircleFilter;
  exhaustive?: boolean;
  minRating?: number;
  minBedrooms?: number;
  minBeds?: number;
  priceDisplay?: PriceDisplayMode;
  priceMin?: number;
  priceMax?: number;
  propertyType?: string;
  superhost?: boolean;
  instantBook?: boolean;
  stars?: number[];
  freeCancellation?: boolean;
}

interface PersistableSearchResult {
  id: string;
  platform: 'airbnb' | 'booking';
  name: string;
  url: string;
  rating: number | null;
  reviewCount: number;
  pricing: SearchPricing | null;
  coordinates: { lat: number; lng: number } | null;
  propertyType: string | null;
  photoUrl: string | null;
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  maxGuests?: number;
  superhost?: boolean;
  instantBook?: boolean;
  hostId?: string;
  stars?: number;
  freeCancellation?: boolean;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asCircleFilter(value: unknown): CircleFilter | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const circle = value as Record<string, unknown>;
  const center =
    circle.center && typeof circle.center === 'object' && !Array.isArray(circle.center)
      ? (circle.center as Record<string, unknown>)
      : null;
  const lat = center ? asNumber(center.lat) : undefined;
  const lng = center ? asNumber(center.lng) : undefined;
  const radiusMeters = asNumber(circle.radiusMeters);

  if (lat == null || lng == null || radiusMeters == null) {
    return undefined;
  }

  return {
    center: { lat, lng },
    radiusMeters,
  };
}

function asSearchPricing(value: unknown): SearchPricing | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const pricing = value as Record<string, unknown>;
  const nightly =
    pricing.nightly && typeof pricing.nightly === 'object' && !Array.isArray(pricing.nightly)
      ? pricing.nightly as SearchPricing['nightly']
      : null;
  const total =
    pricing.total && typeof pricing.total === 'object' && !Array.isArray(pricing.total)
      ? pricing.total as SearchPricing['total']
      : null;
  const display =
    pricing.display && typeof pricing.display === 'object' && !Array.isArray(pricing.display)
      ? pricing.display as SearchPricing['display']
      : null;

  if (!nightly && !total && !display) {
    return null;
  }

  return { nightly, total, display };
}

export function buildSearchFilters(
  request: FullSearchRequest,
): Prisma.InputJsonValue {
  const filters: PersistedSearchFilters = {
    exhaustive: request.exhaustive ?? true,
  };

  if (request.circle) filters.circle = request.circle;
  if (request.minRating != null) filters.minRating = request.minRating;
  if (request.minBedrooms != null) filters.minBedrooms = request.minBedrooms;
  if (request.minBeds != null) filters.minBeds = request.minBeds;
  if (request.priceDisplay) filters.priceDisplay = request.priceDisplay;
  if (request.priceMin != null) filters.priceMin = request.priceMin;
  if (request.priceMax != null) filters.priceMax = request.priceMax;
  if (request.propertyType) filters.propertyType = request.propertyType;
  if (request.superhost != null) filters.superhost = request.superhost;
  if (request.instantBook != null) filters.instantBook = request.instantBook;
  if (request.stars?.length) filters.stars = request.stars;
  if (request.freeCancellation != null) {
    filters.freeCancellation = request.freeCancellation;
  }

  return filters as Prisma.InputJsonValue;
}

export function parseSearchFilters(
  value: Prisma.JsonValue | null,
): PersistedSearchFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const filters = value as Record<string, unknown>;
  return {
    circle: asCircleFilter(filters.circle),
    exhaustive: asBoolean(filters.exhaustive),
    minRating: asNumber(filters.minRating),
    minBedrooms: asNumber(filters.minBedrooms),
    minBeds: asNumber(filters.minBeds),
    priceDisplay:
      filters.priceDisplay === 'perNight' || filters.priceDisplay === 'total'
        ? filters.priceDisplay
        : undefined,
    priceMin: asNumber(filters.priceMin),
    priceMax: asNumber(filters.priceMax),
    propertyType: asString(filters.propertyType),
    superhost: asBoolean(filters.superhost),
    instantBook: asBoolean(filters.instantBook),
    stars: Array.isArray(filters.stars)
      ? filters.stars.filter((value): value is number => typeof value === 'number')
      : undefined,
    freeCancellation: asBoolean(filters.freeCancellation),
  };
}

export function parseStoredBoundingBox(
  value: Prisma.JsonValue | null,
): BoundingBox | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const bbox = value as Record<string, unknown>;
  const neLat = asNumber(bbox.neLat);
  const neLng = asNumber(bbox.neLng);
  const swLat = asNumber(bbox.swLat);
  const swLng = asNumber(bbox.swLng);

  if (neLat == null || neLng == null || swLat == null || swLng == null) {
    return undefined;
  }

  return { neLat, neLng, swLat, swLng };
}

export function buildCliSearchParams(job: SearchJobModel) {
  const filters = parseSearchFilters(job.filters);
  const common = {
    location: job.location ?? undefined,
    boundingBox: parseStoredBoundingBox(job.boundingBox),
    circle: filters.circle,
    checkin: job.checkin ?? undefined,
    checkout: job.checkout ?? undefined,
    adults: job.adults,
    currency: job.currency,
    priceDisplay: filters.priceDisplay,
    minRating: filters.minRating,
    minBedrooms: filters.minBedrooms,
    minBeds: filters.minBeds,
    priceMin:
      filters.priceDisplay === 'total' ? undefined : filters.priceMin,
    priceMax:
      filters.priceDisplay === 'total' ? undefined : filters.priceMax,
    propertyType: filters.propertyType,
    exhaustive: filters.exhaustive ?? true,
  };

  if (job.platform === 'airbnb') {
    return {
      ...common,
      platform: 'airbnb' as const,
      superhost: filters.superhost,
      instantBook: filters.instantBook,
    };
  }

  return {
    ...common,
    platform: 'booking' as const,
    stars: filters.stars,
    freeCancellation: filters.freeCancellation,
  };
}

export function toSearchResultRecord(
  jobId: string,
  result: PersistableSearchResult,
): Prisma.SearchResultCreateManyInput {
  return {
    jobId,
    listingId: result.id,
    platform: result.platform,
    name: result.name,
    url: result.url,
    rating: result.rating,
    reviewCount: result.reviewCount,
    priceAmount: result.pricing?.nightly?.amount ?? null,
    priceCurrency:
      result.pricing?.nightly?.currency
      ?? result.pricing?.total?.currency
      ?? result.pricing?.display?.currency
      ?? null,
    totalPrice: result.pricing?.total?.amount ?? null,
    pricing: result.pricing as unknown as Prisma.InputJsonValue,
    lat: result.coordinates?.lat ?? null,
    lng: result.coordinates?.lng ?? null,
    propertyType: result.propertyType,
    photoUrl: result.photoUrl,
    bedrooms: result.bedrooms ?? null,
    beds: result.beds ?? null,
    bathrooms: result.bathrooms ?? null,
    maxGuests: result.maxGuests ?? null,
    superhost: result.superhost ?? null,
    instantBook: result.instantBook ?? null,
    hostId: result.hostId ?? null,
    stars: result.stars ?? null,
    freeCancellation: result.freeCancellation ?? null,
  };
}

export function toWebSearchResult(row: SearchResultModel): SearchResult {
  const pricing =
    asSearchPricing((row as SearchResultModel & { pricing?: Prisma.JsonValue | null }).pricing)
    ?? (
      row.priceAmount != null || row.totalPrice != null
        ? {
            nightly:
              row.priceAmount != null && row.priceCurrency
                ? {
                    amount: row.priceAmount,
                    currency: row.priceCurrency,
                    source: 'upstream' as const,
                  }
                : null,
            total:
              row.totalPrice != null && row.priceCurrency
                ? {
                    amount: row.totalPrice,
                    currency: row.priceCurrency,
                    source: 'upstream' as const,
                  }
                : null,
            display: null,
          }
        : null
    );

  return {
    id: row.listingId,
    platform: row.platform,
    name: row.name,
    url: row.url,
    rating: row.rating,
    reviewCount: row.reviewCount,
    pricing,
    coordinates:
      row.lat != null && row.lng != null
        ? { lat: row.lat, lng: row.lng }
        : null,
    propertyType: row.propertyType,
    photoUrl: row.photoUrl,
    bedrooms: row.bedrooms ?? undefined,
    beds: row.beds ?? undefined,
    bathrooms: row.bathrooms ?? undefined,
    maxGuests: row.maxGuests ?? undefined,
    superhost: row.superhost ?? undefined,
    instantBook: row.instantBook ?? undefined,
    hostId: row.hostId ?? undefined,
    stars: row.stars ?? undefined,
    freeCancellation: row.freeCancellation ?? undefined,
  };
}

export function toSearchJobState(job: SearchJobModel): SearchJobState {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    totalResults: job.totalResults,
    pagesScanned: job.pagesScanned,
    errorMessage: job.errorMessage,
    durationMs: job.durationMs,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}
