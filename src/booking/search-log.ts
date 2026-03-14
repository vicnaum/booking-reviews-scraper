import * as fs from 'fs';
import * as path from 'path';

import type { BookingSearchParams } from '../search/types.js';

export interface BookingSearchLogger {
  readonly searchId: string;
  readonly filePath: string | null;
  log(event: string, data?: Record<string, unknown>): void;
}

interface CreateBookingSearchLoggerOptions {
  params: BookingSearchParams;
  mode: 'quick' | 'exhaustive';
  useBboxSearch: boolean;
}

function makeSearchId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildLogDir(): string {
  return path.resolve(
    process.cwd(),
    process.env.BOOKING_SEARCH_LOG_DIR || path.join('data', 'booking', 'search-logs'),
  );
}

function sanitizeParams(params: BookingSearchParams): Record<string, unknown> {
  return {
    platform: params.platform,
    location: params.location ?? null,
    destId: params.destId ?? null,
    boundingBox: params.boundingBox ?? null,
    circle: params.circle ?? null,
    checkin: params.checkin ?? null,
    checkout: params.checkout ?? null,
    adults: params.adults,
    currency: params.currency,
    minRating: params.minRating ?? null,
    minBedrooms: params.minBedrooms ?? null,
    minBeds: params.minBeds ?? null,
    priceMin: params.priceMin ?? null,
    priceMax: params.priceMax ?? null,
    propertyType: params.propertyType ?? null,
    stars: params.stars ?? null,
    freeCancellation: params.freeCancellation ?? null,
    maxResults: params.maxResults ?? null,
    exhaustive: params.exhaustive ?? false,
  };
}

export function createBookingSearchLogger(
  options: CreateBookingSearchLoggerOptions,
): BookingSearchLogger {
  const searchId = makeSearchId();
  if (process.env.BOOKING_SEARCH_LOG === 'false') {
    return {
      searchId,
      filePath: null,
      log() {},
    };
  }

  const dir = buildLogDir();
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(dir, `${timestamp}-${searchId}.jsonl`);
  let enabled = true;

  const write = (event: string, data: Record<string, unknown> = {}) => {
    if (!enabled) {
      return;
    }

    try {
      fs.appendFileSync(
        filePath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          searchId,
          event,
          ...data,
        })}\n`,
      );
    } catch (error) {
      enabled = false;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`⚠️  Failed to write Booking search log: ${message}`);
    }
  };

  write('search_started', {
    mode: options.mode,
    useBboxSearch: options.useBboxSearch,
    params: sanitizeParams(options.params),
  });

  return {
    searchId,
    filePath,
    log: write,
  };
}
