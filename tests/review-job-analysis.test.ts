import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getPoiDistanceMeters,
  getListingMatchKey,
  getManifestPathFromRoot,
  getReviewJobRunDir,
  injectPoiContextIntoListingArtifacts,
  prepareReviewJobPriceRefreshWorkspace,
  prepareReviewJobRunWorkspace,
  pruneAnalysisManifestToListings,
  readJsonFile,
  reconcilePriceRefreshManifest,
  summarizeAnalysisStatus,
  summarizeManifestEntryStatus,
  writeJsonFile,
  type AnalysisManifest,
} from '../web/src/lib/review-job-analysis.js';
import { REVIEW_JOB_ARTIFACT_DIR_ENV } from '../web/src/lib/reviewJobArtifacts.js';

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

test('summarizeAnalysisStatus treats pending listings as partial results', () => {
  assert.equal(
    summarizeAnalysisStatus([{ status: 'completed' }, { status: 'pending' }] as any),
    'partial',
  );
  assert.equal(
    summarizeAnalysisStatus([{ status: 'running' }] as any),
    'partial',
  );
});

test('triage evidence gaps make an otherwise completed listing partial', () => {
  const entry: AnalysisManifest['listings'][string] = {
    platform: 'booking',
    id: 'example',
    url: 'https://www.booking.com/hotel/us/example.en-gb.html',
    details: { status: 'fetched', file: 'listings/listing_example.json' },
    reviews: { status: 'fetched', file: 'reviews/example_reviews.json' },
    photos: { status: 'fetched', dir: 'photos/example' },
    aiReviews: { status: 'fetched', file: 'ai-reviews/example.json' },
    aiPhotos: { status: 'fetched', file: 'ai-photos/example.json' },
    triage: {
      status: 'fetched',
      file: 'triage/example.json',
      evidenceGaps: ['reviews'],
    },
  };

  assert.equal(summarizeManifestEntryStatus(entry), 'partial');
  entry.triage.evidenceGaps = [];
  assert.equal(summarizeManifestEntryStatus(entry), 'completed');
});

test('prepareReviewJobRunWorkspace stages a fresh rerun with AI outputs invalidated', () => {
  const jobId = 'job_stage_test';
  const artifactStore = fs.mkdtempSync(
    path.join(os.tmpdir(), 'review-job-artifact-store-'),
  );
  const sourceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'review-job-run-source-'),
  );
  const previousArtifactDir = process.env[REVIEW_JOB_ARTIFACT_DIR_ENV];
  process.env[REVIEW_JOB_ARTIFACT_DIR_ENV] = artifactStore;

  try {
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
      drop: {
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

    fs.mkdirSync(path.join(sourceRoot, 'listings'), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, 'reviews'), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, 'ai-reviews'), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, 'ai-photos'), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, 'triage'), { recursive: true });
    fs.writeFileSync(getManifestPathFromRoot(sourceRoot), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(sourceRoot, 'listings', 'listing_12345.json'), '{}');
    fs.writeFileSync(path.join(sourceRoot, 'reviews', 'room_12345_reviews.json'), '[]');
    fs.writeFileSync(path.join(sourceRoot, 'ai-reviews', '12345.json'), '{}');
    fs.writeFileSync(path.join(sourceRoot, 'ai-photos', '12345.json'), '{}');
    fs.writeFileSync(path.join(sourceRoot, 'triage', '12345.json'), '{}');
    fs.writeFileSync(path.join(sourceRoot, 'report.html'), '<html></html>');

    const staged = prepareReviewJobRunWorkspace({
      jobId,
      runId: 'run_1',
      previousArtifactRoot: sourceRoot,
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

    assert.equal(staged.rootDir, getReviewJobRunDir(jobId, 'run_1'));
    const updated = readJsonFile<AnalysisManifest>(getManifestPathFromRoot(staged.rootDir));
    assert.ok(updated);
    assert.deepEqual(Object.keys(updated.listings), ['keep']);
    assert.deepEqual(updated.dates, {
      checkIn: '2026-03-20',
      checkOut: '2026-03-29',
      adults: 4,
    });
    assert.equal(updated.listings.keep.aiReviews.status, 'not_requested');
    assert.equal(updated.listings.keep.aiPhotos.status, 'not_requested');
    assert.equal(updated.listings.keep.triage.status, 'not_requested');
    assert.equal(fs.existsSync(path.join(staged.rootDir, 'ai-reviews', '12345.json')), false);
    assert.equal(fs.existsSync(path.join(staged.rootDir, 'ai-photos', '12345.json')), false);
    assert.equal(fs.existsSync(path.join(staged.rootDir, 'triage', '12345.json')), false);
    assert.equal(fs.existsSync(path.join(staged.rootDir, 'report.html')), false);
    assert.equal(fs.existsSync(path.join(staged.rootDir, 'listings', 'listing_12345.json')), true);
    assert.equal(
      fs.existsSync(path.join(staged.rootDir, 'reviews', 'room_12345_reviews.json')),
      true,
    );

    const regrade = prepareReviewJobRunWorkspace({
      jobId,
      runId: 'run_2',
      previousArtifactRoot: sourceRoot,
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
      mode: 'triage',
    });
    const regradeManifest = readJsonFile<AnalysisManifest>(
      getManifestPathFromRoot(regrade.rootDir),
    );
    assert.ok(regradeManifest);
    assert.equal(regradeManifest.listings.keep.aiReviews.status, 'fetched');
    assert.equal(regradeManifest.listings.keep.aiPhotos.status, 'fetched');
    assert.equal(regradeManifest.listings.keep.triage.status, 'not_requested');
    assert.equal(
      fs.existsSync(path.join(regrade.rootDir, 'ai-reviews', '12345.json')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(regrade.rootDir, 'ai-photos', '12345.json')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(regrade.rootDir, 'triage', '12345.json')),
      false,
    );
  } finally {
    if (previousArtifactDir == null) {
      delete process.env[REVIEW_JOB_ARTIFACT_DIR_ENV];
    } else {
      process.env[REVIEW_JOB_ARTIFACT_DIR_ENV] = previousArtifactDir;
    }
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(artifactStore, { recursive: true, force: true });
  }
});

test('price refresh staging preserves non-detail artifacts and restores last known details on failure', () => {
  const artifactStore = fs.mkdtempSync(
    path.join(os.tmpdir(), 'review-job-price-refresh-store-'),
  );
  const sourceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'review-job-price-refresh-source-'),
  );
  const previousArtifactDir = process.env[REVIEW_JOB_ARTIFACT_DIR_ENV];
  process.env[REVIEW_JOB_ARTIFACT_DIR_ENV] = artifactStore;

  const url = 'https://www.booking.com/hotel/us/example.en-gb.html';
  const entry: AnalysisManifest['listings'][string] = {
    platform: 'booking',
    id: 'example',
    url,
    details: {
      status: 'fetched',
      file: 'listings/listing_example.json',
      source: 'network',
    },
    reviews: {
      status: 'fetched',
      file: 'reviews/example_reviews.json',
    },
    photos: { status: 'fetched', dir: 'photos/example' },
    aiReviews: { status: 'fetched', file: 'ai-reviews/example.json' },
    aiPhotos: { status: 'fetched', file: 'ai-photos/example.json' },
    triage: { status: 'fetched', file: 'triage/example.json' },
  };
  const manifest: AnalysisManifest = {
    version: 2,
    createdAt: '2026-07-25T12:00:00.000Z',
    updatedAt: '2026-07-25T12:00:00.000Z',
    dates: {
      checkIn: '2026-08-02',
      checkOut: '2026-08-11',
      adults: 2,
    },
    listings: { 'booking/example': entry },
  };
  const oldDetails = {
    title: 'Last known details',
    staySnapshot: {
      schemaVersion: 1,
      request: {
        platform: 'booking',
        listingId: 'us/example',
        checkIn: '2026-08-02',
        checkOut: '2026-08-11',
        adults: 2,
        linkedRoomId: null,
      },
      priceForStay: {
        amount: 900,
        currency: 'USD',
        basis: 'stay',
        capturedAt: '2026-07-25T12:00:00.000Z',
        source: 'booking_property_page',
        rateType: 'public',
        mandatoryChargesResolved: true,
      },
      availability: {
        status: 'yes',
        capturedAt: '2026-07-25T12:00:00.000Z',
        reasonCode: 'provider_room_inventory',
      },
      providerEvidence: {},
    },
  };

  try {
    for (const dir of [
      'listings',
      'reviews',
      'photos/example',
      'ai-reviews',
      'ai-photos',
      'triage',
    ]) {
      fs.mkdirSync(path.join(sourceRoot, dir), { recursive: true });
    }
    writeJsonFile(getManifestPathFromRoot(sourceRoot), manifest);
    writeJsonFile(path.join(sourceRoot, entry.details.file!), oldDetails);
    writeJsonFile(path.join(sourceRoot, entry.reviews.file!), []);
    writeJsonFile(path.join(sourceRoot, entry.aiReviews.file!), { kept: true });
    writeJsonFile(path.join(sourceRoot, entry.aiPhotos.file!), { kept: true });
    writeJsonFile(path.join(sourceRoot, entry.triage.file!), { kept: true });
    fs.writeFileSync(path.join(sourceRoot, 'photos/example/01.jpg'), 'photo');

    const staged = prepareReviewJobPriceRefreshWorkspace({
      jobId: 'job_price_refresh',
      runId: 'run_failed',
      previousArtifactRoot: sourceRoot,
      dates: {
        checkIn: '2026-08-02',
        checkOut: '2026-08-11',
        adults: 2,
      },
    });
    const failedManifest = readJsonFile<AnalysisManifest>(
      getManifestPathFromRoot(staged.rootDir),
    );
    assert.ok(failedManifest);
    failedManifest.listings['booking/example'].details = {
      status: 'failed',
      error: 'provider timeout',
    };
    writeJsonFile(getManifestPathFromRoot(staged.rootDir), failedManifest);
    writeJsonFile(
      path.join(staged.rootDir, entry.details.file!),
      { title: 'corrupt replacement' },
    );

    const outcomes = reconcilePriceRefreshManifest({
      rootDir: staged.rootDir,
      previousArtifactRoot: sourceRoot,
      previousManifest: staged.previousManifest,
      targetKeys: new Set([getListingMatchKey('booking', url)]),
    });
    assert.equal(outcomes[0].status, 'failed');
    assert.match(outcomes[0].error ?? '', /provider timeout/);
    assert.deepEqual(
      readJsonFile(path.join(staged.rootDir, entry.details.file!)),
      oldDetails,
    );
    assert.deepEqual(
      readJsonFile(path.join(staged.rootDir, entry.aiReviews.file!)),
      { kept: true },
    );
    assert.deepEqual(
      readJsonFile(path.join(staged.rootDir, entry.aiPhotos.file!)),
      { kept: true },
    );
    assert.deepEqual(
      readJsonFile(path.join(staged.rootDir, entry.triage.file!)),
      { kept: true },
    );
    assert.equal(
      fs.readFileSync(
        path.join(staged.rootDir, 'photos/example/01.jpg'),
        'utf8',
      ),
      'photo',
    );

    const successful = prepareReviewJobPriceRefreshWorkspace({
      jobId: 'job_price_refresh',
      runId: 'run_successful',
      previousArtifactRoot: sourceRoot,
      dates: {
        checkIn: '2026-08-02',
        checkOut: '2026-08-11',
        adults: 2,
      },
    });
    const nextDetails = {
      ...oldDetails,
      title: 'Refreshed details',
      staySnapshot: {
        ...oldDetails.staySnapshot,
        priceForStay: {
          ...oldDetails.staySnapshot.priceForStay,
          amount: 950,
          capturedAt: '2026-07-26T18:00:00.000Z',
        },
        availability: {
          status: 'no',
          capturedAt: '2026-07-26T18:00:00.000Z',
          reasonCode: 'provider_unavailable',
        },
      },
    };
    writeJsonFile(
      path.join(successful.rootDir, entry.details.file!),
      nextDetails,
    );
    const successfulManifest = readJsonFile<AnalysisManifest>(
      getManifestPathFromRoot(successful.rootDir),
    );
    assert.ok(successfulManifest);
    successfulManifest.listings['booking/example'].details = {
      status: 'fetched',
      file: entry.details.file,
      source: 'network',
    };
    writeJsonFile(
      getManifestPathFromRoot(successful.rootDir),
      successfulManifest,
    );
    const successfulOutcomes = reconcilePriceRefreshManifest({
      rootDir: successful.rootDir,
      previousArtifactRoot: sourceRoot,
      previousManifest: successful.previousManifest,
      targetKeys: new Set([getListingMatchKey('booking', url)]),
    });
    assert.equal(successfulOutcomes[0].status, 'succeeded');
    assert.equal(successfulOutcomes[0].snapshot?.priceForStay?.amount, 950);
    assert.equal(successfulOutcomes[0].snapshot?.availability.status, 'no');
    assert.deepEqual(
      readJsonFile(path.join(successful.rootDir, entry.aiReviews.file!)),
      { kept: true },
    );
  } finally {
    if (previousArtifactDir == null) {
      delete process.env[REVIEW_JOB_ARTIFACT_DIR_ENV];
    } else {
      process.env[REVIEW_JOB_ARTIFACT_DIR_ENV] = previousArtifactDir;
    }
    fs.rmSync(artifactStore, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});
