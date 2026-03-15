import type { ReviewJobResponse } from '@/types';

export function shouldPollReviewJob(job: ReviewJobResponse['job']): boolean {
  return (
    job.status === 'pending'
    || job.status === 'running'
    || job.analysisStatus === 'running'
    || job.analysisCurrentPhase === 'queued'
  );
}
