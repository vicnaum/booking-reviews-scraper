import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareAffordability,
  getActiveTriageComparison,
  getActiveRequirementSetId,
  getBookingEligibilityRank,
  getListingResultsSnapshot,
  getTriageComparisonStatus,
  getTriageRegradeReasons,
  getTriageRegradeListingCount,
  matchesAffordabilityFilter,
} from '../web/src/lib/results.js';
import type { ReviewJobListing } from '../web/src/types.js';
import {
  getCurrentTriageComparability,
  TRIAGE_CLASSIFIER_VERSION,
} from '../src/triage-comparability.js';

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

test('booking eligibility groups fresh unavailable listings after conditional results', () => {
  const rank = (status: 'eligible' | 'conditional' | 'unknown' | 'excluded') =>
    getBookingEligibilityRank({
      staySnapshot: {
        bookingEligibility: { status },
      },
    } as unknown as Pick<ReviewJobListing, 'staySnapshot'>);

  assert.equal(rank('eligible'), 0);
  assert.equal(rank('conditional'), 1);
  assert.equal(rank('unknown'), 1);
  assert.equal(rank('excluded'), 2);
});

test('deterministic metadata and affordability reason survive parsing', () => {
  const snapshot = getListingResultsSnapshot(
    listing('rubric', {
      scoreSource: 'deterministic_rubric',
      rubricVersion: '1',
      requirementSetId: 'reqset_a',
      classifierVersion: TRIAGE_CLASSIFIER_VERSION,
      modelId: 'gemini:gemini-3-flash-preview:high',
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
  assert.equal(
    snapshot.triage?.classifierVersion,
    TRIAGE_CLASSIFIER_VERSION,
  );
  assert.equal(
    snapshot.triage?.modelId,
    'gemini:gemini-3-flash-preview:high',
  );
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
      classifierVersion: TRIAGE_CLASSIFIER_VERSION,
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
    classifierVersion: TRIAGE_CLASSIFIER_VERSION,
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
  assert.equal(
    getActiveTriageComparison(listings)?.requirementSetId,
    'reqset_b',
  );
});

test('comparison status separates ranked, insufficient, legacy, and stale sets', () => {
  const ranked = getListingResultsSnapshot(
    listing('ranked', {
      scoreSource: 'deterministic_rubric',
      rubricVersion: '1',
      requirementSetId: 'reqset_active',
      classifierVersion: TRIAGE_CLASSIFIER_VERSION,
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
      classifierVersion: TRIAGE_CLASSIFIER_VERSION,
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
      classifierVersion: TRIAGE_CLASSIFIER_VERSION,
      fitScore: 100,
      tier: 'top_pick',
      rankingStatus: 'ranked',
    }),
  ).triage;
  const legacy = getListingResultsSnapshot(
    listing('legacy', { fitScore: 100, tier: 'top_pick' }),
  ).triage;

  const activeComparison =
    getCurrentTriageComparability('reqset_active');
  assert.equal(getTriageComparisonStatus(ranked, activeComparison), 'ranked');
  assert.equal(
    getTriageComparisonStatus(thin, activeComparison),
    'insufficient_evidence',
  );
  assert.equal(
    getTriageComparisonStatus(stale, activeComparison),
    'stale_requirement_set',
  );
  assert.equal(
    getTriageComparisonStatus(legacy, activeComparison),
    'legacy',
  );
  assert.equal(getTriageComparisonStatus(null, activeComparison), 'unscored');
});

test('older classifier policy is preserved but excluded from comparison', () => {
  const oldPolicy = getListingResultsSnapshot(
    listing('old-policy', {
      scoreSource: 'deterministic_rubric',
      rubricVersion: '1',
      requirementSetId: 'reqset_active',
      fitScore: 79,
      tier: 'shortlist',
      rankingStatus: 'ranked',
      modelId: 'gemini:gemini-3-flash-preview:high',
    }),
  ).triage;

  assert.equal(oldPolicy?.scoreSource, 'deterministic_rubric');
  assert.equal(oldPolicy?.classifierVersion, null);
  assert.equal(oldPolicy?.comparabilityKey, null);
  assert.equal(
    getTriageComparisonStatus(
      oldPolicy,
      getCurrentTriageComparability('reqset_active'),
    ),
    'stale_classifier_policy',
  );
});

test('model identity is audit metadata and does not gate comparison', () => {
  const first = getListingResultsSnapshot(
    listing('model-a', {
      scoreSource: 'deterministic_rubric',
      rubricVersion: '1',
      requirementSetId: 'reqset_active',
      classifierVersion: TRIAGE_CLASSIFIER_VERSION,
      modelId: 'gemini:model-a:high',
      fitScore: 80,
      tier: 'shortlist',
    }),
  ).triage;
  const second = getListingResultsSnapshot(
    listing('model-b', {
      scoreSource: 'deterministic_rubric',
      rubricVersion: '1',
      requirementSetId: 'reqset_active',
      classifierVersion: TRIAGE_CLASSIFIER_VERSION,
      modelId: 'gemini:model-b:high',
      fitScore: 81,
      tier: 'shortlist',
    }),
  ).triage;

  assert.equal(first?.comparabilityKey, second?.comparabilityKey);
});

test('whole-job regrade scope counts every non-hidden listing', () => {
  const stale = listing('stale', {
    scoreSource: 'deterministic_rubric',
    rubricVersion: '1',
    requirementSetId: 'reqset_active',
    fitScore: 79,
    tier: 'shortlist',
    rankingStatus: 'ranked',
  });
  const current = listing('current', {
    scoreSource: 'deterministic_rubric',
    rubricVersion: '1',
    requirementSetId: 'reqset_active',
    classifierVersion: TRIAGE_CLASSIFIER_VERSION,
    fitScore: 44,
    tier: 'unlikely',
    rankingStatus: 'ranked',
  });
  const hidden = {
    ...listing('hidden', null),
    hidden: true,
  };

  assert.equal(
    getTriageRegradeListingCount([stale, current, hidden]),
    2,
  );
});

test('brief and comparability staleness share ordered regrade reason codes', () => {
  const current = listing('current', {
    scoreSource: 'deterministic_rubric',
    rubricVersion: '1',
    requirementSetId: 'reqset_active',
    classifierVersion: TRIAGE_CLASSIFIER_VERSION,
    fitScore: 80,
    tier: 'top_pick',
    rankingStatus: 'ranked',
  });
  const oldPolicy = listing('old-policy', {
    scoreSource: 'deterministic_rubric',
    rubricVersion: '1',
    requirementSetId: 'reqset_active',
    fitScore: 79,
    tier: 'shortlist',
    rankingStatus: 'ranked',
  });
  const mismatched = listing('mismatched', {
    scoreSource: 'deterministic_rubric',
    rubricVersion: '1',
    requirementSetId: 'reqset_other',
    classifierVersion: TRIAGE_CLASSIFIER_VERSION,
    fitScore: 90,
    tier: 'top_pick',
    rankingStatus: 'ranked',
  });
  const activeComparison =
    getCurrentTriageComparability('reqset_active');

  assert.deepEqual(
    getTriageRegradeReasons(
      [current, oldPolicy, mismatched],
      activeComparison,
      true,
    ),
    [
      'brief_changed',
      'classifier_policy_changed',
      'requirement_set_mismatch',
    ],
  );
  assert.equal(
    getTriageComparisonStatus(
      getListingResultsSnapshot(current).triage,
      activeComparison,
      { regradeRequired: true },
    ),
    'regrade_required',
  );
});

test('budget-fit ordering is within, least over, then unknown', () => {
  const affordability = (
    status: 'within' | 'over' | 'unknown',
    overByPercent: number | null = null,
  ) => ({
    status,
    overByPercent,
  }) as ReviewJobListing['affordability'];
  const values = [
    affordability('unknown'),
    affordability('over', 18),
    affordability('within'),
    affordability('over', 4),
    affordability('over', null),
  ];

  values.sort(compareAffordability);
  assert.deepEqual(
    values.map((value) => [value.status, value.overByPercent]),
    [
      ['within', null],
      ['over', 4],
      ['over', 18],
      ['over', null],
      ['unknown', null],
    ],
  );
  assert.equal(
    matchesAffordabilityFilter(
      { affordability: affordability('over', 4) },
      new Set(['within', 'unknown']),
    ),
    false,
  );
  assert.equal(
    matchesAffordabilityFilter(
      { affordability: affordability('unknown') },
      new Set(['within', 'unknown']),
    ),
    true,
  );
});
