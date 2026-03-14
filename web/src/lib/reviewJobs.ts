import type {
  Prisma,
  ReviewJob as ReviewJobModel,
  ReviewJobEvent as ReviewJobEventModel,
  ReviewJobListing as ReviewJobListingModel,
  ReviewJobListingAnalysis as ReviewJobListingAnalysisModel,
} from '@prisma/client';
import type {
  AirbnbSearchParams,
  BookingSearchParams,
} from '@cli/search/types.js';
import type {
  BoundingBox,
  CircleFilter,
  FullSearchRequest,
  MapPoint,
  ReviewJobEvent,
  ReviewJobListing,
  ReviewJobListingAnalysis,
  ReviewJobResponse,
  ReviewJobState,
  SearchPricing,
  SearchResult,
} from '../types.js';
import {
  buildSearchFilters,
  parseSearchFilters,
  parseStoredBoundingBox,
} from './searchJobs.js';

const EARTH_RADIUS_METERS = 6371000;

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asMapPoint(value: unknown): MapPoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const point = value as Record<string, unknown>;
  const lat = asNumber(point.lat);
  const lng = asNumber(point.lng);

  if (lat == null || lng == null) {
    return null;
  }

  return { lat, lng };
}

function asCircleFilter(value: unknown): CircleFilter | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const circle = value as Record<string, unknown>;
  const center = asMapPoint(circle.center);
  const radiusMeters = asNumber(circle.radiusMeters);

  if (!center || radiusMeters == null) {
    return null;
  }

  return { center, radiusMeters };
}

function asJsonObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
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

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function getDistanceMeters(a: MapPoint, b: MapPoint): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRadians(b.lng - a.lng);
  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

export function toReviewJobListingRecord(
  jobId: string,
  result: SearchResult,
  options: {
    poi?: MapPoint | null;
  } = {},
): Prisma.ReviewJobListingCreateManyInput {
  const poiDistanceMeters =
    options.poi && result.coordinates
      ? getDistanceMeters(options.poi, result.coordinates)
      : null;

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
    poiDistanceMeters,
  };
}

function toReviewJobListingAnalysisState(
  row: ReviewJobListingAnalysisModel,
): ReviewJobListingAnalysis {
  return {
    id: row.id,
    status: row.status,
    currentPhase: row.currentPhase,
    errorMessage: row.errorMessage ?? null,
    detailsStatus: row.detailsStatus,
    reviewsStatus: row.reviewsStatus,
    photosStatus: row.photosStatus,
    aiReviewsStatus: row.aiReviewsStatus,
    aiPhotosStatus: row.aiPhotosStatus,
    triageStatus: row.triageStatus,
    details: asJsonObject(row.details),
    aiReviews: asJsonObject(row.aiReviews),
    aiPhotos: asJsonObject(row.aiPhotos),
    triage: asJsonObject(row.triage),
    reviewCount: row.reviewCount ?? null,
    photoCount: row.photoCount ?? null,
    durationMs: row.durationMs ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWebReviewJobListing(
  row: ReviewJobListingModel & { analysis?: ReviewJobListingAnalysisModel | null },
): ReviewJobListing {
  const pricing =
    asSearchPricing((row as ReviewJobListingModel & { pricing?: Prisma.JsonValue | null }).pricing)
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
    selected: row.selected,
    hidden: row.hidden,
    poiDistanceMeters: row.poiDistanceMeters ?? null,
    analysis: row.analysis ? toReviewJobListingAnalysisState(row.analysis) : null,
  };
}

export function hasPersistedReviewJobResults(
  job: Pick<ReviewJobModel, 'analysisStatus'>,
): boolean {
  return job.analysisStatus === 'completed' || job.analysisStatus === 'partial';
}

export function toReviewJobState(
  job: ReviewJobModel,
  options: {
    resultsReady?: boolean;
    legacyReportAvailable?: boolean;
  } = {},
): ReviewJobState {
  return {
    id: job.id,
    ownerKey: job.ownerKey ?? null,
    status: job.status,
    currentPhase: job.currentPhase,
    analysisStatus: job.analysisStatus,
    analysisCurrentPhase: job.analysisCurrentPhase ?? null,
    location: job.location ?? null,
    prompt: job.prompt ?? null,
    boundingBox: parseStoredBoundingBox(job.boundingBox) ?? null,
    circle: asCircleFilter(job.circle),
    poi: asMapPoint(job.poi),
    mapBounds: parseStoredBoundingBox(job.mapBounds) ?? null,
    mapCenter: asMapPoint(job.mapCenter),
    mapZoom: job.mapZoom ?? null,
    searchAreaMode: job.searchAreaMode,
    checkin: job.checkin ?? null,
    checkout: job.checkout ?? null,
    adults: job.adults,
    currency: job.currency,
    filters: asJsonObject(job.filters),
    totalResults: job.totalResults,
    pagesScanned: job.pagesScanned,
    progress: job.progress,
    errorMessage: job.errorMessage ?? null,
    analysisProgress: job.analysisProgress,
    analysisErrorMessage: job.analysisErrorMessage ?? null,
    analysisDurationMs: job.analysisDurationMs ?? null,
    analysisStartedAt: job.analysisStartedAt?.toISOString() ?? null,
    analysisCompletedAt: job.analysisCompletedAt?.toISOString() ?? null,
    durationMs: job.durationMs ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    reportReady: options.resultsReady ?? hasPersistedReviewJobResults(job),
    legacyReportAvailable: options.legacyReportAvailable ?? !!job.reportPath,
    createdAt: job.createdAt.toISOString(),
  };
}

export function toReviewJobEvent(row: ReviewJobEventModel): ReviewJobEvent {
  return {
    id: row.id,
    phase: row.phase,
    level: row.level,
    message: row.message,
    payload: asJsonObject(row.payload),
    listingId: row.listingId ?? null,
    listingPlatform: row.listingPlatform ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toReviewJobResponse(input: {
  job: ReviewJobModel;
  listings: Array<ReviewJobListingModel & { analysis?: ReviewJobListingAnalysisModel | null }>;
  events: ReviewJobEventModel[];
}): ReviewJobResponse {
  const resultsReady = hasPersistedReviewJobResults(input.job);

  return {
    job: toReviewJobState(input.job, {
      resultsReady,
      legacyReportAvailable: !!input.job.reportPath,
    }),
    listings: input.listings.map(toWebReviewJobListing),
    events: input.events.map(toReviewJobEvent),
  };
}

export function buildReviewJobData(
  request: FullSearchRequest,
  options: {
    ownerKey: string;
    mapBounds?: BoundingBox | null;
    mapCenter?: MapPoint | null;
    mapZoom?: number | null;
    searchAreaMode?: 'window' | 'rectangle' | 'circle';
    poi?: MapPoint | null;
    prompt?: string | null;
  } = { ownerKey: '' },
): Prisma.ReviewJobCreateInput {
  return {
    ownerKey: options.ownerKey,
    status: 'pending',
    currentPhase: 'search',
    location: request.location ?? null,
    prompt: options.prompt ?? null,
    boundingBox: request.boundingBox as unknown as Prisma.InputJsonValue,
    circle: (request.circle ?? null) as unknown as Prisma.InputJsonValue,
    poi: (options.poi ?? null) as unknown as Prisma.InputJsonValue,
    mapBounds: (options.mapBounds ?? null) as unknown as Prisma.InputJsonValue,
    mapCenter: (options.mapCenter ?? null) as unknown as Prisma.InputJsonValue,
    mapZoom: options.mapZoom ?? null,
    searchAreaMode: options.searchAreaMode ?? 'window',
    checkin: request.checkin ?? null,
    checkout: request.checkout ?? null,
    adults: request.adults ?? 2,
    currency: request.currency ?? 'USD',
    filters: buildSearchFilters(request),
    progress: 0,
  };
}

export function buildReviewJobPlatformParams(
  job: ReviewJobModel,
  platform: 'airbnb',
): AirbnbSearchParams;
export function buildReviewJobPlatformParams(
  job: ReviewJobModel,
  platform: 'booking',
): BookingSearchParams;
export function buildReviewJobPlatformParams(
  job: ReviewJobModel,
  platform: 'airbnb' | 'booking',
): AirbnbSearchParams | BookingSearchParams {
  const filters = parseSearchFilters(job.filters);
  const common = {
    location: job.location ?? undefined,
    boundingBox: parseStoredBoundingBox(job.boundingBox),
    circle: asCircleFilter(job.circle) ?? undefined,
    checkin: job.checkin ?? undefined,
    checkout: job.checkout ?? undefined,
    adults: job.adults,
    currency: job.currency,
    minRating: filters.minRating,
    minBedrooms: filters.minBedrooms,
    minBeds: filters.minBeds,
    priceMin:
      filters.priceDisplay === 'total' ? undefined : filters.priceMin,
    priceMax:
      filters.priceDisplay === 'total' ? undefined : filters.priceMax,
    propertyType: filters.propertyType,
    exhaustive: true,
  };

  if (platform === 'airbnb') {
    return {
      ...common,
      platform: 'airbnb',
      superhost: filters.superhost,
      instantBook: filters.instantBook,
    };
  }

  return {
    ...common,
    platform: 'booking',
    stars: filters.stars,
    freeCancellation: filters.freeCancellation,
  };
}

export function buildReviewJobEventData(
  jobId: string,
  input: {
    phase: string;
    level: string;
    message: string;
    payload?: Prisma.InputJsonValue;
    listingId?: string | null;
    listingPlatform?: 'airbnb' | 'booking' | null;
  },
): Prisma.ReviewJobEventUncheckedCreateInput {
  return {
    jobId,
    phase: input.phase,
    level: input.level,
    message: input.message,
    payload: input.payload,
    listingId: input.listingId ?? null,
    listingPlatform: input.listingPlatform ?? null,
  };
}
