import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatReviewProgressLabel,
  getScrapeProgressFraction,
  shouldEmitReviewProgressEvent,
} from '../src/review-progress.js';

test('shouldEmitReviewProgressEvent always emits first and last pages', () => {
  assert.equal(
    shouldEmitReviewProgressEvent({ currentPage: 1, totalPages: 466 }),
    true,
  );
  assert.equal(
    shouldEmitReviewProgressEvent({ currentPage: 466, totalPages: 466 }),
    true,
  );
});

test('shouldEmitReviewProgressEvent throttles large page counts', () => {
  assert.equal(
    shouldEmitReviewProgressEvent({ currentPage: 19, totalPages: 466 }),
    false,
  );
  assert.equal(
    shouldEmitReviewProgressEvent({ currentPage: 20, totalPages: 466 }),
    true,
  );
});

test('formatReviewProgressLabel produces readable booking labels', () => {
  assert.equal(
    formatReviewProgressLabel({
      platform: 'booking',
      listingId: 'mandeville',
      currentPage: 120,
      totalPages: 466,
    }),
    'Booking reviews · mandeville · page 120/466',
  );
});

test('getScrapeProgressFraction advances across pages and listings', () => {
  assert.equal(
    getScrapeProgressFraction({
      listingIndex: 1,
      listingCount: 2,
      currentPage: 1,
      totalPages: 10,
    }),
    0.05,
  );

  assert.equal(
    getScrapeProgressFraction({
      listingIndex: 2,
      listingCount: 2,
      currentPage: 5,
      totalPages: 10,
    }),
    0.75,
  );
});
