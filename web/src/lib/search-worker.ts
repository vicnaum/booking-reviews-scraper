import * as fs from 'node:fs';
import * as path from 'node:path';
import { Prisma } from '@prisma/client';
import { Worker } from 'bullmq';
import { config as loadDotEnv } from 'dotenv';
import { runBatch, type BatchEvent } from '../../../src/batch.js';
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
  getReviewJobWorkspaceDir,
  injectPoiContextIntoListingArtifacts,
  pruneAnalysisManifestToListings,
  readJsonFile,
  summarizeAnalysisStatus,
  summarizeManifestEntryStatus,
  toPhaseStatus,
  type AnalysisManifest,
} from './review-job-analysis.js';
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

async function runSearchJob(searchJobId: string) {
  const jobRecord = await prisma.searchJob.findUnique({
    where: { id: searchJobId },
  });

  if (!jobRecord) {
    throw new Error(`Search job ${searchJobId} not found`);
  }

  const startedAt = new Date();
  let pagesScanned = 0;

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
      pagesScanned += 1;
      void prisma.searchJob
        .update({
          where: { id: searchJobId },
          data: {
            status: 'running',
            pagesScanned,
            progress: Math.min(0.95, 0.05 + pagesScanned * 0.03),
          },
        })
        .catch((error) => {
          console.error(
            `[search-worker] failed to persist progress: ${error.message}`,
          );
        });
    };

    const output =
      params.platform === 'airbnb'
        ? await searchAirbnb(params, onProgress)
        : await searchBooking(params, onProgress);

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
      pagesScanned += 1;
      void prisma.reviewJob
        .update({
          where: { id: reviewJobId },
          data: {
            status: 'running',
            currentPhase: `search:${platform}`,
            pagesScanned,
            progress: Math.min(0.95, 0.05 + pagesScanned * 0.02),
          },
        })
        .catch((error) => {
          console.error(
            `[review-worker] failed to persist progress: ${error.message}`,
          );
        });
    };

    const platforms: Array<'airbnb' | 'booking'> = ['airbnb', 'booking'];
    const allResults: SearchResult[] = [];

    for (const platform of platforms) {
      await appendReviewJobEvent(reviewJobId, {
        phase: 'search',
        level: 'info',
        message: `Searching ${platform}`,
        payload: { platform },
      });

      let output;
      if (platform === 'airbnb') {
        const params = buildReviewJobPlatformParams(jobRecord, platform);
        output = await searchAirbnb(params, () => persistProgress(platform));
      } else {
        const params = buildReviewJobPlatformParams(jobRecord, platform);
        output = await searchBooking(params, () => persistProgress(platform));
      }

      const filteredResults = filterResultsForRequest(output.results, requestFilters);
      allResults.push(...filteredResults);
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
        },
      });
      await tx.reviewJobEvent.create({
        data: buildReviewJobEventData(reviewJobId, {
          phase: 'search',
          level: 'info',
          message: 'Combined full search completed',
          payload: {
            totalResults: rows.length,
            pagesScanned,
            durationMs,
          },
        }),
      });
    });
    searchLogger.log('completed', {
      totalResults: rows.length,
      pagesScanned,
      durationMs,
    });

    console.log(
      `[review-worker] completed ${reviewJobId} with ${rows.length} results`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Review job search failed';
    const completedAt = new Date();

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

    const details =
      entry.details.file
        ? readJsonFile<Record<string, unknown>>(
            path.join(input.artifactRoot, entry.details.file),
          )
        : null;
    const aiReviews =
      entry.aiReviews.file
        ? readJsonFile<Record<string, unknown>>(
            path.join(input.artifactRoot, entry.aiReviews.file),
          )
        : null;
    const aiPhotos =
      entry.aiPhotos.file
        ? readJsonFile<Record<string, unknown>>(
            path.join(input.artifactRoot, entry.aiPhotos.file),
          )
        : null;
    const triage =
      entry.triage.file
        ? readJsonFile<Record<string, unknown>>(
            path.join(input.artifactRoot, entry.triage.file),
          )
        : null;

    const poiDistanceMeters =
      input.poi && listing.lat != null && listing.lng != null
        ? getPoiDistanceMeters(input.poi, { lat: listing.lat, lng: listing.lng })
        : listing.poiDistanceMeters;

    await prisma.$transaction(async (tx) => {
      await tx.reviewJobListing.update({
        where: { id: listing.id },
        data: {
          poiDistanceMeters: poiDistanceMeters ?? null,
        },
      });

      await tx.reviewJobListingAnalysis.upsert({
        where: { jobListingId: listing.id },
        create: {
          jobListingId: listing.id,
          status: summarizeManifestEntryStatus(entry),
          currentPhase: 'completed',
          detailsStatus: toPhaseStatus(entry.details.status),
          reviewsStatus: toPhaseStatus(entry.reviews.status),
          photosStatus: toPhaseStatus(entry.photos.status),
          aiReviewsStatus: toPhaseStatus(entry.aiReviews.status),
          aiPhotosStatus: toPhaseStatus(entry.aiPhotos.status),
          triageStatus: toPhaseStatus(entry.triage.status),
          errorMessage:
            entry.triage.error
            ?? entry.aiPhotos.error
            ?? entry.aiReviews.error
            ?? entry.photos.error
            ?? entry.reviews.error
            ?? entry.details.error
            ?? null,
          details: details == null ? Prisma.DbNull : (details as Prisma.InputJsonValue),
          aiReviews: aiReviews == null ? Prisma.DbNull : (aiReviews as Prisma.InputJsonValue),
          aiPhotos: aiPhotos == null ? Prisma.DbNull : (aiPhotos as Prisma.InputJsonValue),
          triage: triage == null ? Prisma.DbNull : (triage as Prisma.InputJsonValue),
          reviewCount: entry.reviews.count ?? null,
          photoCount: entry.photos.count ?? null,
        },
        update: {
          status: summarizeManifestEntryStatus(entry),
          currentPhase: 'completed',
          detailsStatus: toPhaseStatus(entry.details.status),
          reviewsStatus: toPhaseStatus(entry.reviews.status),
          photosStatus: toPhaseStatus(entry.photos.status),
          aiReviewsStatus: toPhaseStatus(entry.aiReviews.status),
          aiPhotosStatus: toPhaseStatus(entry.aiPhotos.status),
          triageStatus: toPhaseStatus(entry.triage.status),
          errorMessage:
            entry.triage.error
            ?? entry.aiPhotos.error
            ?? entry.aiReviews.error
            ?? entry.photos.error
            ?? entry.reviews.error
            ?? entry.details.error
            ?? null,
          details: details == null ? Prisma.DbNull : (details as Prisma.InputJsonValue),
          aiReviews: aiReviews == null ? Prisma.DbNull : (aiReviews as Prisma.InputJsonValue),
          aiPhotos: aiPhotos == null ? Prisma.DbNull : (aiPhotos as Prisma.InputJsonValue),
          triage: triage == null ? Prisma.DbNull : (triage as Prisma.InputJsonValue),
          reviewCount: entry.reviews.count ?? null,
          photoCount: entry.photos.count ?? null,
          completedAt: new Date(),
        },
      });
    });
  }

  const finalAnalyses = await prisma.reviewJobListingAnalysis.findMany({
    where: {
      jobListing: {
        jobId: input.reviewJobId,
        hidden: false,
      },
    },
    select: { status: true },
  });

  return {
    manifest,
    overallStatus: summarizeAnalysisStatus(finalAnalyses),
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
  const artifactRoot = getReviewJobWorkspaceDir(reviewJobId);
  const urlsFilePath = path.join(artifactRoot, 'job_urls.txt');
  const analysisModel = process.env.LLM_MODEL || 'gemini-3-flash-preview:high';
  const poi = asStoredMapPoint(jobRecord.poi);
  const startedAt = new Date();

  fs.mkdirSync(artifactRoot, { recursive: true });
  pruneAnalysisManifestToListings({
    rootDir: artifactRoot,
    listings: activeListings,
    dates: {
      checkIn: jobRecord.checkin ?? undefined,
      checkOut: jobRecord.checkout ?? undefined,
      adults: jobRecord.adults,
    },
  });
  fs.writeFileSync(
    urlsFilePath,
    `${activeListings.map((listing) => listing.url).join('\n')}\n`,
    'utf-8',
  );

  await prisma.$transaction(async (tx) => {
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
        artifactRoot,
        reportPath: null,
      },
    });

    await tx.reviewJobListingAnalysis.updateMany({
      where: {
        jobListingId: {
          in: activeListings.map((listing) => listing.id),
        },
      },
      data: {
        status: 'pending',
        currentPhase: 'queued',
        errorMessage: null,
        startedAt,
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

    const { overallStatus } = await syncReviewJobArtifactsToDb({
      reviewJobId,
      artifactRoot,
      poi,
    });

    const completedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.reviewJob.update({
        where: { id: reviewJobId },
        data: {
          status: 'completed',
          currentPhase: reportPath ? 'results-ready' : 'analysis-complete',
          analysisStatus: overallStatus,
          analysisCurrentPhase: reportPath ? 'report' : 'completed',
          analysisProgress: 1,
          analysisErrorMessage: null,
          analysisCompletedAt: completedAt,
          analysisDurationMs: completedAt.getTime() - startedAt.getTime(),
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
            reportReady: !!reportPath,
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
      await tx.reviewJob.update({
        where: { id: reviewJobId },
        data: {
          status: 'failed',
          currentPhase: 'analysis',
          analysisStatus: 'failed',
          analysisCurrentPhase: 'failed',
          analysisErrorMessage: message,
          analysisCompletedAt: completedAt,
          analysisDurationMs: completedAt.getTime() - startedAt.getTime(),
        },
      });
      await tx.reviewJobEvent.create({
        data: buildReviewJobEventData(reviewJobId, {
          phase: 'analysis',
          level: 'error',
          message,
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
