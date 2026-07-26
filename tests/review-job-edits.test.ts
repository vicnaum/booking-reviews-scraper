import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getQualityBriefEditEffect,
  normalizeQualityBriefForComparison,
  regradeRequiredAfterAnalysis,
} from '../web/src/lib/reviewJobEdits.js';

test('quality brief normalization ignores whitespace-only edits', () => {
  assert.equal(
    normalizeQualityBriefForComparison(
      '  Quiet sleep\n  and a real desk  ',
    ),
    'Quiet sleep and a real desk',
  );
  assert.deepEqual(
    getQualityBriefEditEffect({
      currentPrompt: 'Quiet sleep and a real desk',
      nextPrompt: '  Quiet   sleep\nand a real desk ',
      analysisStatus: 'completed',
      regradeRequired: false,
    }),
    {
      storedPrompt: 'Quiet   sleep\nand a real desk',
      qualityBriefChanged: false,
      regradeRequired: false,
    },
  );
});

test('a real quality brief edit invalidates persisted verdicts only', () => {
  assert.deepEqual(
    getQualityBriefEditEffect({
      currentPrompt: 'Quiet sleep',
      nextPrompt: 'Quiet sleep and blackout curtains',
      analysisStatus: 'completed',
      regradeRequired: false,
    }),
    {
      storedPrompt: 'Quiet sleep and blackout curtains',
      qualityBriefChanged: true,
      regradeRequired: true,
    },
  );
  assert.equal(
    getQualityBriefEditEffect({
      currentPrompt: 'Quiet sleep',
      nextPrompt: 'Quiet sleep and blackout curtains',
      analysisStatus: 'pending',
      regradeRequired: false,
    }).regradeRequired,
    false,
  );
  assert.equal(
    getQualityBriefEditEffect({
      currentPrompt: 'Quiet sleep',
      nextPrompt: 'Near the venue',
      analysisStatus: 'partial',
      regradeRequired: false,
    }).regradeRequired,
    true,
  );
  assert.equal(
    getQualityBriefEditEffect({
      currentPrompt: 'Quiet sleep',
      nextPrompt: 'Near the venue',
      analysisStatus: 'pending',
      regradeRequired: true,
    }).regradeRequired,
    true,
  );
});

test('regrade validity clears only after a fully completed run', () => {
  assert.equal(regradeRequiredAfterAnalysis(true, 'completed'), false);
  assert.equal(regradeRequiredAfterAnalysis(true, 'partial'), true);
  assert.equal(regradeRequiredAfterAnalysis(true, 'failed'), true);
  assert.equal(regradeRequiredAfterAnalysis(false, 'partial'), false);
});
