import 'dotenv/config';

import { Worker } from 'bullmq';
import { bootstrapRuntimeProxyEnv } from '../../../src/config.js';
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
import type { SearchResult } from '../types.js';
import { searchAirbnb } from '../../../src/airbnb/search.js';
import { searchBooking } from '../../../src/booking/search.js';
import { filterResultsForRequest } from './resultFilters.js';

bootstrapRuntimeProxyEnv();

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

async function appendReviewJobEvent(
  reviewJobId: string,
  input: Parameters<typeof buildReviewJobEventData>[1],
) {
  await prisma.reviewJobEvent.create({
    data: buildReviewJobEventData(reviewJobId, input),
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
      toReviewJobListingRecord(reviewJobId, result),
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
      }
      await tx.reviewJob.update({
        where: { id: reviewJobId },
        data: {
          status: 'completed',
          currentPhase: 'awaiting-analysis',
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
    await runReviewJobSearch(job.data.reviewJobId);
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
