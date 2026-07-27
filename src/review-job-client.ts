import { parseListingUrls } from './listing-url.js';

export const REVIEW_JOB_OWNER_KEY_ENV = 'STAYREVIEWR_OWNER_KEY';
export const REVIEW_JOB_BASE_URL_ENV = 'STAYREVIEWR_BASE_URL';
export const DEFAULT_REVIEW_JOB_BASE_URL = 'http://localhost:3000';
const OWNER_KEY_COOKIE = 'stayreviewr_owner';

export interface AddReviewJobListingsResponse {
  jobId: string;
  status: 'queued' | 'unchanged';
  addedCount: number;
  duplicateCount: number;
  listingCount: number;
  message: string;
}

interface AddReviewJobListingsOptions {
  jobId: string;
  urls: string[];
  ownerKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function formatInvalidUrls(
  invalid: Array<{ input: string; error: string }>,
): string {
  return invalid
    .map((item) => `${item.input || '(empty)'}: ${item.error}`)
    .join('; ');
}

export async function addListingsToReviewJob(
  options: AddReviewJobListingsOptions,
): Promise<AddReviewJobListingsResponse> {
  const ownerKey = options.ownerKey.trim();
  if (!ownerKey) {
    throw new Error(
      `An owner key is required. Pass --owner-key or set `
      + `${REVIEW_JOB_OWNER_KEY_ENV}.`,
    );
  }

  const parsed = parseListingUrls(options.urls);
  if (parsed.invalid.length > 0) {
    throw new Error(`Invalid listing URL(s): ${formatInvalidUrls(parsed.invalid)}`);
  }
  if (parsed.listings.length === 0) {
    throw new Error('Provide at least one Airbnb or Booking.com listing URL.');
  }

  const baseUrl = options.baseUrl?.trim() || DEFAULT_REVIEW_JOB_BASE_URL;
  let endpoint: URL;
  try {
    endpoint = new URL(
      `/api/jobs/${encodeURIComponent(options.jobId)}/listings`,
      baseUrl,
    );
  } catch {
    throw new Error(`Invalid StayReviewr base URL: ${baseUrl}`);
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('StayReviewr base URL must use http or https.');
  }

  const response = await (options.fetchImpl ?? fetch)(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${OWNER_KEY_COOKIE}=${encodeURIComponent(ownerKey)}`,
    },
    body: JSON.stringify({
      urls: parsed.listings.map((listing) => listing.normalizedUrl),
    }),
  });
  const payload = await response.json().catch(() => null) as
    | Partial<AddReviewJobListingsResponse> & { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(
      payload?.error
      || `StayReviewr returned HTTP ${response.status}.`,
    );
  }
  if (
    !payload
    || typeof payload.message !== 'string'
    || (payload.status !== 'queued' && payload.status !== 'unchanged')
  ) {
    throw new Error('StayReviewr returned an invalid add-listings response.');
  }

  return payload as AddReviewJobListingsResponse;
}
