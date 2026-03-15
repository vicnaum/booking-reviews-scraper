'use client';

import { useEffect } from 'react';
import type { ReviewJobResponse } from '@/types';
import { shouldPollReviewJob } from '@/lib/reviewJobStatus';

const REVIEW_JOB_POLL_INTERVAL_MS = 2500;

export function useReviewJobPolling(
  job: ReviewJobResponse['job'],
  refreshJob: () => Promise<void>,
  onStreamJob?: (nextData: ReviewJobResponse) => void,
) {
  useEffect(() => {
    if (!shouldPollReviewJob(job)) {
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
      eventSource = new EventSource(`/api/jobs/${job.id}/stream`);

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
  }, [job, onStreamJob, refreshJob]);
}
