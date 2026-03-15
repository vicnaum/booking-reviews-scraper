'use client';

import { useEffect } from 'react';
import type { ReviewJobResponse } from '@/types';

const REVIEW_JOB_POLL_INTERVAL_MS = 2500;

export function shouldPollReviewJob(job: ReviewJobResponse['job']): boolean {
  return (
    job.status === 'pending'
    || job.status === 'running'
    || job.analysisStatus === 'running'
    || job.analysisCurrentPhase === 'queued'
  );
}

export function useReviewJobPolling(
  job: ReviewJobResponse['job'],
  refreshJob: () => Promise<void>,
) {
  useEffect(() => {
    if (!shouldPollReviewJob(job)) {
      return;
    }

    const interval = setInterval(() => {
      void refreshJob().catch(() => {});
    }, REVIEW_JOB_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [job, refreshJob]);
}
