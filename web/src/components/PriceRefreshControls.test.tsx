import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReviewJobListing, ReviewJobResponse } from '@/types';
import PriceRefreshControls from './PriceRefreshControls.js';

test('price refresh controls show scope, progress, and details-only boundary', () => {
  const html = renderToStaticMarkup(
    <PriceRefreshControls
      job={{
        id: 'job_1',
        viewerCanEdit: true,
        status: 'completed',
        analysisStatus: 'completed',
        analysisCurrentPhase: 'completed',
        checkin: '2026-07-29',
        checkout: '2026-08-11',
        artifactArchiveAvailable: true,
        priceRefreshStatus: 'running',
        priceRefreshCurrentPhase: 'booking:example',
        priceRefreshProgress: 0.5,
        priceRefreshSummary: {
          requested: 2,
          succeeded: 1,
          failed: 0,
        },
      } as ReviewJobResponse['job']}
      selectedListings={[{
        id: 'example',
        platform: 'booking',
      } as ReviewJobListing]}
      onQueued={async () => {}}
    />,
  );

  assert.match(html, /Refresh all/);
  assert.match(html, /Refresh selected \(1\)/);
  assert.match(html, /Reviews, photos, AI, and quality scores are left untouched/);
  assert.match(html, /50%/);
  assert.match(html, /single date range/);
});
