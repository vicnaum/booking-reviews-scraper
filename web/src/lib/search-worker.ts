import * as fs from 'node:fs';
import * as path from 'node:path';
import { Prisma, type PhaseStatus as DbPhaseStatus } from '@prisma/client';
import { Worker } from 'bullmq';
import { config as loadDotEnv } from 'dotenv';
import { runBatch, type BatchEvent, type BatchPhaseUpdate } from '../../../src/batch.js';
import { bootstrapRuntimeProxyEnv } from '../../../src/config.js';
import { generateReport } from '../../../src/report.js';
import { searchAirbnb } from '../../../src/airbnb/search.js';
import { searchBooking } from '../../../src/booking/search.js';
import { prisma } from './prisma.js';
import { getRedisConnectionOptions } from './redis.js';
import {
  SEARCH_QUEUE_NAME,
  type SearchQueueJobData,
} from './search-queue.js';
import {
  REVIEW_JOB_QUEUE_NAME,
  type ReviewJobQueueData,
} from './review-job-queue.js';
import {
  buildCliSearchParams,
  parseSearchFilters,
  toSearchResultRecord,
} from './searchJobs.js';
import {
  buildReviewJobEventData,
  buildReviewJobPlatformParams,
  toReviewJobListingRecord,
} from './reviewJobs.js';
import {
  getListingMatchKey,
  getManifestPathFromRoot,
  getPoiDistanceMeters,
  getReportPathFromRoot,
  injectPoiContextIntoListingArtifacts,
  prepareReviewJobRunWorkspace,
  readJsonFile,
  summarizeAnalysisStatus,
  summarizeManifestEntryStatus,
  toPhaseStatus,
  type AnalysisManifest,
} from './review-job-analysis.js';
import {
  summarizeReviewJobSearchOutcome,
  type ReviewJobSearchPlatformFailure,
} from './reviewJobSearch.js';
import { createSearchLogger } from './searchLog.js';
import type {
  SearchResult,
} from '../types.js';
import { filterResultsForRequest } from './resultFilters.js';

for (const envPath of [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
]) {
  loadDotEnv({ path: envPath, override: false });
}

bootstrapRuntimeProxyEnv();

function asStoredMapPoint(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const point = value as Record<string, unknown>;
  const lat = typeof point.lat === 'number' ? point.lat : null;
  const lng = typeof point.lng === 'number' ? point.lng : null;

  if (lat == null || lng == null) {
    return null;
  }

  return { lat, lng };
}

async function appendReviewJobEvent(
  reviewJobId: string,
  input: Parameters<typeof buildReviewJobEventData>[1],
) {
  await prisma.reviewJobEvent.create({
    data: buildReviewJobEventData(reviewJobId, input),
  });
}

function createProgressWriter(label: 'search-worker' | 'review-worker') {
  let queue = Promise.resolve();

  return {
    push(task: () => Promise<void>) {
      queue = queue
        .catch(() => {})
        .then(task)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[${label}] failed to persist progress: ${message}`);
        });
    },
    async flush() {
      await queue.catch(() => {});
    },
  };
}

async function runSearchJob(searchJobId: string) {
  const jobRecord = await prisma.searchJob.findUnique({
    where: { id: searchJobId },
  });

  if (!jobRecord) {
    throw new Error(`Search job ${searchJobId} not found`);
  }

  const startedAt = new Date();
  let pagesScanned = 0;
  const progressWriter = createProgressWriter('search-worker');

  await prisma.searchJob.update({
    where: { id: searchJobId },
    data: {
      status: 'running',
      startedAt,
      progress: 0.05,
      errorMessage: null,
    },
  });

  try {
    const params = buildCliSearchParams(jobRecord);
    const storedFilters = parseSearchFilters(jobRecord.filters);
    const onProgress = () => {
      const nextPagesScanned = pagesScanned + 1;
      pagesScanned = nextPagesScanned;
      progressWriter.push(async () => {
        await prisma.searchJob.update({
          where: { id: searchJobId },
          data: {
            status: 'running',
            pagesScanned: nextPagesScanned,
            progress: Math.min(0.95, 0.05 + nextPagesScanned * 0.03),
          },
        });
      });
    };

    const output =
      params.platform === 'airbnb'
        ? await searchAirbnb(params, onProgress)
        : await searchBooking(params, onProgress);

    await progressWriter.flush();

    const filteredResults = filterResultsForRequest(output.results, {
      circle: storedFilters.circle,
      checkin: jobRecord.checkin ?? undefined,
      checkout: jobRecord.checkout ?? undefined,
      priceDisplay: storedFilters.priceDisplay,
      priceMin: storedFilters.priceMin,
      priceMax: storedFilters.priceMax,
      minBedrooms: storedFilters.minBedrooms,
      minBeds: storedFilters.minBeds,
    });

    const rows = filteredResults.map((result) =>
      toSearchResultRecord(searchJobId, result),
    );
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await prisma.$transaction(async (tx) => {
      await tx.searchResult.deleteMany({ where: { jobId: searchJobId } });
      if (rows.length > 0) {
        await tx.searchResult.createMany({
          data: rows,
          skipDuplicates: true,
        });
      }
      await tx.searchJob.update({
        where: { id: searchJobId },
        data: {
          status: 'completed',
          totalResults: filteredResults.length,
          pagesScanned: output.pagesScanned || pagesScanned,
          progress: 1,
          completedAt,
          durationMs,
        },
      });
    });

    console.log(
      `[search-worker] completed ${searchJobId} with ${filteredResults.length} results`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Search failed';
    const completedAt = new Date();
    await progressWriter.flush();

    await prisma.searchJob.update({
      where: { id: searchJobId },
      data: {
        status: 'failed',
        errorMessage: message,
        pagesScanned,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    });

    throw error;
  }
}

async function ensureReviewJobAnalysisRows(reviewJobId: string) {
  const listings = await prisma.reviewJobListing.findMany({
    where: { jobId: reviewJobId },
    select: { id: true },
  });

  const existing = await prisma.reviewJobListingAnalysis.findMany({
    where: {
      jobListingId: {
        in: listings.map((listing) => listing.id),
      },
    },
    select: { jobListingId: true },
  });

  const existingIds = new Set(existing.map((row) => row.jobListingId));
  const missing = listings.filter((listing) => !existingIds.has(listing.id));
  if (missing.length === 0) {
    return;
  }

  await prisma.reviewJobListingAnalysis.createMany({
    data: missing.map((listing) => ({
      jobListingId: listing.id,
    })),
    skipDuplicates: true,
  });
}

async function runReviewJobSearch(reviewJobId: string) {
  const jobRecord = await prisma.reviewJob.findUnique({
    where: { id: reviewJobId },
  });

  if (!jobRecord) {
    throw new Error(`Review job ${reviewJobId} not found`);
  }

  const startedAt = new Date();
  let pagesScanned = 0;
  const progressWriter = createProgressWriter('review-worker');
  const searchLogger = createSearchLogger({
    kind: 'review-job-search',
    label: reviewJobId,
    payload: {
      location: jobRecord.location ?? null,
      boundingBox: jobRecord.boundingBox,
      circle: jobRecord.circle,
      poi: jobRecord.poi,
      checkin: jobRecord.checkin ?? null,
      checkout: jobRecord.checkout ?? null,
      adults: jobRecord.adults,
      currency: jobRecord.currency,
      filters: jobRecord.filters,
    },
  });

  await prisma.reviewJob.update({
    where: { id: reviewJobId },
    data: {
      status: 'running',
      currentPhase: 'search',
      startedAt,
      progress: 0.05,
      errorMessage: null,
    },
  });

  await appendReviewJobEvent(reviewJobId, {
    phase: 'search',
    level: 'info',
    message: 'Started combined Airbnb + Booking full search',
  });

  try {
    const storedFilters = parseSearchFilters(jobRecord.filters);
    const storedPoi = asStoredMapPoint(jobRecord.poi);
    const requestFilters = {
      circle: storedFilters.circle,
      checkin: jobRecord.checkin ?? undefined,
      checkout: jobRecord.checkout ?? undefined,
      priceDisplay: storedFilters.priceDisplay,
      priceMin: storedFilters.priceMin,
      priceMax: storedFilters.priceMax,
      minBedrooms: storedFilters.minBedrooms,
      minBeds: storedFilters.minBeds,
    };

    const persistProgress = (platform: 'airbnb' | 'booking') => {
      const nextPagesScanned = pagesScanned + 1;
      pagesScanned = nextPagesScanned;
      progressWriter.push(async () => {
        await prisma.reviewJob.update({
          where: { id: reviewJobId },
          data: {
            status: 'running',
            currentPhase: `search:${platform}`,
            pagesScanned: nextPagesScanned,
            progress: Math.min(0.95, 0.05 + nextPagesScanned * 0.02),
          },
        });
      });
    };

    const platforms: Array<'airbnb' | 'booking'> = ['airbnb', 'booking'];
    const allResults: SearchResult[] = [];
    const warnings: ReviewJobSearchPlatformFailure[] = [];
    const successfulPlatforms: Array<'airbnb' | 'booking'> = [];

    for (const platform of platforms) {
      await appendReviewJobEvent(reviewJobId, {
        phase: 'search',
        level: 'info',
        message: `Searching ${platform}`,
        payload: { platform },
      });

      let output;
      try {
        if (platform === 'airbnb') {
          const params = buildReviewJobPlatformParams(jobRecord, platform);
          output = await searchAirbnb(params, () => persistProgress(platform));
        } else {
          const params = buildReviewJobPlatformParams(jobRecord, platform);
          output = await searchBooking(params, () => persistProgress(platform));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Platform search failed';
        warnings.push({ platform, message });
        searchLogger.log('platform_failed', {
          platform,
          message,
        });
        await appendReviewJobEvent(reviewJobId, {
          phase: 'search',
          level: 'warning',
          message: `${platform} search failed: ${message}`,
          payload: {
            platform,
            message,
          },
        });
        continue;
      }

      const filteredResults = filterResultsForRequest(output.results, requestFilters);
      allResults.push(...filteredResults);
      successfulPlatforms.push(platform);
      searchLogger.log('platform_completed', {
        platform,
        fetchedResults: output.results.length,
        keptResults: filteredResults.length,
        pagesScanned: output.pagesScanned,
        sampleIds: filteredResults.slice(0, 10).map((result) => result.id),
      });

      await appendReviewJobEvent(reviewJobId, {
        phase: 'search',
        level: 'info',
        message: `Finished ${platform} search`,
        payload: {
          platform,
          fetched: output.results.length,
          kept: filteredResults.length,
          pagesScanned: output.pagesScanned,
        },
      });
    }

    await progressWriter.flush();

    const searchSummary = summarizeReviewJobSearchOutcome({
      successfulPlatforms,
      warnings,
    });

    if (!searchSummary.canPersistResults) {
      throw new Error(searchSummary.failureMessage ?? 'Review job search failed');
    }

    const rows = allResults.map((result) =>
      toReviewJobListingRecord(reviewJobId, result, { poi: storedPoi }),
    );
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await prisma.$transaction(async (tx) => {
      await tx.reviewJobListing.deleteMany({ where: { jobId: reviewJobId } });
      if (rows.length > 0) {
        await tx.reviewJobListing.createMany({
          data: rows,
          skipDuplicates: true,
        });
        const insertedListings = await tx.reviewJobListing.findMany({
          where: { jobId: reviewJobId },
          select: { id: true },
        });
        await tx.reviewJobListingAnalysis.createMany({
          data: insertedListings.map((listing) => ({
            jobListingId: listing.id,
          })),
          skipDuplicates: true,
        });
      }
      await tx.reviewJob.update({
        where: { id: reviewJobId },
        data: {
          status: 'completed',
          currentPhase: 'awaiting-analysis',
          analysisStatus: 'pending',
          analysisCurrentPhase: null,
          analysisProgress: 0,
          analysisErrorMessage: null,
          totalResults: rows.length,
          pagesScanned,
          progress: 1,
          completedAt,
          durationMs,
          errorMessage:
            warnings.length > 0
              ? warnings.map((warning) => `${warning.platform}: ${warning.message}`).join('; ')
              : null,
        },
      });
      await tx.reviewJobEvent.create({
        data: buildReviewJobEventData(reviewJobId, {
          phase: 'search',
          level: searchSummary.completedEventLevel,
          message: searchSummary.completedEventMessage,
          payload: {
            totalResults: rows.length,
            pagesScanned,
            durationMs,
            successfulPlatforms,
            warnings: warnings.map((warning) => ({
              platform: warning.platform,
              message: warning.message,
            })),
          } as Prisma.InputJsonValue,
        }),
      });
    });
    searchLogger.log('completed', {
      totalResults: rows.length,
      pagesScanned,
      durationMs,
      successfulPlatforms,
      warnings: warnings.length > 0 ? warnings : null,
    });

    console.log(
      `[review-worker] completed ${reviewJobId} with ${rows.length} results`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Review job search failed';
    const completedAt = new Date();
    await progressWriter.flush();

    await prisma.$transaction(async (tx) => {
      await tx.reviewJob.update({
        where: { id: reviewJobId },
        data: {
          status: 'failed',
          currentPhase: 'search',
          errorMessage: message,
          pagesScanned,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
      });
      await tx.reviewJobEvent.create({
        data: buildReviewJobEventData(reviewJobId, {
          phase: 'search',
          level: 'error',
          message,
        }),
      });
    });
    searchLogger.log('failed', {
      message,
      pagesScanned,
    });

    throw error;
  }
}

function getAnalysisPhaseProgress(phase: BatchEvent['phase'] | 'report'): number {
  switch (phase) {
    case 'batch':
      return 0.03;
    case 'scrape':
      return 0.18;
    case 'ai-reviews':
      return 0.52;
    case 'ai-photos':
      return 0.74;
    case 'triage':
      return 0.9;
    case 'report':
      return 0.97;
  }
}

function resolveAnalysisEventState(event: BatchEvent): {
  currentPhase: string;
  progress: number;
} {
  const payload =
    event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown>
      : null;
  const progressLabel =
    payload && typeof payload.progressLabel === 'string'
      ? payload.progressLabel
      : null;
  const progressFraction =
    payload && typeof payload.progressFraction === 'number'
      ? payload.progressFraction
      : null;

  if (event.phase === 'scrape' && progressFraction != null) {
    const SCRAPE_PROGRESS_START = 0.18;
    const SCRAPE_PROGRESS_END = 0.5;
    return {
      currentPhase: progressLabel ?? event.message,
      progress:
        SCRAPE_PROGRESS_START
        + Math.max(0, Math.min(1, progressFraction))
        * (SCRAPE_PROGRESS_END - SCRAPE_PROGRESS_START),
    };
  }

  return {
    currentPhase: progressLabel ?? event.phase,
    progress: getAnalysisPhaseProgress(event.phase),
  };
}

type PersistableManifestEntry = AnalysisManifest['listings'][string] | BatchPhaseUpdate['entry'];

interface ReviewJobListingPersistenceRow {
  id: string;
  platform: 'airbnb' | 'booking';
  url: string;
  lat: number | null;
  lng: number | null;
  poiDistanceMeters: number | null;
  analysis: { startedAt: Date | null } | null;
}

interface ReviewJobListingAnalysisSnapshot {
  jobListingId: string;
  status: DbPhaseStatus;
  currentPhase: string;
  errorMessage: string | null;
  detailsStatus: DbPhaseStatus;
  reviewsStatus: DbPhaseStatus;
  photosStatus: DbPhaseStatus;
  aiReviewsStatus: DbPhaseStatus;
  aiPhotosStatus: DbPhaseStatus;
  triageStatus: DbPhaseStatus;
  details: Prisma.InputJsonValue | typeof Prisma.DbNull;
  aiReviews: Prisma.InputJsonValue | typeof Prisma.DbNull;
  aiPhotos: Prisma.InputJsonValue | typeof Prisma.DbNull;
  triage: Prisma.InputJsonValue | typeof Prisma.DbNull;
  reviewCount: number | null;
  photoCount: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
}

function toStoredAnalysisValue(
  value: Prisma.JsonValue | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value == null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function createReviewJobAnalysisSnapshot(
  listing: {
    id: string;
    analysis: {
      status: DbPhaseStatus;
      currentPhase: string;
      errorMessage: string | null;
      detailsStatus: DbPhaseStatus;
      reviewsStatus: DbPhaseStatus;
      photosStatus: DbPhaseStatus;
      aiReviewsStatus: DbPhaseStatus;
      aiPhotosStatus: DbPhaseStatus;
      triageStatus: DbPhaseStatus;
      details: Prisma.JsonValue | null;
      aiReviews: Prisma.JsonValue | null;
      aiPhotos: Prisma.JsonValue | null;
      triage: Prisma.JsonValue | null;
      reviewCount: number | null;
      photoCount: number | null;
      startedAt: Date | null;
      completedAt: Date | null;
      durationMs: number | null;
    } | null;
  },
): ReviewJobListingAnalysisSnapshot | null {
  if (!listing.analysis) {
    return null;
  }

  return {
    jobListingId: listing.id,
    status: listing.analysis.status,
    currentPhase: listing.analysis.currentPhase,
    errorMessage: listing.analysis.errorMessage,
    detailsStatus: listing.analysis.detailsStatus,
    reviewsStatus: listing.analysis.reviewsStatus,
    photosStatus: listing.analysis.photosStatus,
    aiReviewsStatus: listing.analysis.aiReviewsStatus,
    aiPhotosStatus: listing.analysis.aiPhotosStatus,
    triageStatus: listing.analysis.triageStatus,
    details: toStoredAnalysisValue(listing.analysis.details),
    aiReviews: toStoredAnalysisValue(listing.analysis.aiReviews),
    aiPhotos: toStoredAnalysisValue(listing.analysis.aiPhotos),
    triage: toStoredAnalysisValue(listing.analysis.triage),
    reviewCount: listing.analysis.reviewCount,
    photoCount: listing.analysis.photoCount,
    startedAt: listing.analysis.startedAt,
    completedAt: listing.analysis.completedAt,
    durationMs: listing.analysis.durationMs,
  };
}

async function restoreReviewJobAnalysisSnapshots(
  tx: Prisma.TransactionClient,
  snapshots: ReviewJobListingAnalysisSnapshot[],
) {
  for (const snapshot of snapshots) {
    await tx.reviewJobListingAnalysis.upsert({
      where: { jobListingId: snapshot.jobListingId },
      create: {
        jobListingId: snapshot.jobListingId,
        status: snapshot.status,
        currentPhase: snapshot.currentPhase,
        errorMessage: snapshot.errorMessage,
        detailsStatus: snapshot.detailsStatus,
        reviewsStatus: snapshot.reviewsStatus,
        photosStatus: snapshot.photosStatus,
        aiReviewsStatus: snapshot.aiReviewsStatus,
        aiPhotosStatus: snapshot.aiPhotosStatus,
        triageStatus: snapshot.triageStatus,
        details: snapshot.details,
        aiReviews: snapshot.aiReviews,
        aiPhotos: snapshot.aiPhotos,
        triage: snapshot.triage,
        reviewCount: snapshot.reviewCount,
        photoCount: snapshot.photoCount,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        durationMs: snapshot.durationMs,
      },
      update: {
        status: snapshot.status,
        currentPhase: snapshot.currentPhase,
        errorMessage: snapshot.errorMessage,
        detailsStatus: snapshot.detailsStatus,
        reviewsStatus: snapshot.reviewsStatus,
        photosStatus: snapshot.photosStatus,
        aiReviewsStatus: snapshot.aiReviewsStatus,
        aiPhotosStatus: snapshot.aiPhotosStatus,
        triageStatus: snapshot.triageStatus,
        details: snapshot.details,
        aiReviews: snapshot.aiReviews,
        aiPhotos: snapshot.aiPhotos,
        triage: snapshot.triage,
        reviewCount: snapshot.reviewCount,
        photoCount: snapshot.photoCount,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        durationMs: snapshot.durationMs,
      },
    });
  }
}

function getManifestEntryError(entry: PersistableManifestEntry): string | null {
  return (
    entry.triage.error
    ?? entry.aiPhotos.error
    ?? entry.aiReviews.error
    ?? entry.photos.error
    ?? entry.reviews.error
    ?? entry.details.error
    ?? null
  );
}

function readArtifactJson(
  artifactRoot: string,
  relativePath: string | undefined,
): Record<string, unknown> | null {
  if (!relativePath) {
    return null;
  }

  return readJsonFile<Record<string, unknown>>(path.join(artifactRoot, relativePath));
}

function getResolvedPoiDistanceMeters(input: {
  poi: { lat: number; lng: number } | null;
  listing: Pick<ReviewJobListingPersistenceRow, 'lat' | 'lng' | 'poiDistanceMeters'>;
  coordinates: { lat: number; lng: number } | null;
}): number | null {
  if (input.poi && input.coordinates) {
    return getPoiDistanceMeters(input.poi, input.coordinates);
  }

  if (input.poi && input.listing.lat != null && input.listing.lng != null) {
    return getPoiDistanceMeters(input.poi, {
      lat: input.listing.lat,
      lng: input.listing.lng,
    });
  }

  return input.listing.poiDistanceMeters;
}

function getDetailsJsonWithPoiContext(input: {
  artifactRoot: string;
  entry: PersistableManifestEntry;
  poi: { lat: number; lng: number } | null;
  listing: ReviewJobListingPersistenceRow;
}): {
  details: Record<string, unknown> | null;
  poiDistanceMeters: number | null;
} {
  const details = readArtifactJson(input.artifactRoot, input.entry.details.file);
  const detailCoordinates = details ? asStoredMapPoint(details.coordinates) : null;
  const fallbackCoordinates =
    input.listing.lat != null && input.listing.lng != null
      ? { lat: input.listing.lat, lng: input.listing.lng }
      : null;
  const resolvedCoordinates = detailCoordinates ?? fallbackCoordinates;
  const poiDistanceMeters = getResolvedPoiDistanceMeters({
    poi: input.poi,
    listing: input.listing,
    coordinates: resolvedCoordinates,
  });

  if (!details) {
    return {
      details: null,
      poiDistanceMeters,
    };
  }

  const nextDetails: Record<string, unknown> = { ...details };

  if (input.poi) {
    nextDetails.poi = input.poi;
    nextDetails.poiDistanceMeters = poiDistanceMeters;
  }

  if (!detailCoordinates && fallbackCoordinates) {
    nextDetails.coordinates = fallbackCoordinates;
  }

  return {
    details: nextDetails,
    poiDistanceMeters,
  };
}

async function persistReviewJobManifestEntryToDb(input: {
  artifactRoot: string;
  poi: { lat: number; lng: number } | null;
  listing: ReviewJobListingPersistenceRow;
  entry: PersistableManifestEntry;
  currentPhase: string;
  finalize?: boolean;
}) {
  const { details, poiDistanceMeters } = getDetailsJsonWithPoiContext({
    artifactRoot: input.artifactRoot,
    entry: input.entry,
    poi: input.poi,
    listing: input.listing,
  });
  const aiReviews = readArtifactJson(input.artifactRoot, input.entry.aiReviews.file);
  const aiPhotos = readArtifactJson(input.artifactRoot, input.entry.aiPhotos.file);
  const triage = readArtifactJson(input.artifactRoot, input.entry.triage.file);
  const terminalStatus = summarizeManifestEntryStatus(input.entry);
  const completedAt =
    input.finalize && ['completed', 'partial', 'failed', 'skipped'].includes(terminalStatus)
      ? new Date()
      : null;
  const durationMs =
    completedAt && input.listing.analysis?.startedAt
      ? completedAt.getTime() - input.listing.analysis.startedAt.getTime()
      : null;

  await prisma.$transaction(async (tx) => {
    await tx.reviewJobListing.update({
      where: { id: input.listing.id },
      data: {
        poiDistanceMeters: poiDistanceMeters ?? null,
      },
    });

    await tx.reviewJobListingAnalysis.upsert({
      where: { jobListingId: input.listing.id },
      create: {
        jobListingId: input.listing.id,
        status: terminalStatus,
        currentPhase: input.currentPhase,
        detailsStatus: toPhaseStatus(input.entry.details.status),
        reviewsStatus: toPhaseStatus(input.entry.reviews.status),
        photosStatus: toPhaseStatus(input.entry.photos.status),
        aiReviewsStatus: toPhaseStatus(input.entry.aiReviews.status),
        aiPhotosStatus: toPhaseStatus(input.entry.aiPhotos.status),
        triageStatus: toPhaseStatus(input.entry.triage.status),
        errorMessage: getManifestEntryError(input.entry),
        details: details == null ? Prisma.DbNull : (details as Prisma.InputJsonValue),
        aiReviews: aiReviews == null ? Prisma.DbNull : (aiReviews as Prisma.InputJsonValue),
        aiPhotos: aiPhotos == null ? Prisma.DbNull : (aiPhotos as Prisma.InputJsonValue),
        triage: triage == null ? Prisma.DbNull : (triage as Prisma.InputJsonValue),
        reviewCount: input.entry.reviews.count ?? null,
        photoCount: input.entry.photos.count ?? null,
        completedAt,
        durationMs,
      },
      update: {
        status: terminalStatus,
        currentPhase: input.currentPhase,
        detailsStatus: toPhaseStatus(input.entry.details.status),
        reviewsStatus: toPhaseStatus(input.entry.reviews.status),
        photosStatus: toPhaseStatus(input.entry.photos.status),
        aiReviewsStatus: toPhaseStatus(input.entry.aiReviews.status),
        aiPhotosStatus: toPhaseStatus(input.entry.aiPhotos.status),
        triageStatus: toPhaseStatus(input.entry.triage.status),
        errorMessage: getManifestEntryError(input.entry),
        details: details == null ? Prisma.DbNull : (details as Prisma.InputJsonValue),
        aiReviews: aiReviews == null ? Prisma.DbNull : (aiReviews as Prisma.InputJsonValue),
        aiPhotos: aiPhotos == null ? Prisma.DbNull : (aiPhotos as Prisma.InputJsonValue),
        triage: triage == null ? Prisma.DbNull : (triage as Prisma.InputJsonValue),
        reviewCount: input.entry.reviews.count ?? null,
        photoCount: input.entry.photos.count ?? null,
        completedAt: completedAt ?? undefined,
        durationMs: durationMs ?? undefined,
      },
    });
  });
}

async function syncReviewJobArtifactsToDb(input: {
  reviewJobId: string;
  artifactRoot: string;
  poi: { lat: number; lng: number } | null;
}) {
  const manifestPath = getManifestPathFromRoot(input.artifactRoot);
  const manifest = readJsonFile<AnalysisManifest>(manifestPath);
  if (!manifest) {
    throw new Error(`Batch manifest not found: ${manifestPath}`);
  }

  const listings = await prisma.reviewJobListing.findMany({
    where: { jobId: input.reviewJobId, hidden: false },
    include: { analysis: true },
  });

  const listingByKey = new Map(
    listings.map((listing) => [
      getListingMatchKey(listing.platform, listing.url),
      listing,
    ]),
  );

  for (const entry of Object.values(manifest.listings)) {
    const key = getListingMatchKey(entry.platform, entry.url);
    const listing = listingByKey.get(key);
    if (!listing) {
      continue;
    }

    await persistReviewJobManifestEntryToDb({
      artifactRoot: input.artifactRoot,
      poi: input.poi,
      listing,
      entry,
      currentPhase: 'completed',
      finalize: true,
    });
  }

  return {
    manifest,
  };
}

async function runReviewJobAnalysis(reviewJobId: string) {
  await ensureReviewJobAnalysisRows(reviewJobId);

  const jobRecord = await prisma.reviewJob.findUnique({
    where: { id: reviewJobId },
    include: {
      listings: {
        where: { hidden: false },
        orderBy: { createdAt: 'asc' },
        include: { analysis: true },
      },
    },
  });

  if (!jobRecord) {
    throw new Error(`Review job ${reviewJobId} not found`);
  }

  if (jobRecord.listings.length === 0) {
    throw new Error(`Review job ${reviewJobId} has no listings to analyze`);
  }

  const selectedListings = jobRecord.listings.filter((listing) => listing.selected);
  const activeListings = selectedListings.length > 0 ? selectedListings : jobRecord.listings;
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, '-');
  const { rootDir: artifactRoot, urlsFilePath } = prepareReviewJobRunWorkspace({
    jobId: reviewJobId,
    runId,
    previousArtifactRoot: jobRecord.artifactRoot,
    listings: activeListings,
    dates: {
      checkIn: jobRecord.checkin ?? undefined,
      checkOut: jobRecord.checkout ?? undefined,
      adults: jobRecord.adults,
    },
  });
  const analysisModel = process.env.LLM_MODEL || 'gemini-3-flash-preview:high';
  const poi = asStoredMapPoint(jobRecord.poi);
  const activeListingByKey = new Map(
    activeListings.map((listing) => [
      getListingMatchKey(listing.platform, listing.url),
      {
        ...listing,
        analysis: { startedAt },
      },
    ]),
  );
  const previousAnalysisSnapshots = activeListings
    .map((listing) => createReviewJobAnalysisSnapshot(listing))
    .filter((snapshot): snapshot is ReviewJobListingAnalysisSnapshot => snapshot != null);
  const hadPersistedResults =
    jobRecord.analysisStatus === 'completed' || jobRecord.analysisStatus === 'partial';
  const previousJobState = {
    status: jobRecord.status,
    currentPhase: jobRecord.currentPhase,
    analysisStatus: jobRecord.analysisStatus,
    analysisCurrentPhase: jobRecord.analysisCurrentPhase,
    analysisProgress: jobRecord.analysisProgress,
    analysisStartedAt: jobRecord.analysisStartedAt,
    analysisCompletedAt: jobRecord.analysisCompletedAt,
    analysisDurationMs: jobRecord.analysisDurationMs,
    artifactRoot: jobRecord.artifactRoot,
    reportPath: jobRecord.reportPath,
  };
  const activeListingIds = activeListings.map((listing) => listing.id);
  const hasSelectedSubset = selectedListings.length > 0;
  const inactiveListingIds = hasSelectedSubset
    ? jobRecord.listings
      .filter((listing) => !listing.selected)
      .map((listing) => listing.id)
    : [];

  fs.writeFileSync(
    urlsFilePath,
    `${activeListings.map((listing) => listing.url).join('\n')}\n`,
    'utf-8',
  );

  await prisma.$transaction(async (tx) => {
    await tx.reviewJobListingAnalysis.updateMany({
      where: {
        jobListingId: {
          in: activeListingIds,
        },
      },
      data: {
        status: 'running',
        currentPhase: 'queued',
        errorMessage: null,
        startedAt,
        completedAt: null,
        durationMs: null,
      },
    });
    await tx.reviewJob.update({
      where: { id: reviewJobId },
      data: {
        status: 'running',
        currentPhase: 'analysis',
        analysisStatus: 'running',
        analysisCurrentPhase: 'queued',
        analysisProgress: 0.01,
        analysisErrorMessage: null,
        analysisStartedAt: startedAt,
        analysisCompletedAt: null,
        analysisDurationMs: null,
      },
    });
  });

  await appendReviewJobEvent(reviewJobId, {
    phase: 'analysis',
    level: 'info',
    message: `Started analysis for ${activeListings.length} listings`,
    payload: {
      listingCount: activeListings.length,
      artifactRoot,
      model: analysisModel,
    },
  });

  try {
    await runBatch([urlsFilePath], {
      fetchDetails: true,
      fetchReviews: true,
      fetchPhotos: true,
      aiReviews: true,
      aiPhotos: true,
      triage: true,
      aiModel: analysisModel,
      aiPriorities: jobRecord.prompt?.trim() || undefined,
      aiReviewsExplicit: true,
      aiPhotosExplicit: true,
      triageExplicit: true,
      checkIn: jobRecord.checkin ?? undefined,
      checkOut: jobRecord.checkout ?? undefined,
      adults: jobRecord.adults,
      force: false,
      retryFailed: false,
      downloadPhotosAll: false,
      outputDir: artifactRoot,
      print: false,
      programmatic: true,
      hooks: {
        onEvent: async (event) => {
          const nextState = resolveAnalysisEventState(event);
          await prisma.reviewJob.update({
            where: { id: reviewJobId },
            data: {
              status: 'running',
              currentPhase: 'analysis',
              analysisStatus: 'running',
              analysisCurrentPhase: nextState.currentPhase,
              analysisProgress: nextState.progress,
            },
          });

          await appendReviewJobEvent(reviewJobId, {
            phase: event.phase === 'batch' ? 'analysis' : event.phase,
            level: event.level,
            message: event.message,
            listingId: event.listingId ?? null,
            listingPlatform: event.platform ?? null,
            payload: (event.payload ?? undefined) as Prisma.InputJsonValue | undefined,
          });
        },
        onPhaseUpdate: async (phaseUpdate) => {
          const listing = activeListingByKey.get(
            getListingMatchKey(phaseUpdate.entry.platform, phaseUpdate.entry.url),
          );
          if (!listing) {
            return;
          }

          await persistReviewJobManifestEntryToDb({
            artifactRoot: phaseUpdate.outputDir,
            poi,
            listing,
            entry: phaseUpdate.entry,
            currentPhase: phaseUpdate.phase,
          });
        },
        onScrapeComplete: async ({ outputDir, manifest }) => {
          injectPoiContextIntoListingArtifacts({
            rootDir: outputDir,
            manifest,
            poi,
            fallbackListings: activeListings.map((listing) => ({
              platform: listing.platform,
              url: listing.url,
              lat: listing.lat,
              lng: listing.lng,
              poiDistanceMeters: listing.poiDistanceMeters,
            })),
          });
          await prisma.reviewJob.update({
            where: { id: reviewJobId },
            data: {
              analysisCurrentPhase: 'scrape-complete',
              analysisProgress: Math.max(0.4, getAnalysisPhaseProgress('scrape')),
            },
          });
        },
      },
    });

    let reportPath: string | null = null;
    try {
      await appendReviewJobEvent(reviewJobId, {
        phase: 'report',
        level: 'info',
        message: 'Generating results report',
      });
      const nextReportPath = getReportPathFromRoot(artifactRoot);
      await generateReport({
        outputDir: artifactRoot,
        outputFile: nextReportPath,
      });
      reportPath = nextReportPath;
    } catch (error) {
      await appendReviewJobEvent(reviewJobId, {
        phase: 'report',
        level: 'warning',
        message:
          error instanceof Error
            ? `Report generation failed: ${error.message}`
            : 'Report generation failed',
      });
    }

    await syncReviewJobArtifactsToDb({
      reviewJobId,
      artifactRoot,
      poi,
    });

    const completedAt = new Date();
    let overallStatus: 'completed' | 'partial' | 'failed' = 'completed';
    await prisma.$transaction(async (tx) => {
      if (inactiveListingIds.length > 0) {
        await tx.reviewJobListingAnalysis.updateMany({
          where: {
            jobListingId: {
              in: inactiveListingIds,
            },
          },
          data: {
            status: 'pending',
            currentPhase: 'pending',
            errorMessage: null,
            startedAt: null,
            completedAt: null,
            durationMs: null,
            detailsStatus: 'pending',
            reviewsStatus: 'pending',
            photosStatus: 'pending',
            aiReviewsStatus: 'pending',
            aiPhotosStatus: 'pending',
            triageStatus: 'pending',
            details: Prisma.DbNull,
            aiReviews: Prisma.DbNull,
            aiPhotos: Prisma.DbNull,
            triage: Prisma.DbNull,
            reviewCount: null,
            photoCount: null,
          },
        });
      }

      const finalAnalyses = await tx.reviewJobListingAnalysis.findMany({
        where: {
          jobListing: {
            jobId: reviewJobId,
            hidden: false,
          },
        },
        select: { status: true },
      });
      overallStatus = summarizeAnalysisStatus(finalAnalyses);
      const resultsReady =
        overallStatus === 'completed' || overallStatus === 'partial';

      await tx.reviewJob.update({
        where: { id: reviewJobId },
        data: {
          status: 'completed',
          currentPhase: resultsReady ? 'results-ready' : 'analysis-complete',
          analysisStatus: overallStatus,
          analysisCurrentPhase: 'completed',
          analysisProgress: 1,
          analysisErrorMessage: null,
          analysisCompletedAt: completedAt,
          analysisDurationMs: completedAt.getTime() - startedAt.getTime(),
          artifactRoot,
          reportPath,
        },
      });
      await tx.reviewJobEvent.create({
        data: buildReviewJobEventData(reviewJobId, {
          phase: 'analysis',
          level: overallStatus === 'completed' ? 'info' : 'warning',
          message: 'Analysis completed',
          payload: {
            status: overallStatus,
            listingCount: activeListings.length,
            resultsReady,
            legacyReportAvailable: !!reportPath,
            selectedSubset: hasSelectedSubset,
          },
        }),
      });
    });

    console.log(
      `[review-worker] analysis completed ${reviewJobId} with status ${overallStatus}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Review job analysis failed';
    const completedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await restoreReviewJobAnalysisSnapshots(tx, previousAnalysisSnapshots);
      await tx.reviewJob.update({
        where: { id: reviewJobId },
        data: {
          status: hadPersistedResults ? previousJobState.status : 'failed',
          currentPhase: hadPersistedResults
            ? previousJobState.currentPhase
            : 'analysis',
          analysisStatus: hadPersistedResults
            ? previousJobState.analysisStatus
            : 'failed',
          analysisCurrentPhase: hadPersistedResults
            ? previousJobState.analysisCurrentPhase
            : 'failed',
          analysisProgress: hadPersistedResults
            ? previousJobState.analysisProgress
            : 0,
          analysisErrorMessage: message,
          analysisStartedAt: hadPersistedResults
            ? previousJobState.analysisStartedAt
            : startedAt,
          analysisCompletedAt: hadPersistedResults
            ? previousJobState.analysisCompletedAt
            : completedAt,
          analysisDurationMs: hadPersistedResults
            ? previousJobState.analysisDurationMs
            : completedAt.getTime() - startedAt.getTime(),
          artifactRoot: previousJobState.artifactRoot,
          reportPath: previousJobState.reportPath,
        },
      });
      await tx.reviewJobEvent.create({
        data: buildReviewJobEventData(reviewJobId, {
          phase: 'analysis',
          level: hadPersistedResults ? 'warning' : 'error',
          message: hadPersistedResults
            ? `Analysis rerun failed; previous results preserved. ${message}`
            : message,
        }),
      });
    });

    throw error;
  }
}

const worker = new Worker<SearchQueueJobData>(
  SEARCH_QUEUE_NAME,
  async (job) => {
    await runSearchJob(job.data.searchJobId);
  },
  {
    connection: getRedisConnectionOptions(),
    concurrency: 1,
  },
);

const reviewJobWorker = new Worker<ReviewJobQueueData>(
  REVIEW_JOB_QUEUE_NAME,
  async (job) => {
    if (job.data.phase === 'search') {
      await runReviewJobSearch(job.data.reviewJobId);
      return;
    }

    await runReviewJobAnalysis(job.data.reviewJobId);
  },
  {
    connection: getRedisConnectionOptions(),
    concurrency: 1,
  },
);

worker.on('completed', (job) => {
  console.log(`[search-worker] BullMQ job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(
    `[search-worker] BullMQ job ${job?.id ?? 'unknown'} failed: ${error.message}`,
  );
});

reviewJobWorker.on('completed', (job) => {
  console.log(`[review-worker] BullMQ job ${job.id} completed`);
});

reviewJobWorker.on('failed', (job, error) => {
  console.error(
    `[review-worker] BullMQ job ${job?.id ?? 'unknown'} failed: ${error.message}`,
  );
});

const shutdown = async () => {
  await reviewJobWorker.close();
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

console.log('[search-worker] listening for queued search jobs');
console.log('[review-worker] listening for queued review jobs');
