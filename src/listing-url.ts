import type { Platform } from './utils.js';

export interface ParsedListingUrl {
  platform: Platform;
  listingId: string;
  normalizedUrl: string;
  matchKey: string;
  displayName: string;
}

export interface InvalidListingUrl {
  input: string;
  error: string;
}

export interface ParsedListingUrlBatch {
  listings: ParsedListingUrl[];
  invalid: InvalidListingUrl[];
  duplicateCount: number;
}

function parseUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('URL is empty');
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error('URL is malformed');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('URL must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL credentials are not supported');
  }

  return parsed;
}

function isBookingHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'booking.com' || lower.endsWith('.booking.com');
}

function isAirbnbHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'airbnb.com'
    || lower.endsWith('.airbnb.com')
    || /(^|\.)airbnb\.(?:com(?:\.[a-z]{2})?|[a-z]{2}(?:\.[a-z]{2})?)$/.test(lower)
  );
}

function titleFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function parseAirbnbListingUrl(parsed: URL): ParsedListingUrl {
  const roomId = parsed.pathname.match(/^\/rooms\/(\d+)(?:\/|$)/i)?.[1];
  if (!roomId) {
    throw new Error('Airbnb URL must contain /rooms/<numeric-id>');
  }

  return {
    platform: 'airbnb',
    listingId: roomId,
    normalizedUrl: `https://www.airbnb.com/rooms/${roomId}`,
    matchKey: `airbnb:${roomId}`,
    displayName: `Airbnb ${roomId}`,
  };
}

function parseBookingListingUrl(parsed: URL): ParsedListingUrl {
  const pathMatch = parsed.pathname.match(
    /^\/hotel\/([a-z]{2})\/([^/]+)\.html\/?$/i,
  );
  if (!pathMatch) {
    throw new Error(
      'Booking.com URL must contain /hotel/<country>/<hotel>.html',
    );
  }

  const countryCode = pathMatch[1].toLowerCase();
  const filenameStem = pathMatch[2];
  const hotelSlug = filenameStem
    .replace(/\.[a-z]{2}(?:-[a-z]{2})?$/i, '')
    .toLowerCase();
  if (!hotelSlug || !/^[a-z0-9][a-z0-9_-]*$/i.test(hotelSlug)) {
    throw new Error('Booking.com URL has an invalid hotel slug');
  }

  const normalized = new URL(
    `https://www.booking.com/hotel/${countryCode}/${hotelSlug}.en-gb.html`,
  );
  const matchingBlockId =
    parsed.searchParams.get('matching_block_id')
    ?? parsed.searchParams.get('highlighted_blocks');
  if (matchingBlockId) {
    normalized.searchParams.set('matching_block_id', matchingBlockId);
  }

  return {
    platform: 'booking',
    listingId: `${countryCode}/${hotelSlug}`,
    normalizedUrl: normalized.toString(),
    matchKey: `booking:${countryCode}/${hotelSlug}`,
    displayName: titleFromSlug(hotelSlug),
  };
}

export function parseListingUrl(input: string): ParsedListingUrl {
  const parsed = parseUrl(input);

  if (isAirbnbHost(parsed.hostname)) {
    return parseAirbnbListingUrl(parsed);
  }
  if (isBookingHost(parsed.hostname)) {
    return parseBookingListingUrl(parsed);
  }

  throw new Error('Only Airbnb and Booking.com listing URLs are supported');
}

export function parseListingUrls(
  inputs: readonly string[],
): ParsedListingUrlBatch {
  const listingsByKey = new Map<string, ParsedListingUrl>();
  const invalid: InvalidListingUrl[] = [];
  let duplicateCount = 0;

  for (const input of inputs) {
    try {
      const parsed = parseListingUrl(input);
      if (listingsByKey.has(parsed.matchKey)) {
        duplicateCount += 1;
        continue;
      }
      listingsByKey.set(parsed.matchKey, parsed);
    } catch (error) {
      invalid.push({
        input,
        error: error instanceof Error ? error.message : 'URL is invalid',
      });
    }
  }

  return {
    listings: [...listingsByKey.values()],
    invalid,
    duplicateCount,
  };
}
