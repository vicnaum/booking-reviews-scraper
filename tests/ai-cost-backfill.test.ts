import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAiCostBackfillPlan,
  hasZeroAiCosts,
} from '../web/src/lib/ai-cost-backfill.js';

test('AI cost backfill extracts listing and job totals from manifest phases', () => {
  const plan = buildAiCostBackfillPlan({
    version: 2,
    listings: {
      'airbnb/123': {
        platform: 'airbnb',
        id: '123',
        aiReviews: { status: 'fetched', cost: 0.01234 },
        aiPhotos: { status: 'fetched', cost: 0.05678 },
        triage: { status: 'fetched', cost: 0.00999 },
      },
      'booking/example': {
        platform: 'booking',
        id: 'example',
        aiReviews: { status: 'fetched', cost: 0.1 },
        aiPhotos: { status: 'failed', cost: Number.NaN },
        triage: { status: 'fetched', cost: 0.2 },
      },
      'booking/no-cost': {
        platform: 'booking',
        id: 'no-cost',
        aiReviews: { status: 'skipped' },
        aiPhotos: { status: 'skipped', cost: -1 },
        triage: { status: 'skipped' },
      },
    },
  });

  assert.deepEqual(plan.entries, [
    {
      manifestKey: 'airbnb/123',
      platform: 'airbnb',
      listingId: '123',
      costs: {
        aiReviewsCostUsd: 0.0123,
        aiPhotosCostUsd: 0.0568,
        triageCostUsd: 0.01,
        totalAiCostUsd: 0.0791,
      },
    },
    {
      manifestKey: 'booking/example',
      platform: 'booking',
      listingId: 'example',
      costs: {
        aiReviewsCostUsd: 0.1,
        aiPhotosCostUsd: 0,
        triageCostUsd: 0.2,
        totalAiCostUsd: 0.3,
      },
    },
  ]);
  assert.deepEqual(plan.costs, {
    aiReviewsCostUsd: 0.1123,
    aiPhotosCostUsd: 0.0568,
    triageCostUsd: 0.21,
    totalAiCostUsd: 0.3791,
  });
});

test('AI cost backfill rejects malformed manifests and recognizes zero costs', () => {
  assert.throws(
    () => buildAiCostBackfillPlan({ version: 2 }),
    /listings object/,
  );
  assert.equal(hasZeroAiCosts({
    aiReviewsCostUsd: 0,
    aiPhotosCostUsd: 0,
    triageCostUsd: 0,
    totalAiCostUsd: 0,
  }), true);
  assert.equal(hasZeroAiCosts({
    aiReviewsCostUsd: 0,
    aiPhotosCostUsd: 0.0001,
    triageCostUsd: 0,
    totalAiCostUsd: 0.0001,
  }), false);
});
