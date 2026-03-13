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
  buildCliSearchParams,
  parseSearchFilters,
  toSearchResultRecord,
} from './searchJobs.js';
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

worker.on('completed', (job) => {
  console.log(`[search-worker] BullMQ job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(
    `[search-worker] BullMQ job ${job?.id ?? 'unknown'} failed: ${error.message}`,
  );
});

const shutdown = async () => {
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
