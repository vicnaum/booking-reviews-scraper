'use client';

import { useEffect } from 'react';
import type { ReviewJobResponse } from '@/types';
import { shouldPollReviewJob } from '@/lib/reviewJobStatus';

const REVIEW_JOB_POLL_INTERVAL_MS = 2500;

export function useReviewJobPolling(
  job: ReviewJobResponse['job'],
  refreshJob: () => Promise<void>,
  onStreamJob?: (nextData: ReviewJobResponse) => void,
  options?: {
    keepSynced?: boolean;
  },
) {
  useEffect(() => {
    const keepSynced = options?.keepSynced ?? false;

    if (!keepSynced && !shouldPollReviewJob(job)) {
      return;
    }

    let isDisposed = false;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let eventSource: EventSource | null = null;

    const startPollingFallback = () => {
      if (isDisposed || fallbackInterval) {
        return;
      }

        fallbackInterval = setInterval(() => {
          void refreshJob().catch(() => {});
        }, REVIEW_JOB_POLL_INTERVAL_MS);
    };

    if (typeof window !== 'undefined' && 'EventSource' in window) {
      const streamUrl = keepSynced
        ? `/api/jobs/${job.id}/stream?watch=1`
        : `/api/jobs/${job.id}/stream`;
      eventSource = new EventSource(streamUrl);

      eventSource.addEventListener('job', (event) => {
        if (!onStreamJob) {
          void refreshJob().catch(() => {});
          return;
        }

        try {
          const nextData = JSON.parse((event as MessageEvent<string>).data) as ReviewJobResponse;
          onStreamJob(nextData);
        } catch {
          void refreshJob().catch(() => {});
        }
      });

      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        startPollingFallback();
      };
    } else {
      startPollingFallback();
    }

    return () => {
      isDisposed = true;
      eventSource?.close();
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    };
  }, [job, onStreamJob, options?.keepSynced, refreshJob]);
}
