import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReviewJobSearchOutcome } from '../web/src/lib/reviewJobSearch.js';

test('combined review-job search persists partial success when one platform fails', () => {
  const summary = summarizeReviewJobSearchOutcome({
    successfulPlatforms: ['airbnb'],
    warnings: [
      {
        platform: 'booking',
        message: 'PersistedQueryNotFound',
      },
    ],
  });

  assert.equal(summary.canPersistResults, true);
  assert.equal(summary.completedEventLevel, 'warning');
  assert.equal(summary.completedEventMessage, 'Combined full search completed with warnings');
  assert.equal(summary.failureMessage, null);
});

test('combined review-job search fails only when every platform fails', () => {
  const summary = summarizeReviewJobSearchOutcome({
    successfulPlatforms: [],
    warnings: [
      {
        platform: 'airbnb',
        message: '429 Too Many Requests',
      },
      {
        platform: 'booking',
        message: 'PersistedQueryNotFound',
      },
    ],
  });

  assert.equal(summary.canPersistResults, false);
  assert.equal(summary.completedEventLevel, 'warning');
  assert.equal(summary.completedEventMessage, 'Combined full search failed on every platform');
  assert.match(summary.failureMessage ?? '', /airbnb: 429 Too Many Requests/);
  assert.match(summary.failureMessage ?? '', /booking: PersistedQueryNotFound/);
});

test('combined review-job search can complete with zero listings when a platform still succeeded', () => {
  const summary = summarizeReviewJobSearchOutcome({
    successfulPlatforms: ['booking'],
    warnings: [],
  });

  assert.equal(summary.canPersistResults, true);
  assert.equal(summary.completedEventLevel, 'info');
  assert.equal(summary.completedEventMessage, 'Combined full search completed');
  assert.equal(summary.failureMessage, null);
});
