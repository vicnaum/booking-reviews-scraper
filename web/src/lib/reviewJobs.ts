import * as fs from 'node:fs';
import * as path from 'node:path';
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
  ReviewAnalysisSample,
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
import { buildAiCostBreakdown } from './aiCosts.js';
import { resolveAiJobBudgetUsdForRead } from './aiBudget.js';
import {
  isReviewJobArtifactFileAvailable,
  isReviewJobArtifactRootAvailable,
} from './reviewJobArtifacts.js';
import {
  computeReviewJobSnapshotAffordability,
  getReviewJobStaySnapshotReadModel,
  resolveStaySnapshotTtlMs,
} from './staySnapshots.js';

const EARTH_RADIUS_METERS = 6371000;

function getStayNightCount(
  checkin: string | null,
  checkout: string | null,
): number | null {
  if (!checkin || !checkout) return null;
  const start = Date.parse(`${checkin}T00:00:00Z`);
  const end = Date.parse(`${checkout}T00:00:00Z`);
  const nights = Math.round((end - start) / 86_400_000);
  return Number.isFinite(nights) && nights > 0 ? nights : null;
}

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

function asPriceRefreshSummary(
  value: Prisma.JsonValue | null,
): ReviewJobState['priceRefreshSummary'] {
  const summary = asJsonObject(value);
  const requested = asNumber(summary?.requested);
  const succeeded = asNumber(summary?.succeeded);
  const failed = asNumber(summary?.failed);
  if (requested == null || succeeded == null || failed == null) {
    return null;
  }
  return { requested, succeeded, failed };
}

function asNonNegativeInteger(value: unknown): number | null {
  return (
    typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
  )
    ? value
    : null;
}

function unknownReviewSample(
  totalScrapedReviewCount: number | null = null,
): ReviewAnalysisSample {
  return {
    totalScrapedReviewCount,
    eligibleReviewCount: null,
    analyzedReviewCount: null,
    capped: null,
    source: 'unknown',
  };
}

function getReviewSamplesFromManifest(
  artifactRoot: string | null | undefined,
): Map<string, ReviewAnalysisSample> {
  const samples = new Map<string, ReviewAnalysisSample>();
  if (!artifactRoot) return samples;

  try {
    const manifestPath = path.join(artifactRoot, 'batch_manifest.json');
    const stat = fs.lstatSync(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return samples;
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8'),
    ) as unknown;
    const manifestRecord = asJsonObject(manifest as Prisma.JsonValue);
    const listings = asJsonObject(
      (manifestRecord?.listings ?? null) as Prisma.JsonValue | null,
    );
    if (!listings) return samples;

    for (const value of Object.values(listings)) {
      const entry = asJsonObject(value as Prisma.JsonValue);
      if (!entry) continue;
      const platform =
        entry.platform === 'airbnb' || entry.platform === 'booking'
          ? entry.platform
          : null;
      const id = typeof entry.id === 'string' ? entry.id : null;
      if (!platform || !id) continue;

      const reviews = asJsonObject(
        (entry.reviews ?? null) as Prisma.JsonValue | null,
      );
      const aiReviews = asJsonObject(
        (entry.aiReviews ?? null) as Prisma.JsonValue | null,
      );
      const totalScrapedReviewCount = asNonNegativeInteger(reviews?.count);
      const analyzedReviewCount = asNonNegativeInteger(aiReviews?.count);
      const eligibleReviewCount = asNonNegativeInteger(aiReviews?.expected);
      const hasAiSampleProvenance =
        analyzedReviewCount != null || eligibleReviewCount != null;
      samples.set(`${platform}:${id}`, {
        totalScrapedReviewCount,
        eligibleReviewCount,
        analyzedReviewCount,
        capped:
          analyzedReviewCount != null && eligibleReviewCount != null
            ? analyzedReviewCount < eligibleReviewCount
            : null,
        source:
          hasAiSampleProvenance ? 'batch_manifest' : 'unknown',
      });
    }
  } catch {
    // Artifact retention or a partial legacy workspace leaves provenance unknown.
  }

  return samples;
}

function getPersistedReviewJobAiBudgetUsd(
  events: ReviewJobEventModel[],
): number | null | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = asJsonObject(events[index].payload);
    if (!payload) {
      continue;
    }

    if (payload.reason === 'ai-cost-budget') {
      const exceededBudget = asNumber(payload.budgetUsd);
      if (exceededBudget != null) {
        return exceededBudget;
      }
    }

    if (Object.hasOwn(payload, 'aiBudgetUsd')) {
      if (payload.aiBudgetUsd === null) {
        return null;
      }

      const startedBudget = asNumber(payload.aiBudgetUsd);
      if (startedBudget != null) {
        return startedBudget;
      }
    }
  }

  return undefined;
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

export const reviewJobResponseInclude = {
  listings: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      analysis: true,
    },
  },
  events: {
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.ReviewJobInclude;

export type ReviewJobResponseRecord = Prisma.ReviewJobGetPayload<{
  include: typeof reviewJobResponseInclude;
}>;

export function buildOwnedReviewJobQuery(
  jobId: string,
  ownerKey: string,
){
  return {
    where: {
      id: jobId,
      ownerKey,
    },
    include: reviewJobResponseInclude,
  } satisfies Prisma.ReviewJobFindFirstArgs;
}

export function buildAccessibleReviewJobQuery(
  jobId: string,
  ownerKey: string | null,
) {
  return {
    where: ownerKey
      ? {
          id: jobId,
          OR: [
            { ownerKey },
            { isPublic: true },
          ],
        }
      : {
          id: jobId,
          isPublic: true,
        },
    include: reviewJobResponseInclude,
  } satisfies Prisma.ReviewJobFindFirstArgs;
}

export function canEditReviewJob(
  job: Pick<ReviewJobModel, 'ownerKey'>,
  ownerKey: string | null,
) {
  return !!ownerKey && job.ownerKey === ownerKey;
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
  reviewSample?: ReviewAnalysisSample,
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
    reviewSample:
      reviewSample
      ?? unknownReviewSample(row.reviewCount ?? null),
    photoCount: row.photoCount ?? null,
    costs: buildAiCostBreakdown({
      aiReviewsCostUsd: row.aiReviewsCostUsd,
      aiPhotosCostUsd: row.aiPhotosCostUsd,
      triageCostUsd: row.triageCostUsd,
      totalAiCostUsd: row.totalAiCostUsd,
    }),
    durationMs: row.durationMs ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWebReviewJobListing(
  row: ReviewJobListingModel & { analysis?: ReviewJobListingAnalysisModel | null },
  options: {
    job: ReviewJobModel;
    ttlMs?: number;
    now?: Date;
    reviewSample?: ReviewAnalysisSample;
  },
): ReviewJobListing {
  const storedPricing =
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
  const staySnapshot = getReviewJobStaySnapshotReadModel({
    job: options.job,
    listing: row,
    analysis: row.analysis,
    ttlMs: options.ttlMs,
    now: options.now,
  });
  const snapshotPrice = staySnapshot.priceForStay;
  const nights = getStayNightCount(options.job.checkin, options.job.checkout);
  const pricing = snapshotPrice
    ? {
        nightly:
          nights
            ? {
                amount: snapshotPrice.amount / nights,
                currency: snapshotPrice.currency,
                source: 'derived' as const,
              }
            : null,
        total: {
          amount: snapshotPrice.amount,
          currency: snapshotPrice.currency,
          source: 'upstream' as const,
        },
        display: {
          amount: snapshotPrice.amount,
          currency: snapshotPrice.currency,
          source: 'upstream' as const,
          basis: 'stay' as const,
        },
      }
    : storedPricing;
  const affordability = computeReviewJobSnapshotAffordability({
    job: options.job,
    triage: row.analysis?.triage,
    snapshot: staySnapshot,
    now: options.now,
  });

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
    liked: row.liked,
    hidden: row.hidden,
    poiDistanceMeters: row.poiDistanceMeters ?? null,
    staySnapshot,
    affordability,
    analysis:
      row.analysis
        ? toReviewJobListingAnalysisState(
            row.analysis,
            options.reviewSample,
          )
        : null,
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
    artifactArchiveAvailable?: boolean;
    viewerCanEdit?: boolean;
    aiCostBudgetUsd?: number | null;
  } = {},
): ReviewJobState {
  return {
    id: job.id,
    ownerKey: job.ownerKey ?? null,
    isPublic: job.isPublic,
    viewerCanEdit: options.viewerCanEdit ?? false,
    status: job.status,
    currentPhase: job.currentPhase,
    analysisStatus: job.analysisStatus,
    analysisCurrentPhase: job.analysisCurrentPhase ?? null,
    priceRefreshStatus: job.priceRefreshStatus,
    priceRefreshCurrentPhase: job.priceRefreshCurrentPhase ?? null,
    location: job.location ?? null,
    prompt: job.prompt ?? null,
    regradeRequired: job.regradeRequired,
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
    analysisBudgetAmount: job.analysisBudgetAmount ?? null,
    analysisBudgetCurrency: job.analysisBudgetCurrency ?? null,
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
    priceRefreshProgress: job.priceRefreshProgress,
    priceRefreshErrorMessage: job.priceRefreshErrorMessage ?? null,
    priceRefreshSummary: asPriceRefreshSummary(job.priceRefreshSummary),
    priceRefreshDurationMs: job.priceRefreshDurationMs ?? null,
    priceRefreshStartedAt: job.priceRefreshStartedAt?.toISOString() ?? null,
    priceRefreshCompletedAt: job.priceRefreshCompletedAt?.toISOString() ?? null,
    costs: buildAiCostBreakdown({
      aiReviewsCostUsd: job.aiReviewsCostUsd,
      aiPhotosCostUsd: job.aiPhotosCostUsd,
      triageCostUsd: job.triageCostUsd,
      totalAiCostUsd: job.totalAiCostUsd,
    }),
    aiCostBudgetUsd:
      options.aiCostBudgetUsd !== undefined
        ? options.aiCostBudgetUsd
        : resolveAiJobBudgetUsdForRead(),
    aiCostBudgetExceeded: job.analysisCurrentPhase === 'budget-exceeded',
    durationMs: job.durationMs ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    reportReady: options.resultsReady ?? hasPersistedReviewJobResults(job),
    legacyReportAvailable:
      options.legacyReportAvailable
      ?? isReviewJobArtifactFileAvailable(job.reportPath),
    artifactArchiveAvailable:
      options.artifactArchiveAvailable
      ?? isReviewJobArtifactRootAvailable(job.artifactRoot),
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
  viewerCanEdit?: boolean;
}): ReviewJobResponse {
  const resultsReady = hasPersistedReviewJobResults(input.job);
  const persistedAiBudgetUsd = getPersistedReviewJobAiBudgetUsd(input.events);
  const ttlMs = resolveStaySnapshotTtlMs();
  const now = new Date();
  const reviewSamples = getReviewSamplesFromManifest(input.job.artifactRoot);

  return {
    job: toReviewJobState(input.job, {
      resultsReady,
      legacyReportAvailable: isReviewJobArtifactFileAvailable(input.job.reportPath),
      artifactArchiveAvailable: isReviewJobArtifactRootAvailable(input.job.artifactRoot),
      viewerCanEdit: input.viewerCanEdit,
      aiCostBudgetUsd: persistedAiBudgetUsd,
    }),
    listings: input.listings.map((listing) =>
      toWebReviewJobListing(listing, {
        job: input.job,
        ttlMs,
        now,
        reviewSample:
          reviewSamples.get(
            `${listing.platform}:${listing.listingId}`,
          )
          ?? (
            listing.analysis
              ? unknownReviewSample(listing.analysis.reviewCount ?? null)
              : undefined
          ),
      })),
    events: input.events.map(toReviewJobEvent),
  };
}

export function toReviewJobResponseRecord(job: ReviewJobResponseRecord): ReviewJobResponse {
  return toReviewJobResponse({
    job,
    listings: job.listings,
    events: job.events,
  });
}

export function toReviewJobResponseRecordForViewer(
  job: ReviewJobResponseRecord,
  ownerKey: string | null,
): ReviewJobResponse {
  return toReviewJobResponse({
    job,
    listings: job.listings,
    events: job.events,
    viewerCanEdit: canEditReviewJob(job, ownerKey),
  });
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
    analysisBudgetAmount?: number | null;
    analysisBudgetCurrency?: string | null;
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
    analysisBudgetAmount: options.analysisBudgetAmount ?? null,
    analysisBudgetCurrency: options.analysisBudgetCurrency ?? null,
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
