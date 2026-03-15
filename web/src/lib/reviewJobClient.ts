import type { PriceDisplayMode, ReviewJobState, ReviewJobResponse } from '@/types';

export async function fetchReviewJobResponse(
  jobId: string,
): Promise<ReviewJobResponse> {
  const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error || 'Failed to refresh job');
  }

  return res.json() as Promise<ReviewJobResponse>;
}

export function getStoredReviewJobPriceDisplay(
  job: Pick<ReviewJobState, 'filters'>,
): PriceDisplayMode {
  return job.filters?.priceDisplay === 'perNight' ? 'perNight' : 'total';
}
