import { Queue } from 'bullmq';
import { getRedisConnectionOptions } from './redis.js';

export const REVIEW_JOB_QUEUE_NAME = 'stayreviewr-review-job';

export interface ReviewJobQueueData {
  reviewJobId: string;
  phase: 'search' | 'analyze';
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
  return getReviewJobQueue().add('run-review-job-search', {
    reviewJobId,
    phase: 'search',
  });
}

export async function enqueueReviewJobAnalysis(reviewJobId: string) {
  return getReviewJobQueue().add('run-review-job-analysis', {
    reviewJobId,
    phase: 'analyze',
  });
}
