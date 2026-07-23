// src/airbnb/search.ts
//
// Airbnb listing search via SSR HTML parsing (18-20 map results/page, no auth)
//
// Airbnb's v2 explore_tabs endpoint started returning HTTP 400 for every search
// in July 2026. Keep viewport search on the server-rendered staysSearch state so
// it does not need an API key or enter a retry/refresh storm before returning
// map pins.

import { makeRequest, BROWSER_HEADERS } from './scraper.js';
import { parseAirbnbStructuredDisplayPrice } from './pricing.js';
import {
  countNewChildIds,
  hasMeaningfulChildGain,
  shouldRecurseIntoChildren,
  shouldProbeChildren,
  type AdaptiveSubdivisionConfig,
} from '../search/adaptive.js';
import { bboxIntersectsCircle, subdivideBbox } from '../search/geo.js';
import { filterSearchResults } from '../search/filters.js';
import type { AirbnbSearchParams, SearchResult, BoundingBox, ProgressCallback } from '../search/types.js';

const AIRBNB_BASE_URL = 'https://www.airbnb.com';
const PAGE_DELAY_MS = 250;
const CELL_DELAY_MS = 500;
const AIRBNB_SUBDIVISION_CONFIG: AdaptiveSubdivisionConfig = {
  forceProbeDepth: 2,
  maxDepth: 3,
  minCellSideMeters: 700,
  minResultsToProbe: 8,
  minNewIds: 2,
  minGainRatio: 0.05,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type AirbnbRequest = typeof makeRequest;

function buildSsrSearchUrl(params: AirbnbSearchParams, bbox: BoundingBox, cursor?: string): string {
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
  url.searchParams.set('adults', String(params.adults));

  if (params.checkin) url.searchParams.set('checkin', params.checkin);
  if (params.checkout) url.searchParams.set('checkout', params.checkout);
  if (params.children) url.searchParams.set('children', String(params.children));
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

  for (const amenityId of params.amenities ?? []) {
    url.searchParams.append('amenities[]', String(amenityId));
  }

  if (cursor) url.searchParams.set('cursor', cursor);

  return url.toString();
}

async function searchAirbnbSSR(
  params: AirbnbSearchParams,
  bbox: BoundingBox,
  maxResults?: number,
  onProgress?: ProgressCallback,
  request: AirbnbRequest = makeRequest,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const seenIds = new Set<string>();
  let cursor: string | undefined;
  let pageIndex = 0;

  while (true) {
    const url = buildSsrSearchUrl(params, bbox, cursor);

    try {
      const response = await request(
        url,
        {
          headers: BROWSER_HEADERS,
        },
        1,
      );

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
        const pricing = parseAirbnbStructuredDisplayPrice(item?.structuredDisplayPrice, params.currency);

        // Check for superhost badge
        const badges = item?.badges || [];
        const isSuperhost = badges.some(
          (b: any) => b?.text === 'Superhost' || b?.loggingContext?.badgeType === 'SUPERHOST',
        );

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
  request: AirbnbRequest = makeRequest,
): Promise<{ results: SearchResult[]; pagesScanned: number }> {
  const bbox = params.boundingBox;
  if (!bbox) throw new Error('Airbnb search requires a bounding box');

  const seenIds = new Set<string>();
  const allResults: SearchResult[] = [];
  let pagesScanned = 0;

  const progressTracker: ProgressCallback = (page) => {
    pagesScanned++;
    if (onProgress) onProgress(page);
  };

  const addUniqueResults = (results: SearchResult[]): SearchResult[] => {
    const newResults: SearchResult[] = [];
    for (const result of results) {
      if (!seenIds.has(result.id)) {
        seenIds.add(result.id);
        newResults.push(result);
      }
    }
    allResults.push(...newResults);
    return newResults;
  };

  if (!params.exhaustive) {
    // Quick mode: search the bbox directly
    console.log(
      `🔍 Quick Airbnb SSR search: paginating bbox directly (max ${params.maxResults || 'unlimited'} results)...`,
    );
    const results = await searchAirbnbSSR(params, bbox, params.maxResults, progressTracker, request);
    addUniqueResults(results);
  } else {
    console.log('🔍 Exhaustive Airbnb SSR search: adaptive quadrant subdivision...');
    let visitedCells = 0;

    const visitCell = async (cell: BoundingBox, depth: number, seededResults?: SearchResult[]): Promise<void> => {
      visitedCells++;
      const label = `Cell ${visitedCells} (depth ${depth})`;
      console.log(`  📍 ${label}`);

      let effectiveResults = seededResults ?? [];

      if (!seededResults) {
        const results = await searchAirbnbSSR(params, cell, undefined, progressTracker, request);
        effectiveResults = results;
        addUniqueResults(results);
      }

      console.log(`    ↳ ${effectiveResults.length} filtered results`);

      if (
        !shouldProbeChildren({
          bbox: cell,
          depth,
          resultCount: effectiveResults.length,
          config: AIRBNB_SUBDIVISION_CONFIG,
        }) ||
        (params.maxResults && allResults.length >= params.maxResults)
      ) {
        return;
      }

      const childCells = subdivideBbox(cell).filter(
        (child) => !params.circle || bboxIntersectsCircle(child, params.circle),
      );
      if (childCells.length === 0) {
        return;
      }

      console.log(`    ↳ probing ${childCells.length} exact quadrants`);
      const parentIds = new Set(effectiveResults.map((result) => result.id));
      const childSearches: Array<{ cell: BoundingBox; results: SearchResult[] }> = [];
      const childUnionIds = new Set<string>();

      for (const child of childCells) {
        await sleep(CELL_DELAY_MS);
        const results = await searchAirbnbSSR(params, child, undefined, progressTracker, request);
        addUniqueResults(results);
        childSearches.push({ cell: child, results });
        for (const result of results) {
          childUnionIds.add(result.id);
        }
        if (params.maxResults && allResults.length >= params.maxResults) {
          break;
        }
      }

      const newIdCount = countNewChildIds(parentIds, childUnionIds);
      const gain = hasMeaningfulChildGain({
        parentCount: parentIds.size,
        newIdCount,
        config: AIRBNB_SUBDIVISION_CONFIG,
      });
      const shouldRecurse = shouldRecurseIntoChildren({
        depth,
        parentCount: parentIds.size,
        newIdCount,
        config: AIRBNB_SUBDIVISION_CONFIG,
      });
      const forcedRecursion = depth < AIRBNB_SUBDIVISION_CONFIG.forceProbeDepth;
      console.log(
        `    ↳ child cells added ${newIdCount} new IDs beyond parent${
          forcedRecursion && !gain ? ' (continuing to forced depth)' : ''
        }`,
      );

      if (!shouldRecurse || (params.maxResults && allResults.length >= params.maxResults)) {
        return;
      }

      for (const child of childSearches) {
        await visitCell(child.cell, depth + 1, child.results);
        if (params.maxResults && allResults.length >= params.maxResults) {
          break;
        }
      }
    };

    await visitCell(bbox, 0, undefined);
  }

  console.log(`✅ Airbnb search complete: ${allResults.length} unique results, ${pagesScanned} pages scanned`);
  return { results: allResults, pagesScanned };
}
