import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReviewJobSearchProgress from './ReviewJobSearchProgress.js';

test('booking bootstrap names the slow phase and preserves incremental count', () => {
  const html = renderToStaticMarkup(
    <ReviewJobSearchProgress
      currentPhase="search:booking:bootstrap"
      progress={0.52}
      listingCount={37}
    />,
  );

  assert.match(html, /Booking browser session/);
  assert.match(html, /52%/);
  assert.match(html, /37 listings saved so far/);
  assert.match(html, /first Booking results can take a few minutes/);
});

test('airbnb progress explains that listings arrive incrementally', () => {
  const html = renderToStaticMarkup(
    <ReviewJobSearchProgress
      currentPhase="search:airbnb"
      progress={0.24}
      listingCount={12}
    />,
  );

  assert.match(html, /Airbnb area search/);
  assert.match(html, /12 listings saved so far/);
  assert.match(html, /pages and cells complete/);
});
