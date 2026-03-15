import type { ReviewJobResponse } from '@/types';

export async function fetchReviewJobResponse(
  jobId: string,
): Promise<ReviewJobResponse> {
  const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to refresh job');
  }

  return res.json() as Promise<ReviewJobResponse>;
}
