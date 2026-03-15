import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getReviewJobQueueJobId,
  shouldReuseReviewJobQueueState,
} from '../web/src/lib/review-job-queue.js';

test('review-job queue ids are deterministic per phase and job', () => {
  assert.equal(
    getReviewJobQueueJobId('search', 'job_123'),
    'review-job:search:job_123',
  );
  assert.equal(
    getReviewJobQueueJobId('analyze', 'job_123'),
    'review-job:analyze:job_123',
  );
});

test('review-job queue reuses only active queued states', () => {
  assert.equal(shouldReuseReviewJobQueueState('waiting'), true);
  assert.equal(shouldReuseReviewJobQueueState('active'), true);
  assert.equal(shouldReuseReviewJobQueueState('delayed'), true);
  assert.equal(shouldReuseReviewJobQueueState('prioritized'), true);
  assert.equal(shouldReuseReviewJobQueueState('waiting-children'), true);
  assert.equal(shouldReuseReviewJobQueueState('completed'), false);
  assert.equal(shouldReuseReviewJobQueueState('failed'), false);
});
