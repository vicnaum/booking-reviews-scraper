import { Queue } from 'bullmq';
import { getRedisConnectionOptions } from './redis.js';

export const REVIEW_JOB_QUEUE_NAME = 'stayreviewr-review-job';

export interface ReviewJobQueueData {
  reviewJobId: string;
  phase: 'search' | 'analyze';
}

export function getReviewJobQueueJobId(
  phase: ReviewJobQueueData['phase'],
  reviewJobId: string,
): string {
  return `review-job:${phase}:${reviewJobId}`;
}

export function shouldReuseReviewJobQueueState(state: string): boolean {
  return [
    'waiting',
    'active',
    'delayed',
    'prioritized',
    'waiting-children',
  ].includes(state);
}

const globalForReviewJobQueue = globalThis as unknown as {
  reviewJobQueue?: Queue<ReviewJobQueueData>;
};

export function getReviewJobQueue(): Queue<ReviewJobQueueData> {
  if (!globalForReviewJobQueue.reviewJobQueue) {
    globalForReviewJobQueue.reviewJobQueue = new Queue<ReviewJobQueueData>(
      REVIEW_JOB_QUEUE_NAME,
      {
        connection: getRedisConnectionOptions(),
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      },
    );
  }

  return globalForReviewJobQueue.reviewJobQueue;
}

export async function enqueueReviewJobSearch(reviewJobId: string) {
  const queue = getReviewJobQueue();
  const jobId = getReviewJobQueueJobId('search', reviewJobId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (shouldReuseReviewJobQueueState(state)) {
      return existing;
    }
    await existing.remove().catch(() => {});
  }

  return queue.add('run-review-job-search', {
    reviewJobId,
    phase: 'search',
  }, {
    jobId,
  });
}

export async function enqueueReviewJobAnalysis(reviewJobId: string) {
  const queue = getReviewJobQueue();
  const jobId = getReviewJobQueueJobId('analyze', reviewJobId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (shouldReuseReviewJobQueueState(state)) {
      return existing;
    }
    await existing.remove().catch(() => {});
  }

  return queue.add('run-review-job-analysis', {
    reviewJobId,
    phase: 'analyze',
  }, {
    jobId,
  });
}
