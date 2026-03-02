// src/booking/search.ts
//
// Booking.com listing search via Playwright bootstrap + direct GraphQL fetch
// Primary: FullSearch (quick, 25/page) or MapMarkersDesktop (exhaustive, 100/page)
// Fallback: SSR via Playwright DOM extraction

import fetch from 'node-fetch';
import { createSearchGrid, subdivideBbox } from '../search/geo.js';
import type {
  BookingSearchParams,
  SearchResult,
  SearchPage,
  BoundingBox,
  ProgressCallback,
} from '../search/types.js';

const GRAPHQL_URL = 'https://www.booking.com/dml/graphql?lang=en-gb';
const FULL_SEARCH_HASH = '8cea877c71f083895aa316412e85ffe818b503bb5331babba34a1602977d8b99';
const MAP_MARKERS_HASH = 'f6d2e861c5149589bf368582c31f74d58399004da319fac65f2c88313cf15c16';
const PAGE_DELAY_MS = 300;
const CELL_DELAY_MS = 500;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Session management ---

interface BookingSession {
  cookies: string;
  headers: Record<string, string>;
  destId: number | null;
}

// In-memory session cache to avoid re-bootstrapping Playwright on every call.
// The CSRF JWT typically lasts ~24h, so we cache aggressively.
let cachedSession: BookingSession | null = null;
let cachedSessionTime = 0;
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function bootstrapSession(
  params: BookingSearchParams,
): Promise<BookingSession> {
  const { chromium } = await import('playwright');

  console.log('🔑 Bootstrapping Booking.com session via Playwright...');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      locale: 'en-GB',
    });
    const page = await context.newPage();

    // Build a search URL that will trigger GraphQL requests.
    // If no location/destId provided (bbox-only search), use a fallback city
    // so the page loads results and fires GraphQL (needed to capture CSRF token).
    const bootstrapParams = (!params.location && !params.destId)
      ? { ...params, destId: '-2601889', location: undefined } as BookingSearchParams  // London
      : params;
    const searchUrl = buildSearchUrl(bootstrapParams);
    console.log(`  Navigating to: ${searchUrl}`);

    // Intercept first GraphQL request to capture headers
    let capturedHeaders: Record<string, string> = {};

    await page.route('**/dml/graphql*', async (route) => {
      try {
        const request = route.request();
        if (Object.keys(capturedHeaders).length === 0) {
          capturedHeaders = await request.allHeaders();
          const postData = request.postData();
          if (postData) {
            const body = JSON.parse(postData);
            console.log(`  Intercepted first GraphQL: ${body.operationName}`);
          }
        }
      } catch { /* ignore parsing errors */ }
      await route.continue();
    });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Handle WAF challenge
    let html = await page.content();
    if (html.includes('awsWafCookieDomainList') || html.includes('challenge.js')) {
      console.log('  WAF challenge detected, waiting...');
      try {
        await page.waitForURL('**/*', { timeout: 30000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);
      } catch {
        await page.waitForTimeout(10000);
      }
    }

    // Wait for search results to appear
    try {
      await page.waitForSelector('[data-testid="property-card"]', { timeout: 30000 });
    } catch {
      await page.waitForTimeout(5000);
    }
    await page.waitForTimeout(3000); // Let GraphQL requests fire

    // Capture cookies
    const cookies = await context.cookies('https://www.booking.com');
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Try to extract dest_id from page if needed
    let destId: number | null = params.destId ? parseInt(params.destId) : null;
    if (!destId) {
      try {
        const destIdMatch = await page.evaluate(() => {
          // Look for dest_id in various places
          const input = document.querySelector('input[name="dest_id"]') as HTMLInputElement;
          if (input) return input.value;
          const url = window.location.href;
          const match = url.match(/dest_id=(-?\d+)/);
          return match ? match[1] : null;
        });
        if (destIdMatch) destId = parseInt(destIdMatch);
      } catch { /* ignore */ }
    }

    const csrfToken = capturedHeaders['x-booking-csrf-token'] || '';
    const hasHeaders = Object.keys(capturedHeaders).length > 0 && csrfToken;

    if (!hasHeaders) {
      console.log('  ⚠️  No CSRF token captured. GraphQL may not work, will try SSR fallback.');
    } else {
      console.log(`  ✅ Session captured: CSRF=${csrfToken.substring(0, 20)}..., ${cookies.length} cookies`);
    }

    await page.close();
    await context.close();

    return {
      cookies: cookieString,
      headers: capturedHeaders,
      destId,
    };
  } finally {
    await browser.close();
  }
}

function buildSearchUrl(params: BookingSearchParams): string {
  const url = new URL('https://www.booking.com/searchresults.en-gb.html');

  if (params.destId) {
    url.searchParams.set('dest_id', params.destId);
    url.searchParams.set('dest_type', 'city');
  } else if (params.location) {
    url.searchParams.set('ss', params.location);
  }

  if (params.checkin) url.searchParams.set('checkin', params.checkin);
  if (params.checkout) url.searchParams.set('checkout', params.checkout);
  url.searchParams.set('group_adults', String(params.adults));
  url.searchParams.set('no_rooms', '1');

  // Build nflt filter string
  const filters = buildFilterString(params);
  if (filters) url.searchParams.set('nflt', filters);

  return url.toString();
}

function buildFilterString(params: BookingSearchParams): string {
  const parts: string[] = ['oos=1']; // Only available properties

  if (params.minRating) {
    // Convert 0-10 to Booking's scale: 90=9+, 80=8+, 70=7+, 60=6+
    const score = Math.floor(params.minRating) * 10;
    if (score >= 60) parts.push(`review_score=${score}`);
  }

  if (params.propertyType) {
    const typeMap: Record<string, string> = {
      entire: 'privacy_type=3',     // Entire place
      private: 'privacy_type=1',    // Private room
      hotel: 'ht_id=204',           // Hotels
    };
    const mapped = typeMap[params.propertyType];
    if (mapped) parts.push(mapped);
  }

  if (params.stars?.length) {
    for (const star of params.stars) {
      parts.push(`class=${star}`);
    }
  }

  if (params.freeCancellation) parts.push('fc=2');

  if (params.priceMin != null || params.priceMax != null) {
    const min = params.priceMin ?? 'min';
    const max = params.priceMax ?? 'max';
    parts.push(`price=${params.currency}-${min}-${max}-1`);
  }

  return parts.join(';');
}

// --- GraphQL request builders ---

function buildFullSearchBody(params: BookingSearchParams, session: BookingSession, offset: number): any {
  const filters = buildFilterString(params);
  const destId = session.destId || -1;
  const checkin = params.checkin || '';
  const checkout = params.checkout || '';

  return {
    operationName: 'FullSearch',
    variables: {
      includeBundle: false,
      input: {
        acidCarouselContext: null,
        dates: { checkin, checkout },
        doAvailabilityCheck: false,
        encodedAutocompleteMeta: null,
        enableCampaigns: true,
        filters: { selectedFilters: filters },
        flexibleDatesConfig: {
          broadDatesCalendar: { checkinMonths: [], los: [], startWeekdays: [] },
          dateFlexUseCase: 'DATE_RANGE',
          dateRangeCalendar: { checkin: [checkin], checkout: [checkout] },
        },
        forcedBlocks: null,
        location: { destType: 'CITY', destId },
        metaContext: {
          metaCampaignId: 0, externalTotalPrice: null, feedPrice: null,
          hotelCenterAccountId: null, rateRuleId: null, dragongateTraceId: null,
          pricingProductsTag: null,
        },
        nbRooms: 1,
        nbAdults: params.adults,
        showAparthotelAsHotel: true,
        needsRoomsMatch: false,
        optionalFeatures: { forceArpExperiments: true, testProperties: false },
        pagination: { rowsPerPage: 25, offset },
        rawQueryForSession: `/searchresults.en-gb.html?dest_id=${destId}&dest_type=city&checkin=${checkin}&checkout=${checkout}&group_adults=${params.adults}&no_rooms=1&nflt=${encodeURIComponent(filters)}`,
        referrerBlock: null,
        sbCalendarOpen: false,
        sorters: { selectedSorter: null, referenceGeoId: null, tripTypeIntentId: null },
        travelPurpose: 2,
        seoThemeIds: [],
        useSearchParamsFromSession: true,
        merchInput: { testCampaignIds: [] },
        webSearchContext: { reason: 'CLIENT_SIDE_UPDATE', source: 'SEARCH_RESULTS', outcome: 'SEARCH_RESULTS' },
        clientSideRequestId: Math.random().toString(16).substring(2, 18),
      },
      carouselLowCodeExp: false,
    },
    extensions: {
      persistedQuery: { version: 1, sha256Hash: FULL_SEARCH_HASH },
    },
  };
}

function buildMapMarkersBody(
  params: BookingSearchParams,
  session: BookingSession,
  bbox: BoundingBox,
  offset: number = 0,
): any {
  const filters = buildFilterString(params);
  const destId = session.destId || -1;
  const checkin = params.checkin || '';
  const checkout = params.checkout || '';

  return {
    operationName: 'MapMarkersDesktop',
    variables: {
      input: {
        acidCarouselContext: null,
        dates: { checkin, checkout },
        doAvailabilityCheck: false,
        encodedAutocompleteMeta: null,
        enableCampaigns: true,
        filters: { selectedFilters: filters },
        flexibleDatesConfig: {
          broadDatesCalendar: { checkinMonths: [], los: [], startWeekdays: [] },
          dateFlexUseCase: 'DATE_RANGE',
          dateRangeCalendar: { checkin: [checkin], checkout: [checkout] },
        },
        forcedBlocks: null,
        location: {
          destType: 'BOUNDING_BOX',
          boundingBox: {
            neLat: bbox.neLat, neLon: bbox.neLng,
            swLat: bbox.swLat, swLon: bbox.swLng,
            precision: 1,
          },
          hotelIds: [],
          initialDestination: { destType: 'CITY', destId },
        },
        metaContext: {
          metaCampaignId: 0, externalTotalPrice: null, feedPrice: null,
          hotelCenterAccountId: null, rateRuleId: null, dragongateTraceId: null,
          pricingProductsTag: null,
        },
        nbRooms: 1,
        nbAdults: params.adults,
        showAparthotelAsHotel: true,
        needsRoomsMatch: false,
        optionalFeatures: { forceArpExperiments: true, testProperties: false },
        pagination: { rowsPerPage: 100, offset },
        rawQueryForSession: `/searchresults.en-gb.html?dest_id=${destId}&dest_type=city&checkin=${checkin}&checkout=${checkout}&group_adults=${params.adults}&no_rooms=1&nflt=${encodeURIComponent(filters)}`,
        referrerBlock: null,
        sbCalendarOpen: false,
        sorters: { selectedSorter: null, referenceGeoId: null, tripTypeIntentId: null },
        travelPurpose: 2,
        seoThemeIds: [],
        useSearchParamsFromSession: true,
        merchInput: { testCampaignIds: [] },
        webSearchContext: { reason: 'CLIENT_SIDE_UPDATE', source: 'SEARCH_RESULTS_MAP', outcome: 'SEARCH_RESULTS_MAP' },
        clientSideRequestId: Math.random().toString(16).substring(2, 18),
        hasUserAppliedFilters: true,
      },
      includeBundle: false,
      markersInput: {
        actionType: 'SEARCH_RESULTS',
        boundingBox: {
          northEast: { latitude: bbox.neLat, longitude: bbox.neLng },
          southWest: { latitude: bbox.swLat, longitude: bbox.swLng },
          precision: 1,
        },
      },
      airportsInput: { count: 20, searchStrategy: {} },
      citiesInput: { count: 20, searchStrategy: {} },
      landmarksInput: { count: 1, searchStrategy: {} },
      beachesInput: { count: 100, searchStrategy: {} },
      skiResortsInput: { count: 10, searchStrategy: { nearbyUfi: destId } },
      includeBeachMarkers: false,
      includeSkiMarkers: false,
      includeCityMarkers: true,
      includeAirportMarkers: true,
      includeLandmarkMarkers: false,
    },
    extensions: {
      persistedQuery: { version: 1, sha256Hash: MAP_MARKERS_HASH },
    },
  };
}

// --- GraphQL fetch ---

async function fetchGraphQL(session: BookingSession, body: any): Promise<any> {
  const reqHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'origin': 'https://www.booking.com',
    'referer': 'https://www.booking.com/searchresults.en-gb.html',
    'user-agent': session.headers['user-agent'] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cookie': session.cookies,
  };

  // Copy x-booking-* and apollographql-* headers
  for (const [k, v] of Object.entries(session.headers)) {
    if ((k.startsWith('x-booking-') || k.startsWith('apollographql-')) && v) {
      reqHeaders[k] = v;
    }
  }

  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(body),
  });

  if (response.status === 403) {
    throw new Error('GraphQL 403 — session expired, need re-bootstrap');
  }

  const data = await response.json() as any;

  if (data?.errors?.length && !data?.data?.searchQueries?.search?.results?.length) {
    const msg = data.errors.map((e: any) => e.message).join('; ');
    throw new Error(`GraphQL error: ${msg}`);
  }

  return data;
}

// --- Response parsing ---

function parseSearchResult(r: any, params: BookingSearchParams): SearchResult | null {
  const hotelId = r?.basicPropertyData?.id;
  if (!hotelId) return null;

  const pageName = r?.basicPropertyData?.pageName || '';
  const countryCode = (r?.basicPropertyData?.location?.countryCode || '').toLowerCase();

  let price: SearchResult['price'] = null;
  let totalPrice: SearchResult['totalPrice'] = null;

  const priceInfo = r?.priceDisplayInfoIrene?.displayPrice;
  if (priceInfo) {
    const perStay = priceInfo?.amountPerStay?.amountRounded;
    if (perStay) {
      const amount = parseFloat(String(perStay).replace(/[^0-9.]/g, ''));
      if (!isNaN(amount)) {
        // Booking shows per-stay, approximate per-night
        const nights = params.checkin && params.checkout
          ? Math.max(1, Math.round((new Date(params.checkout).getTime() - new Date(params.checkin).getTime()) / 86400000))
          : 1;
        price = { amount: Math.round(amount / nights), currency: params.currency, period: 'night' };
        totalPrice = { amount, currency: params.currency };
      }
    }
  }

  const reviewScore = r?.basicPropertyData?.reviewScore;
  const location = r?.basicPropertyData?.location;

  return {
    id: String(hotelId),
    platform: 'booking',
    name: r?.displayName?.text || '',
    url: `https://www.booking.com/hotel/${countryCode}/${pageName}.html`,
    rating: reviewScore?.score ?? null,
    reviewCount: reviewScore?.reviewCount ?? 0,
    price,
    totalPrice,
    coordinates: location?.latitude != null && location?.longitude != null
      ? { lat: location.latitude, lng: location.longitude }
      : null,
    propertyType: r?.basicPropertyData?.accommodationTypeId != null
      ? String(r.basicPropertyData.accommodationTypeId)
      : null,
    photoUrl: r?.basicPropertyData?.photos?.main?.highResUrl?.relativeUrl
      ? `https://cf.bstatic.com${r.basicPropertyData.photos.main.highResUrl.relativeUrl}`
      : null,
    stars: r?.basicPropertyData?.starRating?.value ?? undefined,
    freeCancellation: r?.policies?.showFreeCancellation ?? undefined,
  };
}

function parseFullSearchResponse(data: any, params: BookingSearchParams, pageIndex: number): SearchPage {
  const results = data?.data?.searchQueries?.search?.results || [];
  const total = data?.data?.searchQueries?.search?.pagination?.nbResultsTotal ?? 0;

  const parsed: SearchResult[] = [];
  for (const r of results) {
    const result = parseSearchResult(r, params);
    if (result) parsed.push(result);
  }

  return {
    results: parsed,
    hasNextPage: parsed.length > 0 && (pageIndex + 1) * 25 < total,
    pageIndex,
  };
}

function parseMapMarkersResponse(data: any, params: BookingSearchParams, pageIndex: number): SearchPage {
  const results = data?.data?.searchQueries?.search?.results || [];
  const total = data?.data?.searchQueries?.search?.pagination?.nbResultsTotal ?? 0;

  const parsed: SearchResult[] = [];
  for (const r of results) {
    const result = parseSearchResult(r, params);
    if (result) parsed.push(result);
  }

  return {
    results: parsed,
    hasNextPage: parsed.length > 0 && (pageIndex + 1) * 100 < total,
    pageIndex,
  };
}

// --- SSR fallback ---

async function searchBookingSSR(
  params: BookingSearchParams,
  session: BookingSession,
  seenIds: Set<string>,
  maxResults?: number,
  onProgress?: ProgressCallback,
): Promise<SearchResult[]> {
  const { chromium } = await import('playwright');

  console.log('  📄 Falling back to SSR extraction via Playwright...');
  const browser = await chromium.launch({ headless: true });
  const results: SearchResult[] = [];

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      locale: 'en-GB',
    });
    const page = await context.newPage();
    let offset = 0;
    let pageIndex = 0;

    while (true) {
      const url = new URL(buildSearchUrl(params));
      url.searchParams.set('offset', String(offset));

      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Handle WAF
      let html = await page.content();
      if (html.includes('awsWafCookieDomainList') || html.includes('challenge.js')) {
        try {
          await page.waitForURL('**/*', { timeout: 30000, waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(5000);
        } catch {
          await page.waitForTimeout(10000);
        }
      }

      try {
        await page.waitForSelector('[data-testid="property-card"]', { timeout: 15000 });
      } catch {
        break; // No more results
      }

      // Extract from Apollo SSR cache
      const apolloData = await page.evaluate(() => {
        const script = document.querySelector('script[data-capla-store-data="apollo"]');
        if (!script) return null;
        try { return JSON.parse(script.textContent || ''); } catch { return null; }
      });

      // Extract property cards from DOM
      const cards = await page.$$eval('[data-testid="property-card"]', (els) =>
        els.map(el => ({
          name: el.querySelector('[data-testid="title"]')?.textContent?.trim() || '',
          link: el.querySelector('a[data-testid="title-link"]')?.getAttribute('href') || '',
          price: el.querySelector('[data-testid="price-and-discounted-price"]')?.textContent?.trim() || '',
          rating: el.querySelector('[data-testid="review-score"]')?.textContent?.trim() || '',
        })),
      );

      const pageResults: SearchResult[] = [];
      for (const card of cards) {
        // Extract pageName from link
        const pageNameMatch = card.link.match(/\/hotel\/[a-z]{2}\/([^.]+)\./);
        const pageName = pageNameMatch ? pageNameMatch[1] : '';

        // Try to get ID from Apollo cache
        let hotelId: string | null = null;
        if (apolloData && pageName) {
          for (const [key, value] of Object.entries(apolloData)) {
            if (key.includes('BasicPropertyData') && (value as any)?.pageName === pageName) {
              hotelId = String((value as any).id || '');
              break;
            }
          }
        }

        if (!hotelId) {
          hotelId = pageName; // Use pageName as fallback ID
        }

        if (seenIds.has(hotelId)) continue;
        seenIds.add(hotelId);

        // Parse rating "8.5" or "Excellent 8.5"
        let rating: number | null = null;
        let reviewCount = 0;
        const ratingMatch = card.rating.match(/([\d.]+)/);
        if (ratingMatch) rating = parseFloat(ratingMatch[1]);
        const countMatch = card.rating.match(/([\d,]+)\s*reviews?/i);
        if (countMatch) reviewCount = parseInt(countMatch[1].replace(',', ''));

        // Parse price
        let price: SearchResult['price'] = null;
        const priceMatch = card.price.match(/([\d,]+)/);
        if (priceMatch) {
          const amount = parseInt(priceMatch[1].replace(',', ''));
          price = { amount, currency: params.currency, period: 'night' };
        }

        pageResults.push({
          id: hotelId,
          platform: 'booking',
          name: card.name,
          url: card.link.startsWith('http') ? card.link : `https://www.booking.com${card.link}`,
          rating,
          reviewCount,
          price,
          totalPrice: null,
          coordinates: null,
          propertyType: null,
          photoUrl: null,
        });
      }

      results.push(...pageResults);

      if (onProgress) {
        onProgress({
          results: pageResults,
          hasNextPage: pageResults.length > 0,
          pageIndex,
        });
      }

      if (pageResults.length === 0 || (maxResults && results.length >= maxResults)) break;

      offset += 25;
      pageIndex++;
      await sleep(1000);
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return results;
}

// --- Main entry point ---

export async function searchBooking(
  params: BookingSearchParams,
  onProgress?: ProgressCallback,
): Promise<{ results: SearchResult[]; pagesScanned: number }> {
  const bbox = params.boundingBox;
  if (!bbox && !params.location && !params.destId) {
    throw new Error('Booking search requires --location, --bbox, or --dest-id');
  }

  let session: BookingSession;
  const now = Date.now();
  if (cachedSession && cachedSession.headers['x-booking-csrf-token'] && (now - cachedSessionTime) < SESSION_TTL_MS) {
    console.log('♻️  Reusing cached Booking session');
    session = cachedSession;
  } else {
    try {
      session = await bootstrapSession(params);
      if (session.headers['x-booking-csrf-token']) {
        cachedSession = session;
        cachedSessionTime = Date.now();
      }
    } catch (error: any) {
      console.log(`❌ Bootstrap failed: ${error.message}`);
      throw error;
    }
  }

  const seenIds = new Set<string>();
  const allResults: SearchResult[] = [];
  let pagesScanned = 0;

  // Check if we have a working GraphQL session
  const hasGraphQL = !!session.headers['x-booking-csrf-token'];

  if (!hasGraphQL) {
    console.log('⚠️  No GraphQL session, using SSR fallback');
    const ssrResults = await searchBookingSSR(params, session, seenIds, params.maxResults, onProgress);
    return { results: ssrResults, pagesScanned: 0 };
  }

  const progressTracker: ProgressCallback = (page) => {
    pagesScanned++;
    if (onProgress) onProgress(page);
  };

  // Use MapMarkers when we have a bbox but no city (viewport search).
  // FullSearch only works with destType=CITY; it ignores bbox.
  const useBboxSearch = !!bbox && !params.location && !params.destId;

  if (!params.exhaustive && !useBboxSearch) {
    // Quick mode: FullSearch with offset pagination (city-based)
    console.log(`🔍 Quick search via FullSearch (25/page, max ${params.maxResults || 'unlimited'} results)...`);
    let offset = 0;
    let pageIndex = 0;
    let retried = false;

    while (true) {
      try {
        const body = buildFullSearchBody(params, session, offset);
        const data = await fetchGraphQL(session, body);
        const page = parseFullSearchResponse(data, params, pageIndex);

        // Deduplicate
        const newResults: SearchResult[] = [];
        for (const r of page.results) {
          if (!seenIds.has(r.id)) {
            seenIds.add(r.id);
            newResults.push(r);
          }
        }

        allResults.push(...newResults);
        progressTracker({ ...page, results: newResults });

        if (!page.hasNextPage) break;
        if (params.maxResults && allResults.length >= params.maxResults) break;

        offset += 25;
        pageIndex++;
        await sleep(PAGE_DELAY_MS);
      } catch (error: any) {
        if (error.message.includes('403') && !retried) {
          console.log('  🔄 Session expired, re-bootstrapping...');
          try {
            cachedSession = null;
            session = await bootstrapSession(params);
            if (session.headers['x-booking-csrf-token']) {
              cachedSession = session;
              cachedSessionTime = Date.now();
            }
            retried = true;
            continue;
          } catch {
            console.log('  ❌ Re-bootstrap failed, falling back to SSR');
          }
        }

        if (error.message.includes('GraphQL error')) {
          console.log(`  ⚠️  ${error.message}`);
          console.log('  Falling back to SSR...');
        }

        const ssrResults = await searchBookingSSR(params, session, seenIds, params.maxResults ? params.maxResults - allResults.length : undefined, progressTracker);
        allResults.push(...ssrResults);
        break;
      }
    }
  } else if (useBboxSearch && !params.exhaustive) {
    // Quick bbox mode: MapMarkersDesktop on the single viewport bbox (no grid)
    if (!bbox) throw new Error('Bbox search requires a bounding box');

    console.log(`🔍 Quick bbox search via MapMarkersDesktop (100/page, max ${params.maxResults || 'unlimited'} results)...`);
    let offset = 0;
    let pageIndex = 0;
    let retried = false;

    while (true) {
      try {
        const body = buildMapMarkersBody(params, session, bbox, offset);
        const mapSession = { ...session };
        mapSession.headers = {
          ...session.headers,
          'x-booking-context-action': 'markers_on_map-search_results',
          'x-booking-topic': 'capla_browser_b-search-web-searchresults, markers_on_map-search_results',
        };

        const data = await fetchGraphQL(mapSession, body);
        const page = parseMapMarkersResponse(data, params, pageIndex);

        const newResults: SearchResult[] = [];
        for (const r of page.results) {
          if (!seenIds.has(r.id)) {
            seenIds.add(r.id);
            newResults.push(r);
          }
        }

        allResults.push(...newResults);
        progressTracker({ ...page, results: newResults });

        if (!page.hasNextPage) break;
        if (params.maxResults && allResults.length >= params.maxResults) break;

        offset += 100;
        pageIndex++;
        await sleep(PAGE_DELAY_MS);
      } catch (error: any) {
        if (error.message.includes('403') && !retried) {
          console.log('  🔄 Session expired, re-bootstrapping...');
          try {
            cachedSession = null;
            session = await bootstrapSession(params);
            if (session.headers['x-booking-csrf-token']) {
              cachedSession = session;
              cachedSessionTime = Date.now();
            }
            retried = true;
            continue;
          } catch {
            console.log('  ❌ Re-bootstrap failed, falling back to SSR');
          }
        }
        console.log(`  ⚠️  MapMarkers error: ${error.message}`);
        break;
      }
    }
  } else {
    // Exhaustive mode: MapMarkersDesktop with bbox subdivision
    if (!bbox) {
      throw new Error('Exhaustive Booking search requires a bounding box (--bbox or --location)');
    }

    console.log('🔍 Exhaustive search via MapMarkersDesktop (100/page)...');
    const cells = createSearchGrid(bbox, 5);
    console.log(`   ${cells.length} cells to search`);

    let retried = false;

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      console.log(`  📍 Cell ${i + 1}/${cells.length}`);

      let offset = 0;
      let pageIndex = 0;

      while (true) {
        try {
          const body = buildMapMarkersBody(params, session, cell, offset);

          // Add MapMarkers-specific headers
          const mapSession = { ...session };
          mapSession.headers = {
            ...session.headers,
            'x-booking-context-action': 'markers_on_map-search_results',
            'x-booking-topic': 'capla_browser_b-search-web-searchresults, markers_on_map-search_results',
          };

          const data = await fetchGraphQL(mapSession, body);
          const page = parseMapMarkersResponse(data, params, pageIndex);

          const newResults: SearchResult[] = [];
          for (const r of page.results) {
            if (!seenIds.has(r.id)) {
              seenIds.add(r.id);
              newResults.push(r);
            }
          }

          allResults.push(...newResults);
          progressTracker({ ...page, results: newResults });

          if (!page.hasNextPage) break;

          offset += 100;
          pageIndex++;
          await sleep(PAGE_DELAY_MS);
        } catch (error: any) {
          if (error.message.includes('403') && !retried) {
            console.log('  🔄 Session expired, re-bootstrapping...');
            try {
              session = await bootstrapSession(params);
              retried = true;
              continue;
            } catch {
              console.log('  ❌ Re-bootstrap failed');
            }
          }

          console.log(`  ⚠️  Cell ${i + 1} error: ${error.message}`);
          break; // Move to next cell
        }
      }

      await sleep(CELL_DELAY_MS);
    }
  }

  console.log(`✅ Booking search complete: ${allResults.length} unique results, ${pagesScanned} pages scanned`);
  return { results: allResults, pagesScanned };
}
