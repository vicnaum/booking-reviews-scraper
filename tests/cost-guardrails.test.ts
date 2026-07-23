import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runAnalyze } from '../src/analyze.js';
import {
  DEFAULT_AI_REVIEW_LIMIT,
  resolveAiReviewLimit,
  selectMostRecentReviews,
} from '../src/review-guardrails.js';
import {
  DEFAULT_AI_JOB_BUDGET_USD,
  buildAiBudgetExceededMessage,
  hasReachedAiJobBudget,
  resolveAiJobBudgetUsd,
} from '../web/src/lib/aiBudget.js';

test('review limit defaults to 250 and honors explicit values before env', () => {
  assert.equal(resolveAiReviewLimit(undefined, undefined), DEFAULT_AI_REVIEW_LIMIT);
  assert.equal(resolveAiReviewLimit(undefined, '300'), 300);
  assert.equal(resolveAiReviewLimit(125, '300'), 125);
});

test('review limit rejects disabled or malformed hard caps', () => {
  assert.throws(() => resolveAiReviewLimit(0), /positive integer/);
  assert.throws(() => resolveAiReviewLimit(undefined, '12.5'), /positive integer/);
  assert.throws(() => resolveAiReviewLimit(undefined, 'many'), /positive integer/);
});

test('review cap selects the newest eligible reviews without mutating input', () => {
  const input = [
    { id: 'older', date: '2024-01-01' },
    { id: 'newest', date: '2026-02-01' },
    { id: 'middle', date: '2025-06-01' },
  ];

  const result = selectMostRecentReviews(input, (review) => review.date, 2);

  assert.deepEqual(result.reviews.map((review) => review.id), ['newest', 'middle']);
  assert.deepEqual(input.map((review) => review.id), ['older', 'newest', 'middle']);
  assert.deepEqual(
    {
      eligibleCount: result.eligibleCount,
      includedCount: result.includedCount,
      limit: result.limit,
      capped: result.capped,
    },
    {
      eligibleCount: 3,
      includedCount: 2,
      limit: 2,
      capped: true,
    },
  );
});

test('runAnalyze applies the cap after filtering and only formats selected reviews', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-cap-test-'));
  const reviewsFile = path.join(tempDir, 'reviews.json');
  const currentYear = new Date().getFullYear();
  fs.writeFileSync(
    reviewsFile,
    JSON.stringify({
      input_file: 'test',
      scraped_at: '2026-07-23T00:00:00.000Z',
      total_reviews: 5,
      properties_processed: ['listing'],
      reviews: [
        {
          review_date: `${currentYear - 4}-01-01`,
          review_text: 'EXPIRED review should be removed before applying the cap.',
          rating: 5,
          language: 'en',
        },
        {
          review_date: `${currentYear - 3}-01-01`,
          review_text: 'OLDEST review should not reach the prompt.',
          rating: 5,
          language: 'en',
        },
        {
          review_date: `${currentYear - 1}-01-01`,
          review_text: 'MIDDLE review should reach the prompt.',
          rating: 5,
          language: 'en',
        },
        {
          review_date: `${currentYear}-01-01`,
          review_text: 'NEWEST review should reach the prompt.',
          rating: 5,
          language: 'en',
        },
        {
          review_date: `${currentYear}-02-01`,
          review_text: '',
          rating: 5,
          language: 'en',
        },
      ],
    }),
  );

  const stdout: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => {
    stdout.push(args.join(' '));
  };
  console.error = () => {};

  try {
    const result = await runAnalyze({
      reviewsFile,
      dryRun: true,
      model: 'gpt-4o-mini',
      maxReviews: 2,
    });

    assert.deepEqual(result.reviewSelection, {
      eligibleCount: 3,
      includedCount: 2,
      limit: 2,
      capped: true,
    });
    assert.match(stdout.join('\n'), /MIDDLE review/);
    assert.match(stdout.join('\n'), /NEWEST review/);
    assert.doesNotMatch(stdout.join('\n'), /OLDEST review/);
    assert.doesNotMatch(stdout.join('\n'), /EXPIRED review/);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('AI job budget has a safe default and supports an explicit opt-out', () => {
  assert.equal(resolveAiJobBudgetUsd(undefined), DEFAULT_AI_JOB_BUDGET_USD);
  assert.equal(resolveAiJobBudgetUsd('7.50'), 7.5);
  assert.equal(resolveAiJobBudgetUsd('off'), null);
  assert.equal(resolveAiJobBudgetUsd(0), null);
  assert.throws(() => resolveAiJobBudgetUsd('-1'), /non-negative USD amount/);
});

test('AI job budget stops at the limit and reports actual persisted spend', () => {
  assert.equal(hasReachedAiJobBudget(4.9999, 5), false);
  assert.equal(hasReachedAiJobBudget(5, 5), true);
  assert.equal(hasReachedAiJobBudget(500, null), false);
  assert.equal(
    buildAiBudgetExceededMessage({ totalCostUsd: 5.1234, budgetUsd: 5 }),
    'AI cost budget reached: $5.1234 spent against $5.00 limit. '
      + 'Analysis stopped before the next AI call.',
  );
});
