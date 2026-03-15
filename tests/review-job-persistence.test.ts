import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPersistedReviewJobResults,
  toReviewJobResponse,
} from '../web/src/lib/reviewJobs.js';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    ownerKey: 'owner_1',
    status: 'completed',
    currentPhase: 'results-ready',
    analysisStatus: 'completed',
    analysisCurrentPhase: 'completed',
    location: 'London',
    prompt: 'quiet and close to POI',
    boundingBox: null,
    circle: null,
    poi: null,
    mapBounds: null,
    mapCenter: null,
    mapZoom: 17,
    searchAreaMode: 'rectangle',
    checkin: '2026-03-20',
    checkout: '2026-03-29',
    adults: 2,
    currency: 'USD',
    filters: null,
    totalResults: 1,
    pagesScanned: 2,
    progress: 1,
    errorMessage: null,
    queueJobId: null,
    analysisQueueJobId: null,
    artifactRoot: null,
    reportPath: null,
    createdAt: new Date('2026-03-14T00:00:00.000Z'),
    startedAt: new Date('2026-03-14T00:01:00.000Z'),
    completedAt: new Date('2026-03-14T00:02:00.000Z'),
    durationMs: 60000,
    analysisProgress: 1,
    analysisErrorMessage: null,
    analysisStartedAt: new Date('2026-03-14T00:03:00.000Z'),
    analysisCompletedAt: new Date('2026-03-14T00:04:00.000Z'),
    analysisDurationMs: 60000,
    ...overrides,
  } as any;
}

function makeListing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row_1',
    jobId: 'job_1',
    listingId: 'listing_1',
    platform: 'airbnb',
    name: 'Test listing',
    url: 'https://www.airbnb.com/rooms/123',
    rating: 5,
    reviewCount: 10,
    priceAmount: 120,
    priceCurrency: 'USD',
    totalPrice: 1080,
    pricing: null,
    lat: 51.5,
    lng: -0.1,
    propertyType: 'Entire home/apt',
    photoUrl: null,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    maxGuests: 2,
    superhost: true,
    instantBook: false,
    hostId: 'host_1',
    stars: null,
    freeCancellation: null,
    selected: true,
    hidden: false,
    poiDistanceMeters: 42,
    createdAt: new Date('2026-03-14T00:00:00.000Z'),
    analysis: {
      id: 'analysis_1',
      jobListingId: 'row_1',
      status: 'completed',
      currentPhase: 'completed',
      errorMessage: null,
      detailsStatus: 'completed',
      reviewsStatus: 'completed',
      photosStatus: 'completed',
      aiReviewsStatus: 'completed',
      aiPhotosStatus: 'completed',
      triageStatus: 'completed',
      details: { title: 'Test listing' },
      aiReviews: { overallSentiment: 'great' },
      aiPhotos: { overallImpression: 'clean' },
      triage: { fitScore: 88, tier: 'shortlist' },
      reviewCount: 10,
      photoCount: 12,
      createdAt: new Date('2026-03-14T00:00:00.000Z'),
      updatedAt: new Date('2026-03-14T00:05:00.000Z'),
      startedAt: new Date('2026-03-14T00:03:00.000Z'),
      completedAt: new Date('2026-03-14T00:04:00.000Z'),
      durationMs: 60000,
    },
    ...overrides,
  } as any;
}

test('native results readiness is derived from persisted analysis state, not report files', () => {
  assert.equal(hasPersistedReviewJobResults(makeJob({ analysisStatus: 'completed' })), true);
  assert.equal(hasPersistedReviewJobResults(makeJob({ analysisStatus: 'partial' })), true);
  assert.equal(hasPersistedReviewJobResults(makeJob({ analysisStatus: 'pending' })), false);

  const response = toReviewJobResponse({
    job: makeJob({
      analysisStatus: 'completed',
      reportPath: null,
    }),
    listings: [makeListing()],
    events: [],
  });

  assert.equal(response.job.reportReady, true);
  assert.equal(response.job.legacyReportAvailable, false);
});

test('legacy html export availability remains separate from native results readiness', () => {
  const response = toReviewJobResponse({
    job: makeJob({
      analysisStatus: 'pending',
      reportPath: '/tmp/report.html',
    }),
    listings: [makeListing({ analysis: null })],
    events: [],
  });

  assert.equal(response.job.reportReady, false);
  assert.equal(response.job.legacyReportAvailable, true);
});
