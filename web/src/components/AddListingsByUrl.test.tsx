import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReviewJobResponse } from '@/types';
import AddListingsByUrl from './AddListingsByUrl.js';

test('add-by-URL control explains its additive analysis boundary', () => {
  const html = renderToStaticMarkup(
    <AddListingsByUrl
      job={{
        id: 'job_1',
        viewerCanEdit: true,
        status: 'completed',
        analysisStatus: 'completed',
        analysisCurrentPhase: 'completed',
        priceRefreshStatus: 'pending',
        priceRefreshCurrentPhase: null,
      } as ReviewJobResponse['job']}
      onQueued={async () => {}}
    />,
  );

  assert.match(html, /Add listings by URL/);
  assert.match(html, /Airbnb or Booking\.com/);
  assert.match(html, /Only new listings are scraped and analyzed/);
  assert.match(html, /existing results and your shortlist stay unchanged/);
  assert.match(html, /Add and analyze/);
});

test('add-by-URL control is owner-only', () => {
  const html = renderToStaticMarkup(
    <AddListingsByUrl
      job={{
        id: 'job_1',
        viewerCanEdit: false,
        status: 'completed',
        analysisStatus: 'completed',
        analysisCurrentPhase: 'completed',
        priceRefreshStatus: 'pending',
        priceRefreshCurrentPhase: null,
      } as ReviewJobResponse['job']}
      onQueued={async () => {}}
    />,
  );

  assert.equal(html, '');
});
