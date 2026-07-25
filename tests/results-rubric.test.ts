import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getActiveRequirementSetId,
  getListingResultsSnapshot,
  getTriageComparisonStatus,
} from '../web/src/lib/results.js';
import type { ReviewJobListing } from '../web/src/types.js';

function listing(
  id: string,
  triage: Record<string, unknown> | null,
): ReviewJobListing {
  return {
    id,
    platform: 'booking',
    name: id,
    url: `https://example.com/${id}`,
    rating: null,
    reviewCount: 0,
    pricing: null,
    coordinates: null,
    propertyType: null,
    photoUrl: null,
    selected: true,
    liked: false,
    hidden: false,
    poiDistanceMeters: null,
    analysis: triage
      ? {
          triage,
          aiReviews: null,
          aiPhotos: null,
        }
      : null,
  } as unknown as ReviewJobListing;
}

test('missing rubric metadata is explicitly parsed as a legacy AI score', () => {
  const snapshot = getListingResultsSnapshot(
    listing('legacy', {
      fitScore: 88,
      tier: 'top_pick',
      requirements: [
        {
          requirement: 'Quiet',
          type: 'must_have',
          status: 'met',
          confidence: 'high',
          note: 'Legacy shape',
        },
      ],
    }),
  );

  assert.equal(snapshot.triage?.scoreSource, 'model_legacy');
  assert.equal(snapshot.triage?.rankingStatus, 'legacy_unranked');
  assert.equal(snapshot.triage?.requirementSetId, null);
  assert.equal(snapshot.triage?.requirements[0].label, 'Quiet');
  assert.equal(snapshot.triage?.requirements[0].requirementId, null);
});

test('deterministic metadata and affordability reason survive parsing', () => {
  const snapshot = getListingResultsSnapshot(
    listing('rubric', {
      scoreSource: 'deterministic_rubric',
      rubricVersion: '1',
      requirementSetId: 'reqset_a',
      rawFitScore: 70,
      fitScore: 44,
      tier: 'unlikely',
      capReasons: ['weight_gte_3_unmet_high:req-01-quiet'],
      coverage: 0.75,
      rankingStatus: 'ranked',
      requirements: [
        {
          requirementId: 'req-01-quiet',
          label: 'Quiet sleep',
          requirement: 'Quiet sleep',
          type: 'priority',
          rank: 1,
          weight: 3,
          order: 1,
          status: 'unmet',
          confidence: 'high',
          note: 'HVAC noise',
          evidence: [
            {
              layer: 'reviews',
              polarity: 'contradicts',
              text: 'The HVAC sounded like a freight train.',
              frequency: 'repeated',
              years: [2025, 2026],
            },
          ],
        },
      ],
      affordability: {
        status: 'unknown',
        reasonCode: 'currency_mismatch',
        reason: 'Price currency PLN does not match budget currency USD.',
        budgetAmount: 4500,
        priceAmount: 12300,
        currency: 'USD',
        budgetCurrency: 'USD',
        priceCurrency: 'PLN',
        priceBasis: 'stay',
        overByAmount: null,
        overByPercent: null,
        priceSource: 'upstream',
        freshness: 'fresh',
        mandatoryChargesResolved: true,
      },
    }),
  );

  assert.equal(snapshot.triage?.scoreSource, 'deterministic_rubric');
  assert.equal(snapshot.triage?.rawFitScore, 70);
  assert.equal(snapshot.triage?.fitScore, 44);
  assert.deepEqual(snapshot.triage?.capReasons, [
    'weight_gte_3_unmet_high:req-01-quiet',
  ]);
  assert.equal(snapshot.triage?.requirements[0].weight, 3);
  assert.equal(
    snapshot.triage?.requirements[0].evidence[0].years[1],
    2026,
  );
  assert.equal(
    snapshot.triage?.affordability?.reason,
    'Price currency PLN does not match budget currency USD.',
  );
  assert.equal(snapshot.triage?.affordability?.priceCurrency, 'PLN');
  assert.equal(
    snapshot.triage?.affordability?.mandatoryChargesResolved,
    true,
  );
});

test('coverage below one half is treated as insufficient even for older rubric JSON', () => {
  const snapshot = getListingResultsSnapshot(
    listing('thin', {
      scoreSource: 'deterministic_rubric',
      rubricVersion: '1',
      requirementSetId: 'reqset_a',
      fitScore: 50,
      tier: 'consider',
      coverage: 0.49,
    }),
  );
  assert.equal(snapshot.triage?.rankingStatus, 'insufficient_evidence');
});

test('active requirement set is the modal set with stable first-seen ties', () => {
  const a = {
    scoreSource: 'deterministic_rubric',
    rubricVersion: '1',
    requirementSetId: 'reqset_a',
    fitScore: 80,
    tier: 'top_pick',
    rankingStatus: 'ranked',
  };
  const b = { ...a, requirementSetId: 'reqset_b' };
  const listings = [
    listing('a1', a),
    listing('b1', b),
    listing('b2', b),
    listing('legacy', { fitScore: 99, tier: 'top_pick' }),
  ];
  assert.equal(getActiveRequirementSetId(listings), 'reqset_b');
});

test('comparison status separates ranked, insufficient, legacy, and stale sets', () => {
  const ranked = getListingResultsSnapshot(
    listing('ranked', {
      scoreSource: 'deterministic_rubric',
      rubricVersion: '1',
      requirementSetId: 'reqset_active',
      fitScore: 90,
      tier: 'top_pick',
      rankingStatus: 'ranked',
    }),
  ).triage;
  const thin = getListingResultsSnapshot(
    listing('thin', {
      scoreSource: 'deterministic_rubric',
      rubricVersion: '1',
      requirementSetId: 'reqset_active',
      fitScore: 50,
      tier: 'consider',
      rankingStatus: 'insufficient_evidence',
    }),
  ).triage;
  const stale = getListingResultsSnapshot(
    listing('stale', {
      scoreSource: 'deterministic_rubric',
      rubricVersion: '1',
      requirementSetId: 'reqset_old',
      fitScore: 100,
      tier: 'top_pick',
      rankingStatus: 'ranked',
    }),
  ).triage;
  const legacy = getListingResultsSnapshot(
    listing('legacy', { fitScore: 100, tier: 'top_pick' }),
  ).triage;

  assert.equal(
    getTriageComparisonStatus(ranked, 'reqset_active'),
    'ranked',
  );
  assert.equal(
    getTriageComparisonStatus(thin, 'reqset_active'),
    'insufficient_evidence',
  );
  assert.equal(
    getTriageComparisonStatus(stale, 'reqset_active'),
    'stale_requirement_set',
  );
  assert.equal(
    getTriageComparisonStatus(legacy, 'reqset_active'),
    'legacy',
  );
  assert.equal(getTriageComparisonStatus(null, 'reqset_active'), 'unscored');
});
