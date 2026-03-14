// src/airbnb/search.ts
//
// Airbnb listing search via v2 explore_tabs API
// Primary: v2 explore_tabs (40 results/page, API key only)
// Fallback: SSR HTML parsing (18-20 results/page, no auth)

import { makeRequest, getApiKey, BROWSER_HEADERS, API_HEADERS } from './scraper.js';
import {
  parseAirbnbPricingQuote,
  parseAirbnbStructuredDisplayPrice,
} from './pricing.js';
import { createSearchGrid, subdivideBbox, createPriceRanges } from '../search/geo.js';
import { filterSearchResults } from '../search/filters.js';
import type {
  AirbnbSearchParams,
  SearchResult,
  SearchPage,
  BoundingBox,
  ProgressCallback,
} from '../search/types.js';

const AIRBNB_BASE_URL = 'https://www.airbnb.com';
const ITEMS_PER_PAGE = 50;
const PAGE_DELAY_MS = 250;
const CELL_DELAY_MS = 500;
const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_THRESHOLD_FOR_KEY_REFRESH = 3;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface AirbnbCellSearchOutput {
  results: SearchResult[];
  apiKey: string;
  sawRateLimit: boolean;
  encounteredFatalError: boolean;
}

// --- v2 explore_tabs (primary) ---

function buildExploreUrl(
  apiKey: string,
  params: AirbnbSearchParams,
  bbox: BoundingBox,
  offset: number = 0,
): string {
  const url = new URL(`${AIRBNB_BASE_URL}/api/v2/explore_tabs`);

  // Map search
  url.searchParams.set('search_by_map', 'true');
  url.searchParams.set('ne_lat', String(bbox.neLat));
  url.searchParams.set('ne_lng', String(bbox.neLng));
  url.searchParams.set('sw_lat', String(bbox.swLat));
  url.searchParams.set('sw_lng', String(bbox.swLng));

  // Pagination
  url.searchParams.set('items_per_grid', String(ITEMS_PER_PAGE));
  url.searchParams.set('items_offset', String(offset));
  url.searchParams.set('refinement_paths[]', '/homes');

  // Auth
  url.searchParams.set('key', apiKey);

  // Currency
  url.searchParams.set('currency', params.currency);

  // Dates
  if (params.checkin) url.searchParams.set('checkin', params.checkin);
  if (params.checkout) url.searchParams.set('checkout', params.checkout);

  // Guests
  url.searchParams.set('adults', String(params.adults));
  if (params.children) url.searchParams.set('children', String(params.children));

  // Filters
  if (params.priceMin != null) url.searchParams.set('price_min', String(params.priceMin));
  if (params.priceMax != null) url.searchParams.set('price_max', String(params.priceMax));
  if (params.minBedrooms != null) {
    url.searchParams.set('min_bedrooms', String(params.minBedrooms));
  }
  if (params.minBeds != null) {
    url.searchParams.set('min_beds', String(params.minBeds));
  }

  if (params.propertyType) {
    const typeMap: Record<string, string> = {
      entire: 'Entire home/apt',
      private: 'Private room',
      hotel: 'Hotel room',
      shared: 'Shared room',
    };
    const mapped = typeMap[params.propertyType];
    if (mapped) url.searchParams.set('room_types[]', mapped);
  }

  if (params.superhost) url.searchParams.set('superhost', 'true');
  if (params.instantBook) url.searchParams.set('ib', 'true');

  if (params.amenities?.length) {
    for (const id of params.amenities) {
      url.searchParams.append('amenities[]', String(id));
    }
  }

  return url.toString();
}

function parseExploreListing(item: any, params: AirbnbSearchParams): SearchResult | null {
  const listing = item?.listing;
  if (!listing) return null;

  // Use id_str to avoid precision issues with large numeric IDs
  const id = String(listing.id_str || listing.id);
  if (!id) return null;

  const pricingQuote = item?.pricing_quote;
  const pricing = parseAirbnbPricingQuote(pricingQuote, params.currency);

  return {
    id,
    platform: 'airbnb',
    name: listing.name || '',
    url: `${AIRBNB_BASE_URL}/rooms/${id}`,
    rating: listing.star_rating ?? listing.avg_rating ?? null,
    reviewCount: listing.reviews_count ?? 0,
    pricing,
    coordinates: listing.lat != null && listing.lng != null
      ? { lat: listing.lat, lng: listing.lng }
      : null,
    propertyType: listing.room_type ?? listing.room_type_category ?? null,
    photoUrl: listing.picture_url ?? listing.picture?.url ?? null,
    bedrooms: listing.bedrooms ?? undefined,
    beds: listing.beds ?? undefined,
    bathrooms: listing.bathrooms ?? undefined,
    maxGuests: listing.person_capacity ?? listing.guest_label ? parseInt(listing.guest_label) || undefined : undefined,
    superhost: listing.is_superhost ?? undefined,
    instantBook: pricingQuote?.can_instant_book ?? undefined,
    amenityIds: listing.amenity_ids ?? undefined,
    hostId: listing.user?.id ? String(listing.user.id) : undefined,
  };
}

function parseExplorePage(data: any, params: AirbnbSearchParams, pageIndex: number): SearchPage {
  const sections = data?.explore_tabs?.[0]?.sections || [];
  const listingsSection = sections.find((s: any) => s.listings);
  const listings = listingsSection?.listings || [];

  const results: SearchResult[] = [];
  for (const item of listings) {
    const parsed = parseExploreListing(item, params);
    if (parsed) results.push(parsed);
  }

  const pagination = data?.explore_tabs?.[0]?.pagination_metadata;
  const hasNextPage = !!(pagination?.has_next_page && listings.length > 0);

  return { results, hasNextPage, pageIndex };
}

/**
 * Search a single bbox cell via v2 explore_tabs, with pagination
 */
async function searchAirbnbCell(
  params: AirbnbSearchParams,
  bbox: BoundingBox,
  apiKey: string,
  seenIds: Set<string>,
  maxResults?: number,
  onProgress?: ProgressCallback,
): Promise<AirbnbCellSearchOutput> {
  const results: SearchResult[] = [];
  let offset = 0;
  let pageIndex = 0;
  let currentKey = apiKey;
  let consecutiveErrors = 0;
  let sawRateLimit = false;
  let encounteredFatalError = false;

  while (true) {
    const url = buildExploreUrl(currentKey, params, bbox, offset);

    try {
      const response = await makeRequest(url, {
        headers: {
          ...BROWSER_HEADERS,
          ...API_HEADERS,
          referer: `${AIRBNB_BASE_URL}/`,
          'X-Airbnb-API-Key': currentKey,
          'x-airbnb-api-key': currentKey,
        },
      });

      const data = JSON.parse(response.data);
      const page = parseExplorePage(data, params, pageIndex);
      const filteredPageResults = filterSearchResults(page.results, params);

      // Deduplicate
      const newResults: SearchResult[] = [];
      for (const r of filteredPageResults) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          newResults.push(r);
        }
      }

      results.push(...newResults);
      consecutiveErrors = 0;

      if (onProgress) {
        onProgress({ ...page, results: newResults });
      }

      // Check termination conditions
      if (!page.hasNextPage) break;
      if (maxResults && results.length >= maxResults) break;

      offset += ITEMS_PER_PAGE;
      pageIndex++;
      await sleep(PAGE_DELAY_MS);
    } catch (error: any) {
      encounteredFatalError = true;
      if (error?.message?.includes('429')) {
        sawRateLimit = true;
      }
      consecutiveErrors++;
      console.log(`  ❌ Page ${pageIndex} error: ${error.message}`);

      if (consecutiveErrors >= ERROR_THRESHOLD_FOR_KEY_REFRESH) {
        try {
          console.log('  🔄 Refreshing API key...');
          currentKey = await getApiKey();
          consecutiveErrors = 0;
          continue;
        } catch {
          // Key refresh failed
        }
      }

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log(`  ⚠️  Too many errors (${consecutiveErrors}), stopping cell search`);
        break;
      }

      await sleep(1000 * consecutiveErrors);
    }
  }

  return { results, apiKey: currentKey, sawRateLimit, encounteredFatalError };
}

// --- SSR fallback ---

async function searchAirbnbSSR(
  params: AirbnbSearchParams,
  bbox: BoundingBox,
  seenIds: Set<string>,
  maxResults?: number,
  onProgress?: ProgressCallback,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  let cursor: string | undefined;
  let pageIndex = 0;

  while (true) {
    const url = new URL(`${AIRBNB_BASE_URL}/s/${encodeURIComponent(params.location || 'homes')}/homes`);
    url.searchParams.set('tab_id', 'home_tab');
    url.searchParams.set('refinement_paths[]', '/homes');
    url.searchParams.set('search_type', 'filter_change');
    url.searchParams.set('search_by_map', 'true');
    url.searchParams.set('ne_lat', String(bbox.neLat));
    url.searchParams.set('ne_lng', String(bbox.neLng));
    url.searchParams.set('sw_lat', String(bbox.swLat));
    url.searchParams.set('sw_lng', String(bbox.swLng));
    url.searchParams.set('currency', params.currency);

    if (params.checkin) url.searchParams.set('checkin', params.checkin);
    if (params.checkout) url.searchParams.set('checkout', params.checkout);
    if (params.adults) url.searchParams.set('adults', String(params.adults));
    if (params.priceMin != null) url.searchParams.set('price_min', String(params.priceMin));
    if (params.priceMax != null) url.searchParams.set('price_max', String(params.priceMax));
    if (params.minBedrooms != null) {
      url.searchParams.set('min_bedrooms', String(params.minBedrooms));
    }
    if (params.minBeds != null) {
      url.searchParams.set('min_beds', String(params.minBeds));
    }

    if (cursor) url.searchParams.set('cursor', cursor);

    try {
      const response = await makeRequest(url.toString(), {
        headers: BROWSER_HEADERS,
      });

      // Extract deferred state JSON from SSR HTML
      const match = response.data.match(/<script\s+id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/);
      if (!match) {
        console.log('  ⚠️  SSR: Could not find deferred state script');
        break;
      }

      const deferredState = JSON.parse(match[1]);

      // Navigate to search data
      let searchData: any = null;
      for (const entry of deferredState?.niobeClientData || []) {
        const staysSearch = entry?.[1]?.data?.presentation?.staysSearch;
        if (staysSearch) {
          searchData = staysSearch;
          break;
        }
      }

      if (!searchData) {
        console.log('  ⚠️  SSR: Could not find staysSearch data');
        break;
      }

      // Parse map search results (has coordinates)
      const mapResults = searchData?.mapResults?.mapSearchResults || [];
      const pageResults: SearchResult[] = [];

      for (const item of mapResults) {
        const listing = item?.demandStayListing || item?.listing;
        if (!listing) continue;

        // Decode base64 ID to numeric
        let id: string;
        try {
          const decoded = Buffer.from(listing.id, 'base64').toString('utf-8');
          const numericMatch = decoded.match(/(\d+)/);
          id = numericMatch ? numericMatch[1] : listing.id;
        } catch {
          id = String(listing.id);
        }

        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const coord = listing.location?.coordinate || listing.coordinate;
        const pricing = parseAirbnbStructuredDisplayPrice(
          item?.structuredDisplayPrice,
          params.currency,
        );

        // Check for superhost badge
        const badges = item?.badges || [];
        const isSuperhost = badges.some((b: any) =>
          b?.text === 'Superhost' || b?.loggingContext?.badgeType === 'SUPERHOST');

        // Parse rating from "4.93 (177)" format
        let rating: number | null = null;
        let reviewCount = 0;
        const avgRating = item?.avgRatingLocalized || '';
        const ratingMatch = avgRating.match(/([\d.]+)\s*\((\d+)\)/);
        if (ratingMatch) {
          rating = parseFloat(ratingMatch[1]);
          reviewCount = parseInt(ratingMatch[2]);
        }

        let bedrooms: number | undefined;
        let beds: number | undefined;
        const primaryLine = item?.structuredContent?.primaryLine;
        if (Array.isArray(primaryLine)) {
          for (const entry of primaryLine) {
            const body = typeof entry?.body === 'string' ? entry.body : '';
            const bedroomMatch = body.match(/(\d+)\s+bedroom/i);
            if (bedroomMatch) {
              bedrooms = parseInt(bedroomMatch[1], 10);
            }
            const bedMatch = body.match(/(\d+)\s+beds?/i);
            if (bedMatch) {
              beds = parseInt(bedMatch[1], 10);
            }
          }
        }

        pageResults.push({
          id,
          platform: 'airbnb',
          name: item?.title || listing?.name || '',
          url: `${AIRBNB_BASE_URL}/rooms/${id}`,
          rating,
          reviewCount,
          pricing,
          coordinates: coord ? { lat: coord.latitude, lng: coord.longitude } : null,
          propertyType: listing?.roomType ?? null,
          photoUrl: item?.contextualPictures?.[0]?.picture || null,
          bedrooms,
          beds,
          superhost: isSuperhost || undefined,
        });
      }

      const filteredPageResults = filterSearchResults(pageResults, params);
      results.push(...filteredPageResults);

      if (onProgress) {
        onProgress({
          results: filteredPageResults,
          hasNextPage: !!searchData?.results?.paginationInfo?.nextPageCursor,
          pageIndex,
        });
      }

      // Pagination
      const nextCursor = searchData?.results?.paginationInfo?.nextPageCursor;
      if (!nextCursor || (maxResults && results.length >= maxResults)) break;

      cursor = nextCursor;
      pageIndex++;
      await sleep(PAGE_DELAY_MS);
    } catch (error: any) {
      console.log(`  ❌ SSR page ${pageIndex} error: ${error.message}`);
      break;
    }
  }

  return results;
}

// --- Main entry point ---

export async function searchAirbnb(
  params: AirbnbSearchParams,
  onProgress?: ProgressCallback,
): Promise<{ results: SearchResult[]; pagesScanned: number }> {
  const bbox = params.boundingBox;
  if (!bbox) throw new Error('Airbnb search requires a bounding box');

  const seenIds = new Set<string>();
  const allResults: SearchResult[] = [];
  let pagesScanned = 0;
  let shouldFallbackToSSR = false;

  // Try v2 explore_tabs first
  let apiKey: string;
  try {
    apiKey = await getApiKey();
  } catch (error: any) {
    console.log(`⚠️  Could not get API key (${error.message}), falling back to SSR`);
    const ssrResults = await searchAirbnbSSR(params, bbox, seenIds, params.maxResults, onProgress);
    return { results: ssrResults, pagesScanned: 0 };
  }

  const progressTracker: ProgressCallback = (page) => {
    pagesScanned++;
    if (onProgress) onProgress(page);
  };

  if (!params.exhaustive) {
    // Quick mode: search the bbox directly
    console.log(`🔍 Quick search: paginating bbox directly (max ${params.maxResults || 'unlimited'} results)...`);
    const { results, apiKey: updatedKey, sawRateLimit, encounteredFatalError } = await searchAirbnbCell(
      params, bbox, apiKey, seenIds, params.maxResults, progressTracker,
    );
    allResults.push(...results);
    apiKey = updatedKey;
    shouldFallbackToSSR = allResults.length === 0 && (sawRateLimit || encounteredFatalError);
  } else {
    // Exhaustive mode: grid subdivision + price pivoting
    console.log('🔍 Exhaustive search: subdividing bbox into grid cells...');
    const cells = createSearchGrid(bbox, 5);
    console.log(`   ${cells.length} cells to search`);

    let currentKey = apiKey;

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      console.log(`  📍 Cell ${i + 1}/${cells.length}`);

      const { results, apiKey: updatedKey, sawRateLimit, encounteredFatalError } = await searchAirbnbCell(
        params, cell, currentKey, seenIds, undefined, progressTracker,
      );
      currentKey = updatedKey;

      allResults.push(...results);
      if (allResults.length === 0 && (sawRateLimit || encounteredFatalError)) {
        shouldFallbackToSSR = true;
      }

      // If cell returned many results (~40+), subdivide and try with price pivoting
      if (results.length >= 40) {
        console.log(`    ⚡ Dense cell (${results.length} results), applying price pivoting...`);
        const priceMin = params.priceMin ?? 0;
        const priceMax = params.priceMax ?? 1000;
        const ranges = createPriceRanges(priceMin, priceMax, 5);

        const subCells = subdivideBbox(cell);
        for (const subCell of subCells) {
          for (const range of ranges) {
            const subParams = { ...params, priceMin: range.min, priceMax: range.max };
            const { results: subResults, apiKey: subKey } = await searchAirbnbCell(
              subParams, subCell, currentKey, seenIds, undefined, progressTracker,
            );
            currentKey = subKey;
            allResults.push(...subResults);
            await sleep(CELL_DELAY_MS);
          }
        }
      }

      await sleep(CELL_DELAY_MS);
    }
  }

  if (allResults.length === 0 && shouldFallbackToSSR) {
    console.log('⚠️  Airbnb API search was blocked or rate limited, falling back to SSR map parsing');
    const ssrResults = await searchAirbnbSSR(params, bbox, seenIds, params.maxResults, progressTracker);
    allResults.push(...ssrResults);
  }

  console.log(`✅ Airbnb search complete: ${allResults.length} unique results, ${pagesScanned} pages scanned`);
  return { results: allResults, pagesScanned };
}
