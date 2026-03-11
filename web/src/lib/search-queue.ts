import { Queue } from 'bullmq';
import { getRedisConnectionOptions } from './redis.js';

export const SEARCH_QUEUE_NAME = 'stayreviewr-search';

export interface SearchQueueJobData {
  searchJobId: string;
}

const globalForSearchQueue = globalThis as unknown as {
  searchQueue?: Queue<SearchQueueJobData>;
};

export function getSearchQueue(): Queue<SearchQueueJobData> {
  if (!globalForSearchQueue.searchQueue) {
    globalForSearchQueue.searchQueue = new Queue<SearchQueueJobData>(
      SEARCH_QUEUE_NAME,
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

  return globalForSearchQueue.searchQueue;
}

export async function enqueueSearchJob(searchJobId: string) {
  return getSearchQueue().add('run-search', { searchJobId });
}
