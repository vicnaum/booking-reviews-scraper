import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getReviewJobSearchProgress,
} from '../web/src/lib/reviewJobSearch.js';

test('combined progress advances through explicit platform segments', () => {
  const airbnbStart = getReviewJobSearchProgress({
    platform: 'airbnb',
    stage: 'starting',
  });
  const airbnbPage = getReviewJobSearchProgress({
    platform: 'airbnb',
    stage: 'searching',
    platformPages: 1,
  });
  const airbnbManyPages = getReviewJobSearchProgress({
    platform: 'airbnb',
    stage: 'searching',
    platformPages: 100,
  });
  const airbnbComplete = getReviewJobSearchProgress({
    platform: 'airbnb',
    stage: 'completed',
  });
  const bookingBootstrap = getReviewJobSearchProgress({
    platform: 'booking',
    stage: 'starting',
  });
  const bookingPage = getReviewJobSearchProgress({
    platform: 'booking',
    stage: 'searching',
    platformPages: 1,
  });
  const bookingComplete = getReviewJobSearchProgress({
    platform: 'booking',
    stage: 'completed',
  });

  assert.equal(airbnbStart.currentPhase, 'search:airbnb');
  assert.ok(airbnbPage.progress > airbnbStart.progress);
  assert.ok(airbnbManyPages.progress < airbnbComplete.progress);
  assert.equal(airbnbComplete.progress, 0.48);
  assert.equal(bookingBootstrap.currentPhase, 'search:booking:bootstrap');
  assert.ok(bookingBootstrap.progress > airbnbComplete.progress);
  assert.ok(bookingPage.progress > bookingBootstrap.progress);
  assert.ok(bookingPage.progress < bookingComplete.progress);
  assert.equal(bookingComplete.progress, 0.95);
});

test('unknown page totals never let an active platform claim completion', () => {
  const airbnb = getReviewJobSearchProgress({
    platform: 'airbnb',
    stage: 'searching',
    platformPages: Number.MAX_SAFE_INTEGER,
  });
  const booking = getReviewJobSearchProgress({
    platform: 'booking',
    stage: 'searching',
    platformPages: Number.MAX_SAFE_INTEGER,
  });

  assert.ok(airbnb.progress < 0.48);
  assert.ok(booking.progress < 0.95);
});
