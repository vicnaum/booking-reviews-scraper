import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ESTIMATED_TRIAGE_COST_USD_PER_LISTING,
  LEGACY_TRIAGE_CLASSIFIER_VERSION,
  TRIAGE_CLASSIFIER_VERSION,
  estimateTriageRegradeCostUsd,
  getCurrentTriageComparability,
  getTriageComparabilityKey,
} from '../src/triage-comparability.js';
import {
  getTriageClassifierPrompt,
  normalizeTriageStayContext,
} from '../src/triage.js';

test('comparability key requires policy metadata and deliberately ignores model id', () => {
  const current = getCurrentTriageComparability('reqset_a');
  assert.equal(
    current.key,
    getTriageComparabilityKey({
      rubricVersion: '1',
      requirementSetId: 'reqset_a',
      classifierVersion: TRIAGE_CLASSIFIER_VERSION,
    }),
  );
  assert.equal(
    getTriageComparabilityKey({
      rubricVersion: '1',
      requirementSetId: 'reqset_a',
    }),
    null,
  );
  const withAuditModel = {
    rubricVersion: '1',
    requirementSetId: 'reqset_a',
    classifierVersion: TRIAGE_CLASSIFIER_VERSION,
    modelId: 'ignored by the comparability helper',
  };
  assert.equal(getTriageComparabilityKey(withAuditModel), current.key);
});

test('regrade estimate uses the measured per-listing classifier cost', () => {
  assert.equal(ESTIMATED_TRIAGE_COST_USD_PER_LISTING, 0.006);
  assert.equal(estimateTriageRegradeCostUsd(54), 0.324);
  assert.equal(estimateTriageRegradeCostUsd(0), 0);
});

test('classifier v2 defines the high-leverage boundary without changing v1', () => {
  const legacy = getTriageClassifierPrompt(
    LEGACY_TRIAGE_CLASSIFIER_VERSION,
  );
  const current = getTriageClassifierPrompt(TRIAGE_CLASSIFIER_VERSION);

  assert.match(legacy, /partial.*Partially satisfied or with caveats/s);
  assert.doesNotMatch(legacy, /Candlewood Suites/);
  assert.match(current, /specific, verifiable choice/);
  assert.match(current, /Candlewood Suites/);
  assert.match(current, /Club Quarters/);
  assert.match(current, /Turning off a needed system/);
});

test('stay context carries exact job dates, length, guests, and destination', () => {
  assert.deepEqual(
    normalizeTriageStayContext(
      {
        checkIn: '2026-07-29',
        checkOut: '2026-08-11',
        adults: 2,
      },
      {
        address: {
          full: 'Midtown Manhattan, New York, USA',
        },
      },
    ),
    {
      checkIn: '2026-07-29',
      checkOut: '2026-08-11',
      nights: 13,
      adults: 2,
      destination: 'Midtown Manhattan, New York, USA',
    },
  );
});
