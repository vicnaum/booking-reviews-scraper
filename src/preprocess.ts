// src/preprocess.ts
//
// URL preprocessing: read URL files, deduplicate, extract dates, classify by platform
//
// Usage:
//   reviewr preprocess <file1> [file2] ...   # Process URL files
//   npx tsx src/preprocess.ts <file1> ...    # Direct execution

import * as fs from 'fs';
import { detectPlatform } from './utils.js';
import { extractHotelInfo } from './booking/scraper.js';
import { parseAirbnbUrl } from './airbnb/listing.js';

// --- Interfaces ---

export interface BookingUrlInfo {
  url: string;
  hotelName: string;
  countryCode: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  matchingBlockId?: string;
}

export interface AirbnbUrlInfo {
  url: string;
  roomId: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
}

export interface DateConsensus {
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  source: 'unanimous' | 'conflicting' | 'none';
}

export interface PreprocessResult {
  airbnb: {
    urls: string[];
    count: number;
    duplicatesRemoved: number;
  };
  booking: {
    urls: string[];
    count: number;
    duplicatesRemoved: number;
  };
  dates: DateConsensus;
}

// --- Tracking params to strip ---

const BOOKING_TRACKING_PARAMS = new Set([
  'aid', 'label', 'sid', 'dest_id', 'dest_type', 'srpvid', 'srepoch',
  'highlighted_hotels', 'redirected_from_city', 'redirected_from_landmark',
  'source', 'ucfs', 'activeTab', 'from_sustainable_property_sr',
  'from_sr_map', 'req_adults', 'req_children', 'req_rooms',
  'nflt', 'selected_currency', 'changed_currency', 'top_currency',
  'top_uf', 'soh', 'b_h4u_keep', 'b_h4u_skip', 'atlas_src',
]);

const AIRBNB_TRACKING_PARAMS = new Set([
  'source_impression_id', 'previous_page_section_name', 'federated_search_id',
  'search_id', 'category_tag', 'search_mode', 'price_filter_input_type',
  'price_filter_num_nights', 'channel', 'af', 'c', 'source',
  'modal', 'search_type', 'tab_id', 'refinement_paths',
]);

// --- URL Parsing ---

/**
 * Parse a Booking.com URL: extract hotel info, dates, and room selection params
 */
export function parseBookingUrl(url: string): BookingUrlInfo | null {
  const hotelInfo = extractHotelInfo(url);
  if (!hotelInfo) return null;

  const result: BookingUrlInfo = {
    url,
    hotelName: hotelInfo.hotel_name,
    countryCode: hotelInfo.country_code,
  };

  try {
    const parsed = new URL(url);
    const checkIn = parsed.searchParams.get('checkin');
    const checkOut = parsed.searchParams.get('checkout');
    const adults = parsed.searchParams.get('group_adults');
    const blockId = parsed.searchParams.get('matching_block_id') || parsed.searchParams.get('highlighted_blocks');

    if (checkIn) result.checkIn = checkIn;
    if (checkOut) result.checkOut = checkOut;
    if (adults) result.adults = parseInt(adults);
    if (blockId) result.matchingBlockId = blockId;
  } catch {
    // URL parsing failed, just use hotel info
  }

  return result;
}

/**
 * Clean a Booking URL: strip tracking params, preserve meaningful ones
 */
function cleanBookingUrl(info: BookingUrlInfo): string {
  let url = `https://www.booking.com/hotel/${info.countryCode}/${info.hotelName}.en-gb.html`;
  const params = new URLSearchParams();
  if (info.matchingBlockId) params.set('matching_block_id', info.matchingBlockId);
  if (info.checkIn) params.set('checkin', info.checkIn);
  if (info.checkOut) params.set('checkout', info.checkOut);
  if (info.adults) params.set('group_adults', String(info.adults));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * Clean an Airbnb URL: strip tracking params, preserve meaningful ones
 */
function cleanAirbnbUrl(info: AirbnbUrlInfo): string {
  return `https://www.airbnb.com/rooms/${info.roomId}`;
}

// --- File Reading ---

/**
 * Read a text file containing URLs, one per line.
 * Filters empty lines and comments (lines starting with #).
 */
export function readUrlFile(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

// --- Deduplication ---

/**
 * Deduplicate URLs by platform-specific identity:
 * - Airbnb: room ID
 * - Booking: hotel_name + country_code
 * Returns deduplicated list, preserving first occurrence.
 */
export function deduplicateUrls(urls: string[]): {
  airbnb: { infos: AirbnbUrlInfo[]; duplicatesRemoved: number };
  booking: { infos: BookingUrlInfo[]; duplicatesRemoved: number };
  unknown: string[];
} {
  const airbnbSeen = new Map<string, AirbnbUrlInfo>();
  const bookingSeen = new Map<string, BookingUrlInfo>();
  const unknown: string[] = [];
  let airbnbDups = 0;
  let bookingDups = 0;

  for (const url of urls) {
    const platform = detectPlatform(url);

    if (platform === 'airbnb') {
      try {
        const info = parseAirbnbUrl(url);
        if (airbnbSeen.has(info.roomId)) {
          airbnbDups++;
        } else {
          airbnbSeen.set(info.roomId, {
            url,
            roomId: info.roomId,
            checkIn: info.checkIn,
            checkOut: info.checkOut,
            adults: info.adults,
          });
        }
      } catch {
        unknown.push(url);
      }
    } else if (platform === 'booking') {
      const info = parseBookingUrl(url);
      if (info) {
        const key = `${info.hotelName}_${info.countryCode}`;
        if (bookingSeen.has(key)) {
          bookingDups++;
        } else {
          bookingSeen.set(key, info);
        }
      } else {
        unknown.push(url);
      }
    } else {
      unknown.push(url);
    }
  }

  return {
    airbnb: { infos: Array.from(airbnbSeen.values()), duplicatesRemoved: airbnbDups },
    booking: { infos: Array.from(bookingSeen.values()), duplicatesRemoved: bookingDups },
    unknown,
  };
}

// --- Date Consensus ---

interface DateInfo {
  checkIn?: string;
  checkOut?: string;
  adults?: number;
}

/**
 * Analyze dates extracted from URLs to determine consensus.
 * Returns unanimous if all URLs with dates agree, conflicting if they disagree,
 * or none if no URLs contained dates.
 */
export function analyzeDateConsensus(dateInfos: DateInfo[]): DateConsensus {
  // Filter to only entries that have at least one date field
  const withDates = dateInfos.filter(d => d.checkIn || d.checkOut);

  if (withDates.length === 0) {
    return { checkIn: null, checkOut: null, adults: null, source: 'none' };
  }

  const checkIns = new Set(withDates.map(d => d.checkIn).filter(Boolean));
  const checkOuts = new Set(withDates.map(d => d.checkOut).filter(Boolean));
  const adultsSet = new Set(dateInfos.map(d => d.adults).filter((a): a is number => a != null));

  const isUnanimous = checkIns.size <= 1 && checkOuts.size <= 1;

  if (isUnanimous) {
    return {
      checkIn: checkIns.size === 1 ? [...checkIns][0]! : null,
      checkOut: checkOuts.size === 1 ? [...checkOuts][0]! : null,
      adults: adultsSet.size === 1 ? [...adultsSet][0]! : (adultsSet.size === 0 ? null : Math.max(...adultsSet)),
      source: 'unanimous',
    };
  }

  // Conflicting — return the most common dates
  const checkInCounts = new Map<string, number>();
  const checkOutCounts = new Map<string, number>();
  for (const d of withDates) {
    if (d.checkIn) checkInCounts.set(d.checkIn, (checkInCounts.get(d.checkIn) || 0) + 1);
    if (d.checkOut) checkOutCounts.set(d.checkOut, (checkOutCounts.get(d.checkOut) || 0) + 1);
  }

  const mostCommonCheckIn = [...checkInCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mostCommonCheckOut = [...checkOutCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    checkIn: mostCommonCheckIn,
    checkOut: mostCommonCheckOut,
    adults: adultsSet.size > 0 ? Math.max(...adultsSet) : null,
    source: 'conflicting',
  };
}

// --- Main Orchestrator ---

/**
 * Preprocess URL files: read, classify, deduplicate, detect dates.
 * Outputs structured JSON to stdout.
 */
export function preprocessFiles(filePaths: string[]): PreprocessResult {
  // Read all URLs from all files
  const allUrls: string[] = [];
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      continue;
    }
    const urls = readUrlFile(filePath);
    allUrls.push(...urls);
  }

  if (allUrls.length === 0) {
    return {
      airbnb: { urls: [], count: 0, duplicatesRemoved: 0 },
      booking: { urls: [], count: 0, duplicatesRemoved: 0 },
      dates: { checkIn: null, checkOut: null, adults: null, source: 'none' },
    };
  }

  // Deduplicate
  const deduped = deduplicateUrls(allUrls);

  // Collect date info from all parsed URLs
  const dateInfos: DateInfo[] = [
    ...deduped.airbnb.infos.map(i => ({ checkIn: i.checkIn, checkOut: i.checkOut, adults: i.adults })),
    ...deduped.booking.infos.map(i => ({ checkIn: i.checkIn, checkOut: i.checkOut, adults: i.adults })),
  ];

  const dates = analyzeDateConsensus(dateInfos);

  // Clean URLs
  const cleanedAirbnb = deduped.airbnb.infos.map(cleanAirbnbUrl);
  const cleanedBooking = deduped.booking.infos.map(cleanBookingUrl);

  // Report unknown URLs
  if (deduped.unknown.length > 0) {
    console.error(`Warning: ${deduped.unknown.length} URL(s) could not be classified:`);
    for (const u of deduped.unknown) {
      console.error(`  ${u}`);
    }
  }

  return {
    airbnb: {
      urls: cleanedAirbnb,
      count: cleanedAirbnb.length,
      duplicatesRemoved: deduped.airbnb.duplicatesRemoved,
    },
    booking: {
      urls: cleanedBooking,
      count: cleanedBooking.length,
      duplicatesRemoved: deduped.booking.duplicatesRemoved,
    },
    dates,
  };
}

// --- Direct execution ---
const isDirectRun = process.argv[1]?.includes('preprocess');
if (isDirectRun) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: reviewr preprocess <file1> [file2] ...');
    process.exit(1);
  }
  const result = preprocessFiles(files);
  console.log(JSON.stringify(result, null, 2));
}
