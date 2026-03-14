import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getPoiDistanceMeters,
  getManifestPathFromRoot,
  injectPoiContextIntoListingArtifacts,
  pruneAnalysisManifestToListings,
  readJsonFile,
  type AnalysisManifest,
} from '../web/src/lib/review-job-analysis.js';

test('pruneAnalysisManifestToListings keeps only active listings and refreshes dates', () => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'review-job-analysis-test-'),
  );

  const manifest: AnalysisManifest = {
    version: 2,
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    dates: {
      checkIn: '2026-03-01',
      checkOut: '2026-03-05',
      adults: 2,
    },
    listings: {
      'airbnb/keep': {
        platform: 'airbnb',
        id: 'keep',
        url: 'https://www.airbnb.com/rooms/12345',
        details: { status: 'fetched', file: 'listings/listing_12345.json' },
        reviews: { status: 'fetched', file: 'reviews/room_12345_reviews.json' },
        photos: { status: 'fetched', dir: 'photos/12345' },
        aiReviews: { status: 'fetched', file: 'ai-reviews/12345.json' },
        aiPhotos: { status: 'fetched', file: 'ai-photos/12345.json' },
        triage: { status: 'fetched', file: 'triage/12345.json' },
      },
      'booking/drop': {
        platform: 'booking',
        id: 'drop',
        url: 'https://www.booking.com/hotel/gb/drop-me.html',
        details: { status: 'fetched', file: 'listings/listing_drop.json' },
        reviews: { status: 'fetched', file: 'reviews/drop_reviews.json' },
        photos: { status: 'fetched', dir: 'photos/drop' },
        aiReviews: { status: 'fetched', file: 'ai-reviews/drop.json' },
        aiPhotos: { status: 'fetched', file: 'ai-photos/drop.json' },
        triage: { status: 'fetched', file: 'triage/drop.json' },
      },
    },
  };

  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(
    getManifestPathFromRoot(rootDir),
    JSON.stringify(manifest, null, 2),
  );

  pruneAnalysisManifestToListings({
    rootDir,
    listings: [
      {
        platform: 'airbnb',
        url: 'https://www.airbnb.com/rooms/12345',
      },
    ],
    dates: {
      checkIn: '2026-03-20',
      checkOut: '2026-03-29',
      adults: 4,
    },
  });

  const updated = readJsonFile<AnalysisManifest>(getManifestPathFromRoot(rootDir));
  assert.ok(updated);
  assert.deepEqual(Object.keys(updated.listings), ['airbnb/keep']);
  assert.deepEqual(updated.dates, {
    checkIn: '2026-03-20',
    checkOut: '2026-03-29',
    adults: 4,
  });

  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('injectPoiContextIntoListingArtifacts uses persisted fallback coordinates', () => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'review-job-poi-test-'),
  );

  const manifest: AnalysisManifest = {
    version: 2,
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    dates: {},
    listings: {
      keep: {
        platform: 'airbnb',
        id: 'keep',
        url: 'https://www.airbnb.com/rooms/12345',
        details: { status: 'fetched', file: 'listings/listing_12345.json' },
        reviews: { status: 'fetched', file: 'reviews/room_12345_reviews.json' },
        photos: { status: 'fetched', dir: 'photos/12345' },
        aiReviews: { status: 'fetched', file: 'ai-reviews/12345.json' },
        aiPhotos: { status: 'fetched', file: 'ai-photos/12345.json' },
        triage: { status: 'fetched', file: 'triage/12345.json' },
      },
    },
  };

  const listingPath = path.join(rootDir, 'listings', 'listing_12345.json');
  fs.mkdirSync(path.dirname(listingPath), { recursive: true });
  fs.writeFileSync(
    listingPath,
    JSON.stringify({ title: 'Fallback coordinates listing' }, null, 2),
  );

  const poi = { lat: 51.5155, lng: -0.1427 };
  const fallbackCoordinates = { lat: 51.5158, lng: -0.1512 };

  injectPoiContextIntoListingArtifacts({
    rootDir,
    manifest,
    poi,
    fallbackListings: [
      {
        platform: 'airbnb',
        url: 'https://www.airbnb.com/rooms/12345',
        lat: fallbackCoordinates.lat,
        lng: fallbackCoordinates.lng,
        poiDistanceMeters: 9999,
      },
    ],
  });

  const updated = readJsonFile<Record<string, unknown>>(listingPath);
  assert.ok(updated);
  assert.deepEqual(updated.poi, poi);
  assert.deepEqual(updated.coordinates, fallbackCoordinates);
  assert.equal(
    Math.round(updated.poiDistanceMeters as number),
    Math.round(getPoiDistanceMeters(poi, fallbackCoordinates) as number),
  );

  fs.rmSync(rootDir, { recursive: true, force: true });
});
