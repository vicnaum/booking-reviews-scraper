import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AiBudgetNotice from './AiBudgetNotice.js';

test('budget-exceeded analysis renders its partial status and phase', () => {
  const html = renderToStaticMarkup(
    <AiBudgetNotice
      job={{
        aiCostBudgetExceeded: true,
        analysisStatus: 'partial',
        analysisCurrentPhase: 'budget-exceeded',
        analysisErrorMessage: 'Analysis stopped before the next AI call.',
      }}
    />,
  );

  assert.match(html, /Analysis stopped at the AI cost limit/);
  assert.match(html, /Partial/);
  assert.match(html, /budget-exceeded/);
  assert.match(html, /Analysis stopped before the next AI call/);
});

test('budget notice stays hidden when the ceiling did not stop the run', () => {
  const html = renderToStaticMarkup(
    <AiBudgetNotice
      job={{
        aiCostBudgetExceeded: false,
        analysisStatus: 'completed',
        analysisCurrentPhase: 'completed',
        analysisErrorMessage: null,
      }}
    />,
  );

  assert.equal(html, '');
});
