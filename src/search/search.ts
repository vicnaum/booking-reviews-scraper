// src/search/search.ts
//
// Search orchestrator: resolve location → dispatch to platform → deduplicate → write output

import * as fs from 'fs';
import * as path from 'path';
import { geocodeLocation, parseBboxString } from './geo.js';
import type {
  SearchParams,
  AirbnbSearchParams,
  BookingSearchParams,
  SearchResult,
  SearchOutput,
  BoundingBox,
  SearchPage,
} from './types.js';

/**
 * Main search entry point — called from CLI
 */
export async function runSearch(params: SearchParams): Promise<SearchOutput> {
  const startTime = Date.now();

  // 1. Validate
  if (!params.location && !params.boundingBox) {
    throw new Error('Either --location or --bbox is required');
  }

  // 2. Resolve bounding box
  let bbox: BoundingBox | undefined = params.boundingBox;

  if (!bbox && params.location) {
    bbox = await geocodeLocation(params.location);
  }

  if (bbox) {
    params.boundingBox = bbox;
  }

  // 3. Set up SIGINT handler for partial results
  let interrupted = false;
  let partialResults: SearchResult[] = [];

  const sigintHandler = () => {
    if (interrupted) {
      console.log('\n⚠️  Force exit');
      process.exit(1);
    }
    interrupted = true;
    console.log('\n⚠️  Interrupted — saving partial results...');
  };
  process.on('SIGINT', sigintHandler);

  // 4. Progress logging
  let totalFound = 0;
  const onProgress = (page: SearchPage) => {
    totalFound += page.results.length;
    const newCount = page.results.length;
    if (newCount > 0) {
      console.log(`  📦 Page ${page.pageIndex}: +${newCount} new (${totalFound} total unique)`);
    }
  };

  // 5. Dispatch to platform
  let results: SearchResult[] = [];
  let pagesScanned = 0;

  try {
    if (params.platform === 'airbnb') {
      const { searchAirbnb } = await import('../airbnb/search.js');
      const airbnbParams: AirbnbSearchParams = {
        ...params,
        platform: 'airbnb',
        superhost: (params as any).superhost,
        instantBook: (params as any).instantBook,
        amenities: (params as any).amenities,
      };
      const out = await searchAirbnb(airbnbParams, onProgress);
      results = out.results;
      pagesScanned = out.pagesScanned;
    } else {
      const { searchBooking } = await import('../booking/search.js');
      const bookingParams: BookingSearchParams = {
        ...params,
        platform: 'booking',
        stars: (params as any).stars,
        freeCancellation: (params as any).freeCancellation,
        destId: (params as any).destId,
      };
      const out = await searchBooking(bookingParams, onProgress);
      results = out.results;
      pagesScanned = out.pagesScanned;
    }
  } catch (error: any) {
    console.error(`❌ Search error: ${error.message}`);
    // Use whatever results we gathered via progress callback
    results = partialResults;
  }

  // Clean up SIGINT handler
  process.removeListener('SIGINT', sigintHandler);

  // If interrupted, use partial results from progress
  if (interrupted && results.length === 0) {
    results = partialResults;
  }

  // 6. Post-filter by minRating (in case platform didn't filter natively)
  if (params.minRating) {
    const before = results.length;
    results = results.filter(r => r.rating === null || r.rating >= params.minRating!);
    const filtered = before - results.length;
    if (filtered > 0) {
      console.log(`  🔽 Filtered ${filtered} results below rating ${params.minRating}`);
    }
  }

  // 7. Cap to maxResults
  if (params.maxResults && results.length > params.maxResults) {
    results = results.slice(0, params.maxResults);
  }

  // 8. Build output
  const durationMs = Date.now() - startTime;

  const filters: Record<string, unknown> = {};
  if (params.minRating) filters.minRating = params.minRating;
  if (params.priceMin) filters.priceMin = params.priceMin;
  if (params.priceMax) filters.priceMax = params.priceMax;
  if (params.propertyType) filters.propertyType = params.propertyType;

  const output: SearchOutput = {
    search: {
      platform: params.platform,
      location: params.location || null,
      checkin: params.checkin || null,
      checkout: params.checkout || null,
      adults: params.adults,
      filters,
      currency: params.currency,
      totalResults: results.length,
      pagesScanned,
      searchedAt: new Date().toISOString(),
      mode: params.exhaustive ? 'exhaustive' : 'quick',
      boundingBox: bbox || null,
      durationMs,
    },
    results,
  };

  // 9. Write output files
  const outputDir = params.outputDir || 'data';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonPath = path.join(outputDir, 'search-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\n📄 Results: ${jsonPath}`);

  const urlsPath = path.join(outputDir, 'search-urls.txt');
  const urls = results.map(r => r.url).join('\n');
  fs.writeFileSync(urlsPath, urls + '\n');
  console.log(`📄 URLs: ${urlsPath}`);

  console.log(`\n🎉 Search complete: ${results.length} results in ${(durationMs / 1000).toFixed(1)}s`);

  return output;
}
