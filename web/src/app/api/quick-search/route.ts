import { NextRequest, NextResponse } from 'next/server';
import { searchAirbnb } from '@cli/airbnb/search.js';
import { searchBooking } from '@cli/booking/search.js';
import { bootstrapRuntimeProxyEnv } from '@cli/config.js';
import type { AirbnbSearchParams, BookingSearchParams } from '@cli/search/types.js';
import type { QuickSearchRequest } from '@/types';
import { filterResultsForRequest } from '@/lib/resultFilters';
import { resolveComparablePrice } from '@/lib/pricing';
import { createSearchLogger } from '@/lib/searchLog';

export const maxDuration = 60;

function log(msg: string) {
  console.log(`[quick-search] ${msg}`);
}

export async function POST(request: NextRequest) {
  bootstrapRuntimeProxyEnv();

  let body: QuickSearchRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { boundingBox } = body;
  if (!boundingBox) {
    return NextResponse.json({ error: 'Missing boundingBox' }, { status: 400 });
  }

  const start = Date.now();
  log(`combined search starting | bbox: [${boundingBox.swLat.toFixed(3)},${boundingBox.swLng.toFixed(3)} → ${boundingBox.neLat.toFixed(3)},${boundingBox.neLng.toFixed(3)}] | dates: ${body.checkin || 'none'}→${body.checkout || 'none'} | adults: ${body.adults ?? 2}`);
  const searchLogger = createSearchLogger({
    kind: 'quick-search',
    label: body.location || 'map-search',
    payload: {
      requestedPlatforms: body.platforms?.length
        ? body.platforms
        : body.platform
          ? [body.platform]
          : ['airbnb', 'booking'],
      boundingBox,
      circle: body.circle ?? null,
      location: body.location ?? null,
      checkin: body.checkin ?? null,
      checkout: body.checkout ?? null,
      adults: body.adults ?? 2,
      currency: body.currency ?? 'USD',
      priceDisplay: body.priceDisplay ?? 'total',
      priceMin: body.priceMin ?? null,
      priceMax: body.priceMax ?? null,
      minRating: body.minRating ?? null,
      minBedrooms: body.minBedrooms ?? null,
      minBeds: body.minBeds ?? null,
      propertyType: body.propertyType ?? null,
      superhost: body.superhost ?? null,
      instantBook: body.instantBook ?? null,
      stars: body.stars ?? null,
      freeCancellation: body.freeCancellation ?? null,
    },
  });
  if (searchLogger.filePath) {
    log(`structured quick-search log: ${searchLogger.filePath}`);
  }

  try {
    const requestedPlatforms = body.platforms?.length
      ? body.platforms
      : body.platform
        ? [body.platform]
        : ['airbnb', 'booking'];

    const tasks = requestedPlatforms.map(async (platform) => {
      if (platform === 'airbnb') {
        const params: AirbnbSearchParams = {
          platform: 'airbnb',
          boundingBox,
          circle: body.circle,
          location: body.location,
          checkin: body.checkin,
          checkout: body.checkout,
          adults: body.adults ?? 2,
          currency: body.currency ?? 'USD',
          priceMin: body.priceDisplay === 'total' ? undefined : body.priceMin,
          priceMax: body.priceDisplay === 'total' ? undefined : body.priceMax,
          minRating: body.minRating,
          minBedrooms: body.minBedrooms,
          minBeds: body.minBeds,
          propertyType: body.propertyType,
          superhost: body.superhost,
          instantBook: body.instantBook,
          maxResults: 100,
          exhaustive: false,
        };

        const output = await searchAirbnb(params);
        const results = filterResultsForRequest(output.results, body);
        log(`airbnb done: ${results.length} results, ${output.pagesScanned} pages`);
        searchLogger.log('platform_completed', {
          platform,
          fetchedResults: output.results.length,
          keptResults: results.length,
          pagesScanned: output.pagesScanned,
          sampleIds: results.slice(0, 10).map((result) => result.id),
        });
        return {
          platform,
          results,
          pagesScanned: output.pagesScanned,
        };
      }

      if (platform === 'booking') {
        const params: BookingSearchParams = {
          platform: 'booking',
          boundingBox,
          circle: body.circle,
          location: body.location,
          checkin: body.checkin,
          checkout: body.checkout,
          adults: body.adults ?? 2,
          currency: body.currency ?? 'USD',
          priceMin: body.priceDisplay === 'total' ? undefined : body.priceMin,
          priceMax: body.priceDisplay === 'total' ? undefined : body.priceMax,
          minRating: body.minRating,
          minBedrooms: body.minBedrooms,
          minBeds: body.minBeds,
          propertyType: body.propertyType,
          stars: body.stars,
          freeCancellation: body.freeCancellation,
          maxResults: 100,
          exhaustive: false,
        };

        log('booking: calling searchBooking (may bootstrap Playwright ~10s first time)...');
        const output = await searchBooking(params);
        const results = filterResultsForRequest(output.results, body);
        log(`booking done: ${results.length} results, ${output.pagesScanned} pages`);
        searchLogger.log('platform_completed', {
          platform,
          fetchedResults: output.results.length,
          keptResults: results.length,
          pagesScanned: output.pagesScanned,
          sampleIds: results.slice(0, 10).map((result) => result.id),
        });
        return {
          platform,
          results,
          pagesScanned: output.pagesScanned,
        };
      }

      throw new Error(`Unknown platform "${platform}"`);
    });

    const settled = await Promise.allSettled(tasks);
    const warnings: string[] = [];
    const mergedResults = [];
    let pagesScanned = 0;

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        mergedResults.push(...result.value.results);
        pagesScanned += result.value.pagesScanned;
        continue;
      }

      const message =
        result.reason instanceof Error ? result.reason.message : 'Search failed';
      warnings.push(message);
      log(`WARNING: ${message}`);
      searchLogger.log('platform_failed', {
        message,
      });
    }

    if (mergedResults.length === 0 && warnings.length > 0) {
      searchLogger.log('completed', {
        totalResults: 0,
        pagesScanned,
        durationMs: Date.now() - start,
        warnings,
        failed: true,
      });
      return NextResponse.json({ error: warnings[0] }, { status: 500 });
    }

    mergedResults.sort((a, b) => {
      const aAmount = resolveComparablePrice(a, body.priceDisplay ?? 'total', {
        checkin: body.checkin,
        checkout: body.checkout,
      })?.amount;
      const bAmount = resolveComparablePrice(b, body.priceDisplay ?? 'total', {
        checkin: body.checkin,
        checkout: body.checkout,
      })?.amount;

      if (aAmount == null && bAmount == null) return 0;
      if (aAmount == null) return 1;
      if (bAmount == null) return -1;
      return aAmount - bAmount;
    });

    const durationMs = Date.now() - start;
    log(`combined done: ${mergedResults.length} results, ${pagesScanned} pages, ${durationMs}ms`);
    searchLogger.log('completed', {
      totalResults: mergedResults.length,
      pagesScanned,
      durationMs,
      warnings: warnings.length > 0 ? warnings : null,
    });

    return NextResponse.json({
      results: mergedResults,
      totalResults: mergedResults.length,
      pagesScanned,
      durationMs,
      truncated: mergedResults.length >= requestedPlatforms.length * 100,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Search failed';
    const durationMs = Date.now() - start;
    log(`ERROR (${durationMs}ms): ${message}`);
    searchLogger.log('failed', {
      message,
      durationMs,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
