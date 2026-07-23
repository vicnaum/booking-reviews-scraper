import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  hasPersistedReviewJobResults,
  toReviewJobResponse,
} from '../web/src/lib/reviewJobs.js';
import { AI_JOB_BUDGET_ENV } from '../web/src/lib/aiBudget.js';

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
    aiReviewsCostUsd: 0.0142,
    aiPhotosCostUsd: 0.0061,
    triageCostUsd: 0.0027,
    totalAiCostUsd: 0.023,
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
      aiReviewsCostUsd: 0.0142,
      aiPhotosCostUsd: 0.0061,
      triageCostUsd: 0.0027,
      totalAiCostUsd: 0.023,
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
  assert.equal(response.job.artifactArchiveAvailable, false);
  assert.deepEqual(response.job.costs, {
    aiReviewsUsd: 0.0142,
    aiPhotosUsd: 0.0061,
    triageUsd: 0.0027,
    totalUsd: 0.023,
  });
  assert.deepEqual(response.listings[0].analysis?.costs, {
    aiReviewsUsd: 0.0142,
    aiPhotosUsd: 0.0061,
    triageUsd: 0.0027,
    totalUsd: 0.023,
  });
});

test('legacy html export availability remains separate from native results readiness', () => {
  const artifactRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'review-job-export-availability-'),
  );
  const reportPath = path.join(artifactRoot, 'report.html');
  fs.writeFileSync(reportPath, '<html></html>');

  try {
    const response = toReviewJobResponse({
      job: makeJob({
        analysisStatus: 'pending',
        artifactRoot,
        reportPath,
      }),
      listings: [makeListing({ analysis: null })],
      events: [],
    });

    assert.equal(response.job.reportReady, false);
    assert.equal(response.job.legacyReportAvailable, true);
    assert.equal(response.job.artifactArchiveAvailable, true);

    fs.rmSync(artifactRoot, { recursive: true, force: true });
    const expiredResponse = toReviewJobResponse({
      job: makeJob({
        analysisStatus: 'completed',
        artifactRoot,
        reportPath,
      }),
      listings: [makeListing()],
      events: [],
    });
    assert.equal(expiredResponse.job.reportReady, true);
    assert.equal(expiredResponse.job.legacyReportAvailable, false);
    assert.equal(expiredResponse.job.artifactArchiveAvailable, false);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('budget stops are exposed as durable partial results with their configured ceiling', () => {
  const previousBudget = process.env[AI_JOB_BUDGET_ENV];
  process.env[AI_JOB_BUDGET_ENV] = '99';

  try {
    const response = toReviewJobResponse({
      job: makeJob({
        analysisStatus: 'partial',
        analysisCurrentPhase: 'budget-exceeded',
        analysisErrorMessage: 'Analysis stopped before the next AI call.',
      }),
      listings: [makeListing()],
      events: [
        {
          id: 'event_1',
          jobId: 'job_1',
          phase: 'analysis',
          level: 'warning',
          message: 'Analysis stopped before the next AI call.',
          payload: {
            reason: 'ai-cost-budget',
            budgetUsd: 7.5,
            totalCostUsd: 7.7,
          },
          listingId: null,
          listingPlatform: null,
          createdAt: new Date('2026-03-14T00:04:00.000Z'),
        } as any,
      ],
    });

    assert.equal(response.job.reportReady, true);
    assert.equal(response.job.aiCostBudgetUsd, 7.5);
    assert.equal(response.job.aiCostBudgetExceeded, true);
    assert.equal(
      response.job.analysisErrorMessage,
      'Analysis stopped before the next AI call.',
    );
  } finally {
    if (previousBudget == null) {
      delete process.env[AI_JOB_BUDGET_ENV];
    } else {
      process.env[AI_JOB_BUDGET_ENV] = previousBudget;
    }
  }
});

test('malformed budget config cannot break job reads and warns once', () => {
  const previousBudget = process.env[AI_JOB_BUDGET_ENV];
  const originalWarn = console.warn;
  const warnings: string[] = [];
  process.env[AI_JOB_BUDGET_ENV] = '5 USD';
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '));
  };

  try {
    const first = toReviewJobResponse({
      job: makeJob(),
      listings: [makeListing()],
      events: [],
    });
    const second = toReviewJobResponse({
      job: makeJob(),
      listings: [makeListing()],
      events: [],
    });

    assert.equal(first.job.aiCostBudgetUsd, 5);
    assert.equal(second.job.aiCostBudgetUsd, 5);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Using the \$5\.00 default on job read paths/);
  } finally {
    console.warn = originalWarn;
    if (previousBudget == null) {
      delete process.env[AI_JOB_BUDGET_ENV];
    } else {
      process.env[AI_JOB_BUDGET_ENV] = previousBudget;
    }
  }
});
