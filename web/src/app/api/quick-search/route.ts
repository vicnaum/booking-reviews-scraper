import { NextRequest, NextResponse } from 'next/server';
import { searchAirbnb } from '@cli/airbnb/search.js';
import { searchBooking } from '@cli/booking/search.js';
import { bootstrapRuntimeProxyEnv } from '@cli/config.js';
import type { AirbnbSearchParams, BookingSearchParams } from '@cli/search/types.js';
import type { QuickSearchRequest } from '@/types';

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

  const { platform, boundingBox } = body;
  if (!boundingBox) {
    return NextResponse.json({ error: 'Missing boundingBox' }, { status: 400 });
  }

  const start = Date.now();
  log(`${platform} search starting | bbox: [${boundingBox.swLat.toFixed(3)},${boundingBox.swLng.toFixed(3)} → ${boundingBox.neLat.toFixed(3)},${boundingBox.neLng.toFixed(3)}] | dates: ${body.checkin || 'none'}→${body.checkout || 'none'} | adults: ${body.adults ?? 2}`);

  try {
    if (platform === 'airbnb') {
      const params: AirbnbSearchParams = {
        platform: 'airbnb',
        boundingBox,
        location: body.location,
        checkin: body.checkin,
        checkout: body.checkout,
        adults: body.adults ?? 2,
        currency: body.currency ?? 'USD',
        priceMin: body.priceMin,
        priceMax: body.priceMax,
        minRating: body.minRating,
        minBedrooms: body.minBedrooms,
        minBeds: body.minBeds,
        propertyType: body.propertyType,
        superhost: body.superhost,
        instantBook: body.instantBook,
        maxResults: 100,
        exhaustive: false,
      };

      const { results, pagesScanned } = await searchAirbnb(params);
      const durationMs = Date.now() - start;
      log(`airbnb done: ${results.length} results, ${pagesScanned} pages, ${durationMs}ms`);

      return NextResponse.json({
        results,
        totalResults: results.length,
        pagesScanned,
        durationMs,
        truncated: results.length >= 100,
      });
    }

    if (platform === 'booking') {
      const params: BookingSearchParams = {
        platform: 'booking',
        boundingBox,
        location: body.location,
        checkin: body.checkin,
        checkout: body.checkout,
        adults: body.adults ?? 2,
        currency: body.currency ?? 'USD',
        priceMin: body.priceMin,
        priceMax: body.priceMax,
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
      const { results, pagesScanned } = await searchBooking(params);
      const durationMs = Date.now() - start;
      log(`booking done: ${results.length} results, ${pagesScanned} pages, ${durationMs}ms`);

      return NextResponse.json({
        results,
        totalResults: results.length,
        pagesScanned,
        durationMs,
        truncated: results.length >= 100,
      });
    }

    return NextResponse.json(
      { error: `Unknown platform "${platform}"` },
      { status: 400 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Search failed';
    const durationMs = Date.now() - start;
    log(`ERROR (${durationMs}ms): ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
