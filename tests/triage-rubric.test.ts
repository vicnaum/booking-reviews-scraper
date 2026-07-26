import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIN_RANKED_COVERAGE,
  buildCanonicalRequirementSet,
  computeAffordability,
  effectiveRequirementValue,
  getDefaultRequirementInputs,
  recomputeStoredAffordability,
  resolveRequirementWeight,
  scoreTriageAssessments,
  tierForFitScore,
  type CanonicalRequirementInput,
  type CanonicalRequirementSet,
  type RequirementAssessmentInput,
  type RequirementConfidence,
  type RequirementStatus,
} from '../src/triage-rubric.js';
import {
  extractComparableStayPrice,
  getTriageRequirementParserVersion,
} from '../src/triage.js';

function makeSet(
  definitions: CanonicalRequirementInput[],
): CanonicalRequirementSet {
  return buildCanonicalRequirementSet({
    brief: 'Test brief',
    parserVersion: 'test-parser-v1',
    definitions,
  });
}

function outcomes(
  set: CanonicalRequirementSet,
  status: RequirementStatus = 'met',
  confidence: RequirementConfidence = 'high',
): RequirementAssessmentInput[] {
  return set.definitions.map((definition) => ({
    requirementId: definition.id,
    status,
    confidence,
    note: `${status}/${confidence}`,
    evidence: [],
  }));
}

test('confidence shrinks met and unmet outcomes toward neutral', () => {
  assert.equal(effectiveRequirementValue('met', 'high'), 1);
  assert.equal(effectiveRequirementValue('met', 'medium'), 0.875);
  assert.equal(effectiveRequirementValue('met', 'low'), 0.75);
  assert.equal(effectiveRequirementValue('unmet', 'high'), 0);
  assert.equal(effectiveRequirementValue('unmet', 'medium'), 0.125);
  assert.equal(effectiveRequirementValue('unmet', 'low'), 0.25);
});

test('partial and unknown are neutral at every confidence', () => {
  for (const confidence of ['high', 'medium', 'low'] as const) {
    assert.equal(effectiveRequirementValue('partial', confidence), 0.5);
    assert.equal(effectiveRequirementValue('unknown', confidence), 0.5);
  }
});

test('requirement weights follow type and rank-one priority rules', () => {
  assert.equal(resolveRequirementWeight('deal_breaker'), 4);
  assert.equal(resolveRequirementWeight('must_have'), 3);
  assert.equal(resolveRequirementWeight('priority'), 2);
  assert.equal(resolveRequirementWeight('priority', 1), 3);
  assert.equal(resolveRequirementWeight('priority', 2), 2);
  assert.equal(resolveRequirementWeight('nice_to_have'), 1);
});

test('default requirements are deterministic and defensive copies', () => {
  const first = getDefaultRequirementInputs();
  const second = getDefaultRequirementInputs();
  assert.equal(first.length, 4);
  assert.deepEqual(
    first.map((definition) => definition.type),
    ['priority', 'priority', 'priority', 'nice_to_have'],
  );
  first[0].label = 'changed';
  first[0].criteria?.push('changed');
  assert.notEqual(second[0].label, 'changed');
  assert.ok(!second[0].criteria?.includes('changed'));
});

test('canonical IDs and set hashes are stable for the same definitions', () => {
  const definitions: CanonicalRequirementInput[] = [
    {
      label: 'Quiet sleep',
      type: 'priority',
      rank: 1,
      order: 2,
      criteria: ['No HVAC noise'],
    },
    {
      label: 'Workspace',
      type: 'priority',
      rank: 3,
      order: 3,
    },
    {
      label: 'Value',
      type: 'priority',
      rank: 2,
      order: 1,
    },
  ];
  const first = buildCanonicalRequirementSet({
    brief: 'Original prose',
    parserVersion: 'parser-v1',
    definitions,
  });
  const second = buildCanonicalRequirementSet({
    brief: 'Equivalent revised prose',
    parserVersion: 'parser-v1',
    definitions: [...definitions].reverse(),
  });

  assert.equal(first.id, second.id);
  assert.deepEqual(first.definitions, second.definitions);
  assert.deepEqual(
    first.definitions.map((definition) => definition.id),
    ['req-01-value', 'req-02-quiet-sleep', 'req-03-workspace'],
  );
  assert.equal(first.definitions[1].weight, 3);
});

test('parser version and definitions affect the requirement-set hash, budget does not', () => {
  const definitions: CanonicalRequirementInput[] = [
    { label: 'Quiet', type: 'priority', rank: 1 },
  ];
  const original = buildCanonicalRequirementSet({
    parserVersion: 'parser-v1',
    definitions,
    parsedBudget: {
      maximumAmount: 4500,
      currency: 'USD',
      basis: 'stay',
      source: 'brief',
    },
  });
  const changedBudget = buildCanonicalRequirementSet({
    parserVersion: 'parser-v1',
    definitions,
    parsedBudget: {
      maximumAmount: 5000,
      currency: 'USD',
      basis: 'stay',
      source: 'brief',
    },
  });
  const changedParser = buildCanonicalRequirementSet({
    parserVersion: 'parser-v2',
    definitions,
  });
  const changedDefinition = buildCanonicalRequirementSet({
    parserVersion: 'parser-v1',
    definitions: [{ label: 'Very quiet', type: 'priority', rank: 1 }],
  });

  assert.equal(original.id, changedBudget.id);
  assert.notEqual(original.id, changedParser.id);
  assert.notEqual(original.id, changedDefinition.id);
});

test('requirement parser version is model-aware but defaults need no model parse', () => {
  assert.equal(
    getTriageRequirementParserVersion('gemini-3-flash-preview:high'),
    'triage-default-requirements-v1',
  );
  assert.match(
    getTriageRequirementParserVersion(
      'gemini-3-flash-preview:high',
      'Quiet sleep',
    ),
    /triage-requirements-v1:gemini:gemini-3-flash-preview:high/,
  );
});

test('weighted scoring is deterministic and uses integer half-up rounding', () => {
  const set = makeSet([
    { label: 'A', type: 'nice_to_have' },
    { label: 'B', type: 'nice_to_have' },
    { label: 'C', type: 'nice_to_have' },
  ]);
  const result = scoreTriageAssessments(set, [
    {
      requirementId: set.definitions[2].id,
      status: 'unmet',
      confidence: 'high',
      note: '',
    },
    {
      requirementId: set.definitions[0].id,
      status: 'met',
      confidence: 'high',
      note: '',
    },
    {
      requirementId: set.definitions[1].id,
      status: 'partial',
      confidence: 'high',
      note: '',
    },
  ]);

  assert.equal(result.rawFitScore, 50);
  assert.equal(result.fitScore, 50);
  assert.equal(result.tier, 'consider');
  assert.deepEqual(
    result.requirements.map((requirement) => requirement.requirementId),
    set.definitions.map((definition) => definition.id),
  );
});

test('score rounding resolves exact half points upward', () => {
  const set = makeSet(
    Array.from({ length: 8 }, (_, index) => ({
      label: `Requirement ${index + 1}`,
      type: 'nice_to_have' as const,
    })),
  );
  const assessment = outcomes(set, 'unmet', 'high');
  assessment[0] = {
    requirementId: set.definitions[0].id,
    status: 'met',
    confidence: 'high',
    note: '',
  };

  const result = scoreTriageAssessments(set, assessment);
  assert.equal(result.rawFitScore, 13);
  assert.equal(result.fitScore, 13);
});

test('a rank-boosted priority uses the major cap ladder', () => {
  const set = makeSet([
    { label: 'Sleep quality', type: 'priority', rank: 1 },
    { label: 'A', type: 'priority' },
    { label: 'B', type: 'priority' },
    { label: 'C', type: 'nice_to_have' },
    { label: 'D', type: 'nice_to_have' },
    { label: 'E', type: 'nice_to_have' },
  ]);
  const assessment = outcomes(set);
  assessment[0] = {
    requirementId: set.definitions[0].id,
    status: 'unmet',
    confidence: 'high',
    note: 'Freight-train HVAC noise',
  };
  const result = scoreTriageAssessments(set, assessment);

  assert.equal(result.rawFitScore, 70);
  assert.equal(result.fitScore, 44);
  assert.equal(result.tier, 'unlikely');
  assert.ok(
    result.capReasons.includes(
      `weight_gte_3_unmet_high:${set.definitions[0].id}`,
    ),
  );
});

test('critical and multiple-major failures force no-go', () => {
  const criticalSet = makeSet([
    { label: 'Accessible entrance', type: 'deal_breaker' },
    ...Array.from({ length: 10 }, (_, index) => ({
      label: `Bonus ${index + 1}`,
      type: 'nice_to_have' as const,
    })),
  ]);
  const criticalAssessments = outcomes(criticalSet);
  criticalAssessments[0] = {
    requirementId: criticalSet.definitions[0].id,
    status: 'unmet',
    confidence: 'high',
    note: '',
  };
  const critical = scoreTriageAssessments(
    criticalSet,
    criticalAssessments,
  );
  assert.equal(critical.rawFitScore, 71);
  assert.equal(critical.fitScore, 24);
  assert.equal(critical.tier, 'no_go');

  const majorSet = makeSet([
    { label: 'Quiet', type: 'must_have' },
    { label: 'Elevator', type: 'must_have' },
    ...Array.from({ length: 20 }, (_, index) => ({
      label: `Bonus ${index + 1}`,
      type: 'nice_to_have' as const,
    })),
  ]);
  const majorAssessments = outcomes(majorSet);
  for (const index of [0, 1]) {
    majorAssessments[index] = {
      requirementId: majorSet.definitions[index].id,
      status: 'unmet',
      confidence: 'high',
      note: '',
    };
  }
  const multiple = scoreTriageAssessments(majorSet, majorAssessments);
  assert.equal(multiple.fitScore, 24);
  assert.ok(
    multiple.capReasons.some((reason) =>
      reason.startsWith('multiple_weight_gte_3_unmet_high:')),
  );
});

test('major and critical uncertainty caps use lowest-cap-wins', () => {
  const set = makeSet([
    { label: 'Critical', type: 'deal_breaker' },
    { label: 'Major', type: 'must_have' },
    ...Array.from({ length: 20 }, (_, index) => ({
      label: `Bonus ${index + 1}`,
      type: 'nice_to_have' as const,
    })),
  ]);
  const assessment = outcomes(set);
  assessment[0] = {
    requirementId: set.definitions[0].id,
    status: 'partial',
    confidence: 'high',
    note: '',
  };
  assessment[1] = {
    requirementId: set.definitions[1].id,
    status: 'met',
    confidence: 'low',
    note: '',
  };
  const result = scoreTriageAssessments(set, assessment);

  assert.equal(result.fitScore, 64);
  assert.ok(
    result.capReasons.includes(
      `weight_gte_4_uncertain_or_unmet_low:${set.definitions[0].id}`,
    ),
  );
  assert.ok(
    result.capReasons.includes(
      `weight_gte_3_partial:${set.definitions[0].id}`,
    ),
  );
  assert.ok(
    result.capReasons.includes(
      `weight_gte_3_met_low:${set.definitions[1].id}`,
    ),
  );
});

test('major unmet non-high, unknown, partial, and met-low caps are explicit', () => {
  const cases: Array<{
    status: RequirementStatus;
    confidence: RequirementConfidence;
    cap: number;
    reason: string;
  }> = [
    {
      status: 'unmet',
      confidence: 'medium',
      cap: 64,
      reason: 'weight_gte_3_unknown_or_unmet_non_high',
    },
    {
      status: 'unmet',
      confidence: 'low',
      cap: 64,
      reason: 'weight_gte_3_unknown_or_unmet_non_high',
    },
    {
      status: 'unknown',
      confidence: 'low',
      cap: 64,
      reason: 'weight_gte_3_unknown_or_unmet_non_high',
    },
    {
      status: 'partial',
      confidence: 'high',
      cap: 79,
      reason: 'weight_gte_3_partial',
    },
    {
      status: 'met',
      confidence: 'low',
      cap: 79,
      reason: 'weight_gte_3_met_low',
    },
  ];

  for (const item of cases) {
    const set = makeSet([
      { label: 'Major', type: 'must_have' },
      ...Array.from({ length: 20 }, (_, index) => ({
        label: `Bonus ${index + 1}`,
        type: 'nice_to_have' as const,
      })),
    ]);
    const assessment = outcomes(set);
    assessment[0] = {
      requirementId: set.definitions[0].id,
      status: item.status,
      confidence: item.confidence,
      note: '',
    };
    const result = scoreTriageAssessments(set, assessment);
    assert.equal(result.fitScore, item.cap);
    assert.ok(
      result.capReasons.some((reason) => reason.startsWith(item.reason)),
    );
  }
});

test('coverage below one half is auditable but unranked', () => {
  const set = makeSet([
    { label: 'A', type: 'priority' },
    { label: 'B', type: 'priority' },
    { label: 'C', type: 'priority' },
  ]);
  const result = scoreTriageAssessments(set, outcomes(set, 'unknown', 'low'));

  assert.equal(MIN_RANKED_COVERAGE, 0.5);
  assert.equal(result.rawFitScore, 50);
  assert.equal(result.tier, 'consider');
  assert.equal(result.coverage, 0);
  assert.equal(result.rankingStatus, 'insufficient_evidence');
  assert.match(result.rankingReason ?? '', /0%/);
});

test('coverage exactly one half remains rankable', () => {
  const set = makeSet([
    { label: 'Known', type: 'priority' },
    { label: 'Unknown', type: 'priority' },
  ]);
  const assessment = outcomes(set, 'unknown', 'low');
  assessment[0] = {
    requirementId: set.definitions[0].id,
    status: 'met',
    confidence: 'high',
    note: '',
  };
  const result = scoreTriageAssessments(set, assessment);

  assert.equal(result.coverage, 0.5);
  assert.equal(result.rankingStatus, 'ranked');
});

test('missing assessments become explicit unknown outcomes', () => {
  const set = makeSet([
    { label: 'A', type: 'priority' },
    { label: 'B', type: 'priority' },
  ]);
  const result = scoreTriageAssessments(set, [
    {
      requirementId: set.definitions[0].id,
      status: 'met',
      confidence: 'high',
      note: '',
    },
  ]);
  assert.equal(result.requirements[1].status, 'unknown');
  assert.match(result.requirements[1].note, /did not return/);
});

test('unknown and duplicate classifier IDs are rejected', () => {
  const set = makeSet([{ label: 'A', type: 'priority' }]);
  assert.throws(
    () =>
      scoreTriageAssessments(set, [
        {
          requirementId: 'req-99-unknown',
          status: 'met',
          confidence: 'high',
          note: '',
        },
      ]),
    /unknown requirement ID/,
  );
  const valid = outcomes(set)[0];
  assert.throws(
    () => scoreTriageAssessments(set, [valid, valid]),
    /duplicate requirement ID/,
  );
});

test('tier boundaries are exact', () => {
  assert.equal(tierForFitScore(100), 'top_pick');
  assert.equal(tierForFitScore(80), 'top_pick');
  assert.equal(tierForFitScore(79), 'shortlist');
  assert.equal(tierForFitScore(65), 'shortlist');
  assert.equal(tierForFitScore(64), 'consider');
  assert.equal(tierForFitScore(45), 'consider');
  assert.equal(tierForFitScore(44), 'unlikely');
  assert.equal(tierForFitScore(25), 'unlikely');
  assert.equal(tierForFitScore(24), 'no_go');
  assert.equal(tierForFitScore(0), 'no_go');
});

const freshPublicPrice = {
  amount: 4500,
  currency: 'USD',
  basis: 'stay' as const,
  source: 'upstream',
  capturedAt: '2026-07-24T12:00:00.000Z',
  freshness: 'fresh' as const,
  rateType: 'public' as const,
  mandatoryChargesResolved: true,
};

const usdBudget = {
  amount: 4500,
  currency: 'USD',
  basis: 'stay' as const,
  source: 'explicit' as const,
};

test('affordability uses exact stay-total comparison and overage math', () => {
  const within = computeAffordability({
    budget: usdBudget,
    price: freshPublicPrice,
  });
  assert.equal(within.status, 'within');
  assert.equal(within.overByAmount, 0);
  assert.equal(within.overByPercent, 0);

  const over = computeAffordability({
    budget: usdBudget,
    price: { ...freshPublicPrice, amount: 4950 },
  });
  assert.equal(over.status, 'over');
  assert.equal(over.overByAmount, 450);
  assert.equal(over.overByPercent, 10);
  assert.equal(over.budgetCurrency, 'USD');
  assert.equal(over.priceCurrency, 'USD');
  assert.equal(over.priceBasis, 'stay');
  assert.equal(over.mandatoryChargesResolved, true);
  assert.deepEqual(over.comparablePrice, {
    ...freshPublicPrice,
    amount: 4950,
  });
});

test('affordability rounds percentage half-up to two decimals', () => {
  const result = computeAffordability({
    budget: { ...usdBudget, amount: '3.00' },
    price: { ...freshPublicPrice, amount: '3.01' },
  });
  assert.equal(result.status, 'over');
  assert.equal(result.overByAmount, 0.01);
  assert.equal(result.overByPercent, 0.33);
});

test('affordability unknown reasons are specific and user-facing', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');
  const cases = [
    {
      result: computeAffordability({ budget: null, price: freshPublicPrice }),
      code: 'no_budget_given',
      message: 'No analysis budget was given.',
    },
    {
      result: computeAffordability({ budget: usdBudget, price: null }),
      code: 'price_missing',
      message: 'Price is missing for the selected stay.',
    },
    {
      result: computeAffordability({
        budget: usdBudget,
        price: {
          ...freshPublicPrice,
          freshness: 'stale' as const,
          capturedAt: '2026-07-13T12:00:00.000Z',
        },
        now,
      }),
      code: 'price_stale',
      message: 'Price is stale (12 days old).',
    },
    {
      result: computeAffordability({
        budget: usdBudget,
        price: { ...freshPublicPrice, currency: 'PLN' },
      }),
      code: 'currency_mismatch',
      message: 'Price currency PLN does not match budget currency USD.',
    },
    {
      result: computeAffordability({
        budget: usdBudget,
        price: { ...freshPublicPrice, mandatoryChargesResolved: false },
      }),
      code: 'mandatory_charges_unresolved',
      message: 'Mandatory charges are unresolved in this price.',
    },
  ];

  for (const item of cases) {
    assert.equal(item.result.status, 'unknown');
    assert.equal(item.result.reasonCode, item.code);
    assert.equal(item.result.reason, item.message);
  }
});

test('affordability rejects unknown freshness, non-stay basis, and non-public rates', () => {
  const unknownFreshness = computeAffordability({
    budget: usdBudget,
    price: { ...freshPublicPrice, freshness: 'unknown' },
  });
  assert.equal(
    unknownFreshness.reasonCode,
    'price_freshness_unknown',
  );
  assert.match(unknownFreshness.reason ?? '', /freshness is unknown/);

  const nightly = computeAffordability({
    budget: usdBudget,
    price: { ...freshPublicPrice, basis: 'night' },
  });
  assert.equal(nightly.reasonCode, 'stay_basis_unresolved');

  const memberRate = computeAffordability({
    budget: usdBudget,
    price: { ...freshPublicPrice, rateType: 'member' },
  });
  assert.equal(memberRate.reasonCode, 'rate_not_public');
});

test('availability gates affordability without changing the quality verdict', () => {
  const baseAvailability = {
    status: 'yes' as const,
    capturedAt: '2026-07-26T12:00:00.000Z',
    freshness: 'fresh' as const,
    reasonCode: 'provider_room_inventory',
  };
  const cases = [
    {
      availability: { ...baseAvailability, status: 'no' as const },
      code: 'stay_unavailable',
    },
    {
      availability: {
        ...baseAvailability,
        status: 'partial' as const,
        availableRange: {
          checkIn: '2026-07-31',
          checkOut: '2026-08-11',
        },
      },
      code: 'stay_partially_available',
    },
    {
      availability: { ...baseAvailability, status: 'unknown' as const },
      code: 'availability_unknown',
    },
    {
      availability: {
        ...baseAvailability,
        status: 'no' as const,
        freshness: 'stale' as const,
      },
      code: 'availability_stale',
    },
  ];

  for (const item of cases) {
    const result = computeAffordability({
      budget: usdBudget,
      price: freshPublicPrice,
      availability: item.availability,
      now: new Date('2026-07-26T18:00:00.000Z'),
    });
    assert.equal(result.status, 'unknown');
    assert.equal(result.reasonCode, item.code);
  }

  const available = computeAffordability({
    budget: usdBudget,
    price: freshPublicPrice,
    availability: baseAvailability,
  });
  assert.equal(available.status, 'within');
});

test('affordability never changes a deterministic quality verdict', () => {
  const set = makeSet([
    { label: 'Quiet', type: 'priority', rank: 1 },
    { label: 'Workspace', type: 'priority' },
  ]);
  const before = scoreTriageAssessments(set, outcomes(set));
  computeAffordability({
    budget: usdBudget,
    price: { ...freshPublicPrice, amount: 9000 },
  });
  const after = scoreTriageAssessments(set, outcomes(set));
  assert.deepEqual(after, before);
});

test('stored affordability recomputes from price inputs without an LLM call', () => {
  const initial = computeAffordability({
    budget: usdBudget,
    price: {
      ...freshPublicPrice,
      amount: 4950,
      currency: 'PLN',
    },
  });
  assert.equal(initial.reasonCode, 'currency_mismatch');
  assert.equal(initial.priceCurrency, 'PLN');

  const recomputed = recomputeStoredAffordability({
    affordability: initial,
    budget: {
      amount: 5000,
      currency: 'PLN',
      basis: 'stay',
      source: 'explicit',
    },
  });
  assert.equal(recomputed?.status, 'within');
  assert.equal(recomputed?.budgetAmount, 5000);
  assert.equal(recomputed?.priceAmount, 4950);
  assert.equal(recomputed?.currency, 'PLN');
});

test('stored affordability preserves missing prices and refuses pre-snapshot guesses', () => {
  const missing = computeAffordability({
    budget: null,
    price: null,
  });
  const recomputedMissing = recomputeStoredAffordability({
    affordability: missing,
    budget: usdBudget,
  });
  assert.equal(recomputedMissing?.reasonCode, 'price_missing');
  assert.equal(recomputedMissing?.budgetAmount, 4500);

  assert.equal(
    recomputeStoredAffordability({
      affordability: {
        status: 'over',
        priceAmount: 5000,
        currency: 'USD',
      },
      budget: usdBudget,
    }),
    null,
  );
});

test('Booking room totals become a comparable stay price with detected PLN', () => {
  const price = extractComparableStayPrice(
    {
      scrapedAt: '2026-07-24T12:00:00.000Z',
      pricing: {
        currency: null,
        rooms: [
          { totalPrice: '13,779 zł' },
          { totalPrice: '12,300 zł' },
        ],
      },
    },
    'fresh',
  );

  assert.deepEqual(price, {
    amount: 12300,
    currency: 'PLN',
    basis: 'stay',
    source: 'upstream',
    capturedAt: '2026-07-24T12:00:00.000Z',
    freshness: 'fresh',
    rateType: 'public',
    mandatoryChargesResolved: true,
  });
  const affordability = computeAffordability({
    budget: usdBudget,
    price,
  });
  assert.equal(affordability.reasonCode, 'currency_mismatch');
  assert.equal(
    affordability.reason,
    'Price currency PLN does not match budget currency USD.',
  );
});

test('structured upstream totals remain full-stay prices', () => {
  assert.deepEqual(
    extractComparableStayPrice(
      {
        pricing: {
          total: {
            amount: 1877.52,
            currency: 'USD',
            source: 'derived',
          },
        },
      },
      'fresh',
    ),
    {
      amount: 1877.52,
      currency: 'USD',
      basis: 'stay',
      source: 'derived',
      capturedAt: null,
      freshness: 'fresh',
      rateType: 'public',
      mandatoryChargesResolved: true,
    },
  );
  assert.equal(extractComparableStayPrice({ pricing: null }), null);
});
