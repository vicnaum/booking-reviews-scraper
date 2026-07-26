import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TRIAGE_CLASSIFIER_VERSION,
  TRIAGE_RUBRIC_VERSION,
} from '@cli/triage-comparability';
import type { ReviewJobListing } from '@/types';
import PrioritiesMatrix from './PrioritiesMatrix.js';

const requirementSet = {
  id: 'reqset_ui_fixture',
  schemaVersion: 1,
  parserVersion: 'fixture-parser-v1',
  brief: 'Quiet sleep',
  definitions: [
    {
      id: 'req-01-quiet-sleep',
      label: 'Quiet sleep',
      type: 'priority',
      rank: 1,
      weight: 3,
      sourceText: 'Quiet sleep',
      criteria: ['No overnight HVAC noise'],
      order: 1,
    },
  ],
  parsedBudget: null,
};

function listing(
  id: string,
  options: {
    insufficient?: boolean;
    evidenceGaps?: string[];
  } = {},
): ReviewJobListing {
  return {
    id,
    platform: 'booking',
    name:
      options.insufficient
        ? 'Sparse Review Hotel'
        : 'Sleep Test Hotel',
    url: `https://www.booking.com/hotel/us/${id}.html`,
    staySnapshot: {
      availability: {
        status: 'yes',
        capturedAt: '2026-07-26T18:00:00.000Z',
        reasonCode: 'provider_room_inventory',
      },
      freshness: {
        price: 'fresh',
        availability: 'fresh',
      },
      bookingEligibility: {
        status: 'eligible',
        actionable: true,
        reasonCode: 'available',
        reason: 'Available for the recorded dates and guest count.',
      },
    },
    affordability: {
      status: 'within',
      reasonCode: 'within_budget',
      reason: 'The public stay total is within budget.',
      budgetAmount: 3000,
      priceAmount: 2400,
      currency: 'USD',
      overByAmount: null,
      overByPercent: null,
    },
    analysis: {
      triage: {
        scoreSource: 'deterministic_rubric',
        rubricVersion: TRIAGE_RUBRIC_VERSION,
        classifierVersion: TRIAGE_CLASSIFIER_VERSION,
        requirementSetId: requirementSet.id,
        requirementSet,
        rankingStatus:
          options.insufficient ? 'insufficient_evidence' : 'ranked',
        coverage: options.insufficient ? 0.25 : 1,
        evidenceGaps: options.evidenceGaps ?? [],
        requirements: [
          {
            ...requirementSet.definitions[0],
            requirementId: 'req-01-quiet-sleep',
            requirement: 'Quiet sleep',
            status: options.insufficient ? 'unknown' : 'unmet',
            confidence: options.insufficient ? 'low' : 'high',
            note:
              options.insufficient
                ? 'Not enough review evidence.'
                : 'HVAC noise is a material sleep risk.',
            evidence:
              options.insufficient
                ? []
                : [
                    {
                      layer: 'reviews',
                      polarity: 'contradicts',
                      text: 'Guests repeatedly report loud HVAC cycling.',
                      frequency: '42 of 250 reviews',
                      years: [2026],
                    },
                  ],
          },
        ],
      },
      reviewSample:
        options.insufficient
          ? {
              totalScrapedReviewCount: 7,
              eligibleReviewCount: 7,
              analyzedReviewCount: 7,
              capped: false,
              source: 'batch_manifest',
            }
          : {
              totalScrapedReviewCount: 2632,
              eligibleReviewCount: 1924,
              analyzedReviewCount: 250,
              capped: true,
              source: 'batch_manifest',
            },
    },
  } as ReviewJobListing;
}

test('priorities matrix renders evidence frequencies and sample provenance honestly', () => {
  const html = renderToStaticMarkup(
    <PrioritiesMatrix
      listings={[
        listing('sleep-test'),
        listing('sparse', {
          insufficient: true,
          evidenceGaps: ['reviews'],
        }),
      ]}
    />,
  );

  assert.match(html, /Priorities matrix/);
  assert.match(html, /Availability/);
  assert.match(html, /Affordability/);
  assert.match(html, /Quiet sleep/);
  assert.match(html, /42 of 250 AI-analyzed reviews/);
  assert.match(
    html,
    /250 analysed \(capped from 1,924 eligible\) · 2,632 scraped/,
  );
  assert.match(html, /Guests repeatedly report loud HVAC cycling/);
  assert.match(
    html,
    /Insufficient evidence — visible for audit, outside peer ranking/,
  );
  assert.match(html, /No review data/);
  assert.match(html, /7 analysed · 7 scraped/);
});

test('priorities matrix preserves paid evidence after a quality brief edit', () => {
  const html = renderToStaticMarkup(
    <PrioritiesMatrix
      listings={[listing('sleep-test')]}
      regradeReasons={[
        'brief_changed',
        'classifier_policy_changed',
        'requirement_set_mismatch',
      ]}
      estimatedRegradeCostUsd={0.012}
      onRegrade={() => undefined}
    />,
  );

  assert.match(html, /Reflects previous quality brief/);
  assert.match(
    html,
    /Evidence snippets, frequencies, and years remain valid audit data/,
  );
  assert.match(html, /The priority columns reflect the previous brief/);
  assert.match(html, /older classifier policy/);
  assert.match(html, /different canonical priority set/);
  assert.match(html, /Previous brief · Comparable ranked results/);
  assert.match(html, /Regrade needed/);
  assert.match(html, /42 of 250 AI-analyzed reviews/);
  assert.match(html, /Regrade whole job/);
  assert.match(html, /Estimated triage cost: \$0\.012/);
});

test('duplicate conflicts keep their evidence in a separate unranked group', () => {
  const html = renderToStaticMarkup(
    <PrioritiesMatrix
      listings={[listing('sleep-test')]}
      duplicateConflictKeys={
        new Set(['booking:sleep-test'])
      }
    />,
  );

  assert.match(
    html,
    /Cross-platform conflict — linked offers visible for audit, outside peer ranking/,
  );
  assert.match(html, /Cross-platform conflict/);
  assert.match(
    html,
    /Guests repeatedly report loud HVAC cycling/,
  );
  assert.match(html, /42 of 250 AI-analyzed reviews/);
});
