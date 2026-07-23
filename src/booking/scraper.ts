// src/booking/scraper.ts
//
// Batch hotel reviews scraper with proxy support
//
// Proxy Configuration:
// - Configure proxy settings in .env file
// - Set USE_PROXY=false in .env to disable proxy
//
// Usage:
//   pnpm start                              # Run with proxy enabled (default)
//   reviewr <booking-url>                   # Single URL via CLI

import 'dotenv/config';
import fetch, { type RequestInit } from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as fs from 'fs';
import * as path from 'path';
import { buildProxyUrl, resolveProxyProtocol } from '../config.js';

const BOOKING_GRAPHQL_URL = 'https://www.booking.com/dml/graphql';
const INPUT_DIR = 'data/booking/input';
const OUTPUT_DIR = 'data/booking/output';
const REVIEWS_PER_PAGE = 10;
const REVIEW_SORTER = 'NEWEST_FIRST';
const GRAPHQL_INVALID_JSON_ATTEMPTS = 5;

// Captured from Booking.com's live hotel page on 2026-07-23. Keep these
// operations explicit: Booking disables GraphQL introspection, while the
// browser's real request payload remains usable over plain HTTP.
const LOCATION_PROPERTY_DETAILS_QUERY = `
  query LocationPropertyDetails($input: HotelPageByPageNameInput!) {
    hotelPageByPageName(input: $input) {
      ... on HotelPageType {
        propertyDetails {
          id
          name
          __typename
        }
        __typename
      }
      __typename
    }
  }
`;

const REVIEW_LIST_QUERY = `
  query ReviewList($input: ReviewListFrontendInput!) {
    reviewListFrontend(input: $input) {
      ... on ReviewListFrontendResult {
        reviewCard {
          reviewUrl
          guestDetails {
            username
            countryName
            guestTypeTranslation
            __typename
          }
          bookingDetails {
            customerType
            roomType {
              name
              __typename
            }
            numNights
            __typename
          }
          reviewedDate
          helpfulVotesCount
          reviewScore
          textDetails {
            title
            positiveText
            negativeText
            lang
            __typename
          }
          isApproved
          partnerReply {
            reply
            __typename
          }
          __typename
        }
        reviewsCount
        __typename
      }
      ... on ReviewsFrontendError {
        statusCode
        message
        __typename
      }
      __typename
    }
  }
`;

/**
 * Get proxy configuration lazily from current environment variables
 */
function getProxyConfig() {
  const USE_PROXY = process.env.USE_PROXY !== 'false';
  const PROXY_CONFIG = {
    protocol: resolveProxyProtocol(process.env.PROXY_PROTOCOL),
    host: process.env.PROXY_HOST || '',
    port: parseInt(process.env.PROXY_PORT || '0'),
    username: process.env.PROXY_USERNAME || '',
    password: process.env.PROXY_PASSWORD || '',
  };
  const proxyUrl = buildProxyUrl(PROXY_CONFIG);
  return { USE_PROXY, PROXY_CONFIG, proxyUrl };
}

// It's crucial to set a User-Agent, as many sites block requests without one.
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
  Connection: 'keep-alive',
};

// Define the structure for a single review object for type safety - matching Python version fields
export interface Review {
  hotel_name: string;
  username: string | null;
  user_country: string | null;
  room_view: string | null;
  stay_duration: string | null;
  stay_type: string | null;
  review_post_date: string | null;
  review_title: string | null;
  rating: number | null;
  original_lang: string | null;
  review_text_liked: string | null;
  review_text_disliked: string | null;
  full_review: string | null;
  en_full_review: string | null;
  found_helpful: number;
  found_unhelpful: number;
  owner_resp_text: string | null;
}

export interface HotelInfo {
  hotel_name: string;
  country_code: string;
  url: string;
}

export interface BookingReviewScrapeProgress {
  currentPage: number;
  totalPages: number;
  offset: number;
  maxOffset: number;
  totalReviewsSoFar: number;
}

export interface BookingReviewPage {
  cards: BookingReviewCard[];
  reviewsCount: number;
}

export type BookingHttpRequest = (
  url: string,
  maxRetries?: number,
  init?: RequestInit,
) => Promise<{ data: string; status: number; statusText: string }>;

export interface BookingGraphQlRequestDependencies {
  request?: BookingHttpRequest;
  sleep?: (delayMs: number) => Promise<void>;
  maxInvalidJsonAttempts?: number;
}

export interface BookingReviewScrapeDependencies {
  resolveHotelId?: (hotelInfo: HotelInfo) => Promise<number>;
  fetchPage?: (hotelId: number, countryCode: string, skip: number) => Promise<BookingReviewPage>;
  sleep?: (delayMs: number) => Promise<void>;
}

export function shouldStopBookingReviewPagination(
  pageIndex: number,
  cardCount: number,
): boolean {
  return pageIndex > 0 && cardCount === 0;
}

interface BookingGraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface LocationPropertyDetailsData {
  hotelPageByPageName?: {
    __typename?: string;
    propertyDetails?: {
      id?: number;
      name?: string;
    } | null;
  } | null;
}

export interface BookingReviewCard {
  reviewUrl?: string | null;
  guestDetails?: {
    username?: string | null;
    countryName?: string | null;
    guestTypeTranslation?: string | null;
  } | null;
  bookingDetails?: {
    customerType?: string | null;
    roomType?: {
      name?: string | null;
    } | null;
    numNights?: number | null;
  } | null;
  reviewedDate?: number | null;
  helpfulVotesCount?: number | null;
  reviewScore?: number | null;
  textDetails?: {
    title?: string | null;
    positiveText?: string | null;
    negativeText?: string | null;
    lang?: string | null;
  } | null;
  isApproved?: boolean | null;
  partnerReply?: {
    reply?: string | null;
  } | null;
}

interface ReviewListData {
  reviewListFrontend?: {
    __typename?: string;
    reviewCard?: BookingReviewCard[] | null;
    reviewsCount?: number | null;
    statusCode?: number | null;
    message?: string | null;
  } | null;
}

/**
 * Make HTTP request with retry logic and proxy support using Fetch
 */
export async function makeRequest(
  url: string,
  maxRetries: number = 3,
  init: RequestInit = {},
): Promise<{ data: string; status: number; statusText: string }> {
  const { USE_PROXY, PROXY_CONFIG, proxyUrl } = getProxyConfig();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      if (attempt === 1 && USE_PROXY) {
        console.log(
          `🔗 Using ${PROXY_CONFIG.protocol.toUpperCase()} proxy: `
          + `${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`,
        );
      }

      // Create AbortController for timeout
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds timeout
      const extraHeaders = init.headers as Record<string, string> | undefined;

      const fetchOptions: RequestInit = {
        ...init,
        headers: {
          ...BROWSER_HEADERS,
          ...extraHeaders,
        },
        signal: controller.signal,
      };

      // Add proxy if enabled
      if (USE_PROXY) {
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const data = await response.text();

      return {
        data,
        status: response.status,
        statusText: response.statusText,
      };
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;

      if (error.name === 'AbortError') {
        console.log(`❌ Request timeout (attempt ${attempt}/${maxRetries})`);
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        console.log(`❌ Connection failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
      } else if (error.message.includes('HTTP')) {
        console.log(`❌ HTTP error (attempt ${attempt}/${maxRetries}): ${error.message}`);
      } else {
        console.log(`❌ Request failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
      }

      if (isLastAttempt) {
        throw error;
      }

      // Wait before retry (exponential backoff)
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  throw new Error('This should never be reached');
}

/**
 * Extract hotel name and country code from booking.com URL
 */
export function extractHotelInfo(url: string): HotelInfo | null {
  try {
    // Pattern: https://www.booking.com/hotel/[COUNTRY]/[HOTEL_NAME].[LANG].html
    const regex = /https:\/\/www\.booking\.com\/hotel\/([a-z]{2})\/([^.]+)\./;
    const match = url.match(regex);

    if (match) {
      const country_code = match[1];
      const hotel_name = match[2];

      return {
        hotel_name,
        country_code,
        url,
      };
    }

    return null;
  } catch (error) {
    console.error(`Error extracting hotel info from URL: ${url}`, error);
    return null;
  }
}

/**
 * Read URLs from CSV file
 */
export function readUrlsFromCsv(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const urls = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return urls;
  } catch (error) {
    console.error(`Error reading CSV file: ${filePath}`, error);
    return [];
  }
}

/**
 * Check if output file already exists
 */
function outputFileExists(inputFileName: string, outputDir: string = OUTPUT_DIR): boolean {
  const outputFileName = inputFileName.replace('.csv', '.json');
  const outputPath = path.join(outputDir, outputFileName);
  return fs.existsSync(outputPath);
}

/**
 * Scrape reviews for a single hotel
 */
export async function scrapeHotelReviews(
  hotelInfo: HotelInfo,
  onProgress?: (progress: BookingReviewScrapeProgress) => void | Promise<void>,
  dependencies: BookingReviewScrapeDependencies = {},
): Promise<Review[]> {
  console.log(`Starting scraper for hotel: ${hotelInfo.hotel_name} (${hotelInfo.country_code})...`);

  try {
    const resolveHotelId = dependencies.resolveHotelId || resolveBookingHotelId;
    const fetchPage = dependencies.fetchPage || fetchReviewPage;
    const sleep = dependencies.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    const hotelId = await resolveHotelId(hotelInfo);
    const firstPage = await fetchPage(hotelId, hotelInfo.country_code, 0);
    const totalReviews = Math.max(firstPage.reviewsCount, firstPage.cards.length);
    const totalPages = Math.max(1, Math.ceil(totalReviews / REVIEWS_PER_PAGE));
    const maxOffset = (totalPages - 1) * REVIEWS_PER_PAGE;
    const allReviews: Review[] = [];
    const seenReviewIds = new Set<string>();

    console.log(`  Discovered ${totalReviews} reviews across ${totalPages} page${totalPages === 1 ? '' : 's'}.`);

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      const offset = pageIndex * REVIEWS_PER_PAGE;
      console.log(`  Scraping page: ${pageIndex + 1}/${totalPages}...`);

      const page = pageIndex === 0 ? firstPage : await fetchPage(hotelId, hotelInfo.country_code, offset);

      for (const card of page.cards) {
        const reviewId = card.reviewUrl || null;
        if (reviewId && seenReviewIds.has(reviewId)) {
          continue;
        }
        if (reviewId) {
          seenReviewIds.add(reviewId);
        }
        allReviews.push(mapBookingReviewCard(card, hotelInfo.hotel_name));
      }

      await onProgress?.({
        currentPage: pageIndex + 1,
        totalPages,
        offset,
        maxOffset,
        totalReviewsSoFar: allReviews.length,
      });

      if (shouldStopBookingReviewPagination(pageIndex, page.cards.length)) {
        console.warn(
          `  Booking returned no approved review cards on page ${pageIndex + 1}; `
          + 'stopping pagination before the advertised review count.',
        );
        break;
      }

      // Be a good internet citizen: add a small delay between requests
      if (pageIndex + 1 < totalPages) {
        await sleep(500);
      }
    }

    if (totalReviews > 0 && allReviews.length === 0) {
      throw new Error(
        `Booking advertised ${totalReviews} reviews for ${hotelInfo.hotel_name} `
        + 'but returned no approved review cards',
      );
    }

    console.log(`  ✅ Scraped ${allReviews.length} reviews for ${hotelInfo.hotel_name}`);
    return allReviews;
  } catch (error) {
    console.error(`Error scraping hotel ${hotelInfo.hotel_name}:`, error);
    throw error;
  }
}

function describeBookingNonJsonResponse(body: string): string {
  const prefix = body.trimStart().slice(0, 4096).toLowerCase();
  const looksLikeHtml = /^(?:<!doctype\s+html|<html|<head|<body)/.test(prefix);
  if (!looksLikeHtml) {
    return 'non-JSON response';
  }

  const looksLikeChallenge =
    /aws.?waf|captcha|challenge|verify you are human|access denied|robot check/.test(prefix);
  return looksLikeChallenge ? 'HTML challenge response' : 'HTML response';
}

export async function makeBookingGraphQlRequest<T>(
  operationName: string,
  variables: Record<string, unknown>,
  query: string,
  dependencies: BookingGraphQlRequestDependencies = {},
): Promise<T> {
  const request = dependencies.request || makeRequest;
  const sleep = dependencies.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const requestedAttempts = dependencies.maxInvalidJsonAttempts ?? GRAPHQL_INVALID_JSON_ATTEMPTS;
  const maxInvalidJsonAttempts =
    Number.isFinite(requestedAttempts) && requestedAttempts >= 1
      ? Math.floor(requestedAttempts)
      : GRAPHQL_INVALID_JSON_ATTEMPTS;
  const requestInit: RequestInit = {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operationName,
      variables,
      extensions: {},
      query,
    }),
  };

  for (let attempt = 1; attempt <= maxInvalidJsonAttempts; attempt++) {
    const response = await request(BOOKING_GRAPHQL_URL, 3, requestInit);
    let payload: BookingGraphQlResponse<T>;
    try {
      const parsed = JSON.parse(response.data) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Unexpected JSON payload type');
      }
      payload = parsed as BookingGraphQlResponse<T>;
    } catch {
      const responseKind = describeBookingNonJsonResponse(response.data);
      const message =
        `Booking GraphQL ${operationName} returned invalid JSON (${responseKind})`;
      if (attempt === maxInvalidJsonAttempts) {
        throw new Error(`${message} after ${maxInvalidJsonAttempts} attempts`);
      }

      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.warn(
        `${message}; retrying with a fresh connection `
        + `(attempt ${attempt}/${maxInvalidJsonAttempts})`,
      );
      await sleep(delay);
      continue;
    }

    if (payload.errors?.length) {
      const messages = payload.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join('; ');
      throw new Error(`Booking GraphQL ${operationName} failed: ${messages || 'unknown error'}`);
    }
    if (!payload.data) {
      throw new Error(`Booking GraphQL ${operationName} returned no data`);
    }

    return payload.data;
  }

  throw new Error(`Booking GraphQL ${operationName} exhausted invalid JSON retries`);
}

async function resolveBookingHotelId(hotelInfo: HotelInfo): Promise<number> {
  const data = await makeBookingGraphQlRequest<LocationPropertyDetailsData>(
    'LocationPropertyDetails',
    {
      input: {
        pageNameDetails: {
          countryCode: hotelInfo.country_code,
          pagename: hotelInfo.hotel_name,
        },
      },
    },
    LOCATION_PROPERTY_DETAILS_QUERY,
  );

  const hotelPage = data.hotelPageByPageName;
  const hotelId = hotelPage?.propertyDetails?.id;
  if (hotelPage?.__typename !== 'HotelPageType' || !Number.isFinite(hotelId)) {
    throw new Error(`Booking could not resolve hotel ID for ${hotelInfo.hotel_name}`);
  }

  return hotelId as number;
}

export function buildBookingReviewListVariables(
  hotelId: number,
  countryCode: string,
  skip: number,
  limit: number = REVIEWS_PER_PAGE,
): Record<string, unknown> {
  return {
    input: {
      hotelId,
      ufi: 0,
      hotelCountryCode: countryCode,
      // Live-probed on 2026-07-23: unlike relevance ranking, this keeps
      // offset pages in a deterministic chronological order.
      sorter: REVIEW_SORTER,
      filters: {
        text: '',
      },
      skip,
      limit,
      upsortReviewUrl: '',
      searchFeatures: {
        destId: 0,
        destType: 'CITY',
      },
    },
  };
}

async function fetchReviewPage(
  hotelId: number,
  countryCode: string,
  skip: number,
): Promise<BookingReviewPage> {
  const data = await makeBookingGraphQlRequest<ReviewListData>(
    'ReviewList',
    buildBookingReviewListVariables(hotelId, countryCode, skip),
    REVIEW_LIST_QUERY,
  );

  const result = data.reviewListFrontend;
  if (!result) {
    throw new Error('Booking GraphQL ReviewList returned no result');
  }
  if (result.__typename !== 'ReviewListFrontendResult') {
    throw new Error(
      `Booking GraphQL ReviewList failed: ${result.message || result.statusCode || result.__typename || 'unknown error'}`,
    );
  }

  const cards = (result.reviewCard || []).filter((card) => card.isApproved !== false);
  return {
    cards,
    reviewsCount: result.reviewsCount || 0,
  };
}

function cleanNullableText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function withTerminalPunctuation(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function formatReviewDate(value: number | null | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null;
  const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function formatCustomerType(value: string | null | undefined): string | null {
  const cleaned = cleanNullableText(value);
  if (!cleaned) return null;
  return cleaned
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function mapBookingReviewCard(card: BookingReviewCard, hotelName: string): Review {
  const reviewTitle = cleanNullableText(card.textDetails?.title);
  let reviewTextLiked = cleanNullableText(card.textDetails?.positiveText);
  const reviewTextDisliked = cleanNullableText(card.textDetails?.negativeText);
  const originalLang = cleanNullableText(card.textDetails?.lang);

  if (reviewTextLiked?.toLowerCase().includes('there are no comments available')) {
    reviewTextLiked = null;
  }

  const fullReview = cleanNullableText(
    [
      reviewTitle ? `title: ${withTerminalPunctuation(reviewTitle)}` : '',
      reviewTextLiked ? `liked: ${withTerminalPunctuation(reviewTextLiked)}` : '',
      reviewTextDisliked ? `disliked: ${withTerminalPunctuation(reviewTextDisliked)}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  const numNights = card.bookingDetails?.numNights;
  const stayDuration = numNights && numNights > 0 ? `${numNights} night${numNights === 1 ? '' : 's'}` : null;

  return {
    hotel_name: hotelName,
    username: cleanNullableText(card.guestDetails?.username),
    user_country: cleanNullableText(card.guestDetails?.countryName),
    room_view: cleanNullableText(card.bookingDetails?.roomType?.name),
    stay_duration: stayDuration,
    stay_type:
      cleanNullableText(card.guestDetails?.guestTypeTranslation) ||
      formatCustomerType(card.bookingDetails?.customerType),
    review_post_date: formatReviewDate(card.reviewedDate),
    review_title: reviewTitle,
    rating: Number.isFinite(card.reviewScore) ? (card.reviewScore as number) : null,
    original_lang: originalLang,
    review_text_liked: reviewTextLiked,
    review_text_disliked: reviewTextDisliked,
    full_review: fullReview,
    en_full_review: originalLang?.toLowerCase().startsWith('en') ? fullReview : null,
    found_helpful: Number.isFinite(card.helpfulVotesCount) ? Math.max(0, card.helpfulVotesCount as number) : 0,
    // ReviewList exposes helpfulVotesCount but no corresponding unhelpful count.
    // Keep the legacy field at 0 for artifact/analytics schema compatibility.
    found_unhelpful: 0,
    owner_resp_text: cleanNullableText(card.partnerReply?.reply),
  };
}

/**
 * Save combined reviews to JSON file
 */
export function saveToJson(reviews: Review[], inputFileName: string, outputDir: string = OUTPUT_DIR): void {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFileName = inputFileName.replace('.csv', '.json');
  const outputPath = path.join(outputDir, outputFileName);

  const jsonOutput = {
    input_file: inputFileName,
    scraped_at: new Date().toISOString(),
    total_reviews: reviews.length,
    hotels_processed: [...new Set(reviews.map((r) => r.hotel_name))],
    reviews: reviews,
  };

  const jsonString = JSON.stringify(jsonOutput, null, 2);
  fs.writeFileSync(outputPath, jsonString);
  console.log(`✅ Saved ${reviews.length} reviews to ${outputPath}`);
}

/**
 * Process a single CSV file
 */
export async function processCsvFile(
  inputFileName: string,
  inputDir: string = INPUT_DIR,
  outputDir: string = OUTPUT_DIR,
): Promise<void> {
  console.log(`\n📁 Processing: ${inputFileName}`);

  // Check if output already exists
  if (outputFileExists(inputFileName, outputDir)) {
    console.log(`⏭️  Output file already exists, skipping: ${inputFileName}`);
    return;
  }

  const inputPath = path.join(inputDir, inputFileName);
  const urls = readUrlsFromCsv(inputPath);

  if (urls.length === 0) {
    console.log(`⚠️  No URLs found in: ${inputFileName}`);
    return;
  }

  console.log(`📊 Found ${urls.length} URLs to process`);

  // Step 1: Extract and deduplicate hotel info
  const hotelInfoMap = new Map<string, HotelInfo>();
  const failedUrls: string[] = [];

  for (const url of urls) {
    const hotelInfo = extractHotelInfo(url);

    if (!hotelInfo) {
      console.log(`❌ Failed to extract hotel info from URL: ${url}`);
      failedUrls.push(url);
      continue;
    }

    // Create unique key: hotel_name + country_code
    const hotelKey = `${hotelInfo.hotel_name}_${hotelInfo.country_code}`;

    if (!hotelInfoMap.has(hotelKey)) {
      hotelInfoMap.set(hotelKey, hotelInfo);
    } else {
      console.log(`🔄 Duplicate hotel found, skipping: ${hotelInfo.hotel_name} (${hotelInfo.country_code})`);
    }
  }

  const uniqueHotels = Array.from(hotelInfoMap.values());
  console.log(`📊 Found ${urls.length} URLs, deduplicated to ${uniqueHotels.length} unique hotels`);

  // Step 2: Process unique hotels
  const allReviews: Review[] = [];
  const processedHotels: string[] = [];
  const failedHotels: string[] = [];

  for (const hotelInfo of uniqueHotels) {
    console.log(`🏨 Processing hotel: ${hotelInfo.hotel_name} (${hotelInfo.country_code})`);

    try {
      const reviews = await scrapeHotelReviews(hotelInfo);
      allReviews.push(...reviews);
      processedHotels.push(hotelInfo.hotel_name);

      // Add delay between hotels
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Error processing hotel ${hotelInfo.hotel_name}:`, error);
      failedHotels.push(hotelInfo.hotel_name);
    }
  }

  // Save results
  if (allReviews.length > 0) {
    saveToJson(allReviews, inputFileName, outputDir);
  }

  // Summary
  console.log(`\n📋 Summary for ${inputFileName}:`);
  console.log(`  📊 Total URLs: ${urls.length}`);
  console.log(`  🔄 Unique hotels: ${uniqueHotels.length}`);
  console.log(`  ✅ Successfully processed: ${processedHotels.length} hotels`);
  console.log(`  ❌ Failed to parse URLs: ${failedUrls.length}`);
  console.log(`  ❌ Failed to scrape hotels: ${failedHotels.length}`);
  console.log(`  📊 Total reviews: ${allReviews.length}`);

  if (failedUrls.length > 0) {
    console.log(`  ⚠️  Failed URLs: ${failedUrls.join(', ')}`);
  }
  if (failedHotels.length > 0) {
    console.log(`  ⚠️  Failed hotels: ${failedHotels.join(', ')}`);
  }
}

/**
 * Scrape reviews for a single Booking.com URL (convenience wrapper for CLI)
 */
export async function scrapeUrl(url: string): Promise<Review[]> {
  const hotelInfo = extractHotelInfo(url);
  if (!hotelInfo) {
    throw new Error(`Could not extract hotel info from URL: ${url}`);
  }
  return scrapeHotelReviews(hotelInfo);
}

/**
 * Run batch scraping on a specific input directory/file
 */
export async function runBatchScrape(inputDir: string = INPUT_DIR, outputDir: string = OUTPUT_DIR): Promise<void> {
  if (!fs.existsSync(inputDir)) {
    console.error(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  const csvFiles = fs
    .readdirSync(inputDir)
    .filter((file) => file.endsWith('.csv'))
    .sort();

  if (csvFiles.length === 0) {
    console.log(`No CSV files found in ${inputDir} directory`);
    return;
  }

  console.log(`Found ${csvFiles.length} CSV files to process`);

  for (const csvFile of csvFiles) {
    try {
      await processCsvFile(csvFile, inputDir, outputDir);
    } catch (error) {
      console.error(`Error processing file ${csvFile}:`, error);
    }
  }

  console.log('\nBatch processing completed!');
}

/**
 * Main function to process all CSV files in input directory
 */
async function main(): Promise<void> {
  console.log('🚀 Starting batch hotel reviews scraper...');

  const { USE_PROXY, PROXY_CONFIG } = getProxyConfig();

  // Show proxy status
  if (USE_PROXY) {
    if (PROXY_CONFIG.host && PROXY_CONFIG.username) {
      console.log(`🔗 Proxy enabled: ${PROXY_CONFIG.host}:${PROXY_CONFIG.port} (${PROXY_CONFIG.username})`);
    } else {
      console.log('❌ Proxy enabled but missing configuration in .env file');
      process.exit(1);
    }
  } else {
    console.log('🚫 Proxy disabled - running without proxy');
  }

  // Ensure input directory exists
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ Input directory not found: ${INPUT_DIR}`);
    process.exit(1);
  }

  // Get all CSV files from input directory
  const csvFiles = fs
    .readdirSync(INPUT_DIR)
    .filter((file) => file.endsWith('.csv'))
    .sort();

  if (csvFiles.length === 0) {
    console.log(`⚠️  No CSV files found in ${INPUT_DIR} directory`);
    process.exit(0);
  }

  console.log(`📂 Found ${csvFiles.length} CSV files to process`);

  // Process each CSV file
  for (const csvFile of csvFiles) {
    try {
      await processCsvFile(csvFile);
    } catch (error) {
      console.error(`❌ Error processing file ${csvFile}:`, error);
    }
  }

  console.log('\n🎉 Batch processing completed!');
}

// --- Run the Scraper (only when executed directly) ---
const isDirectRun = process.argv[1]?.includes('booking/scraper') || process.argv[1]?.includes('booking\\scraper');
if (isDirectRun) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
