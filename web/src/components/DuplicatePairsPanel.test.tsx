import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  ReviewJobDuplicatePair,
  ReviewJobListing,
} from '@/types';
import {
  getMaterialDuplicateConflictKeys,
} from '@/lib/reviewJobDuplicatePresentation';
import DuplicatePairsPanel from './DuplicatePairsPanel.js';

function listing(
  id: string,
  platform: 'airbnb' | 'booking',
  name: string,
  tier: string,
  reviewCount: number,
  analyzedCount: number,
  scrapedCount: number,
): ReviewJobListing {
  return {
    id,
    platform,
    name,
    url: `https://example.com/${id}`,
    rating: platform === 'airbnb' ? 4.8 : 8.9,
    reviewCount,
    pricing: {
      nightly: {
        amount: platform === 'airbnb' ? 210 : 235,
        currency: 'USD',
        source: 'upstream',
      },
      total: {
        amount: platform === 'airbnb' ? 1470 : 1645,
        currency: 'USD',
        source: 'upstream',
      },
      display: null,
    },
    coordinates: { lat: 40.72, lng: -74 },
    propertyType: 'Hotel room',
    photoUrl: null,
    selected: true,
    liked: false,
    hidden: false,
    poiDistanceMeters: 500,
    staySnapshot: {
      availability: {
        status: 'yes',
        capturedAt: '2026-07-26T20:00:00.000Z',
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
      reason: 'Within budget.',
      budgetAmount: 2000,
      priceAmount: 1470,
      currency: 'USD',
      overByAmount: null,
      overByPercent: null,
    },
    analysis: {
      id: `${id}-analysis`,
      status: 'completed',
      currentPhase: 'completed',
      errorMessage: null,
      detailsStatus: 'completed',
      reviewsStatus: 'completed',
      photosStatus: 'completed',
      aiReviewsStatus: 'completed',
      aiPhotosStatus: 'completed',
      triageStatus: 'completed',
      details: null,
      aiReviews: null,
      aiPhotos: null,
      triage: {
        tier,
        fitScore: tier === 'top_pick' ? 91 : 42,
      },
      reviewCount: scrapedCount,
      reviewSample: {
        totalScrapedReviewCount: scrapedCount,
        eligibleReviewCount: scrapedCount,
        analyzedReviewCount: analyzedCount,
        capped: analyzedCount < scrapedCount,
        source: 'batch_manifest',
      },
      photoCount: 0,
      costs: {
        aiReviewsUsd: 0,
        aiPhotosUsd: 0,
        triageUsd: 0,
        totalUsd: 0,
      },
      durationMs: 100,
      startedAt: '2026-07-26T20:00:00.000Z',
      completedAt: '2026-07-26T20:00:01.000Z',
      createdAt: '2026-07-26T20:00:00.000Z',
      updatedAt: '2026-07-26T20:00:01.000Z',
    },
  } as unknown as ReviewJobListing;
}

function pair(
  confidence: 'likely_same' | 'possible_same',
): ReviewJobDuplicatePair {
  return {
    id: `pair-${confidence}`,
    airbnbListingId: 'nomo-airbnb',
    bookingListingId: 'nomo-booking',
    detectorVersion: 'cross-platform-property-v1',
    detectorConfidence: confidence,
    decision: 'suggested',
    decisionSource: 'detector',
    distanceMeters: 81.4,
    nameScore: 1,
    nameSource: 'host',
    evidence: {
      airbnbHostName: 'NoMo SoHo New York City',
    },
    createdAt: '2026-07-26T20:00:00.000Z',
    updatedAt: '2026-07-26T20:00:00.000Z',
  };
}

const listings = [
  listing(
    'nomo-airbnb',
    'airbnb',
    'Hotel in SoHo',
    'top_pick',
    24,
    20,
    24,
  ),
  listing(
    'nomo-booking',
    'booking',
    'NoMo SoHo',
    'no_go',
    2110,
    250,
    1924,
  ),
];

test('duplicate panel surfaces separate evidence and gates a likely material conflict', () => {
  const html = renderToStaticMarkup(
    <DuplicatePairsPanel
      pairs={[pair('likely_same')]}
      listings={listings}
      job={{ checkin: '2026-09-01', checkout: '2026-09-08' }}
      priceDisplay="total"
      viewerCanEdit
      onDecision={async () => undefined}
    />,
  );

  assert.match(html, /Likely same property/);
  assert.match(html, /Airbnb host name matched · 81\.4 m apart/);
  assert.match(html, /Captured Airbnb host: NoMo SoHo New York City/);
  assert.match(html, /Material verdict conflict/);
  assert.match(html, /Verdict: top pick/);
  assert.match(html, /Verdict: no go/);
  assert.match(html, /24 public reviews/);
  assert.match(html, /20 analysed · 24 scraped/);
  assert.match(html, /2,110 public reviews/);
  assert.match(html, /250 analysed · 1,924 scraped/);
  assert.match(html, /Confirm same property/);
  assert.match(html, /Not the same/);
  assert.match(html, /Link a missed pair/);
});

test('possible suggestions are explicitly inert and public views are read-only', () => {
  assert.deepEqual(
    [...getMaterialDuplicateConflictKeys(
      [pair('possible_same')],
      listings,
    )],
    [],
  );
  const html = renderToStaticMarkup(
    <DuplicatePairsPanel
      pairs={[pair('possible_same')]}
      listings={listings}
      job={{ checkin: null, checkout: null }}
      priceDisplay="perNight"
      viewerCanEdit={false}
    />,
  );

  assert.match(html, /Possible same property/);
  assert.match(html, /Suggestion only — no ranking impact unless confirmed/);
  assert.doesNotMatch(html, /Material verdict conflict/);
  assert.match(html, /Read-only/);
  assert.doesNotMatch(html, /Confirm same property/);
  assert.doesNotMatch(html, /Link a missed pair/);
});

test('likely pairs with a two-tier verdict gap leave peer ranking', () => {
  assert.deepEqual(
    [...getMaterialDuplicateConflictKeys(
      [pair('likely_same')],
      listings,
    )].sort(),
    ['airbnb:nomo-airbnb', 'booking:nomo-booking'],
  );
});

test('confirming a possible pair activates the conflict gate', () => {
  const confirmed = {
    ...pair('possible_same'),
    decision: 'confirmed' as const,
    decisionSource: 'user' as const,
  };
  assert.deepEqual(
    [...getMaterialDuplicateConflictKeys(
      [confirmed],
      listings,
    )].sort(),
    ['airbnb:nomo-airbnb', 'booking:nomo-booking'],
  );
});

test('owners can undo a dismissed suggestion while public viewers cannot see it', () => {
  const dismissed = {
    ...pair('possible_same'),
    decision: 'dismissed' as const,
    decisionSource: 'user' as const,
  };
  const ownerHtml = renderToStaticMarkup(
    <DuplicatePairsPanel
      pairs={[dismissed]}
      listings={listings}
      job={{ checkin: null, checkout: null }}
      priceDisplay="total"
      viewerCanEdit
      onDecision={async () => undefined}
    />,
  );
  const publicHtml = renderToStaticMarkup(
    <DuplicatePairsPanel
      pairs={[dismissed]}
      listings={listings}
      job={{ checkin: null, checkout: null }}
      priceDisplay="total"
      viewerCanEdit={false}
    />,
  );

  assert.match(ownerHtml, /Dismissed suggestion/);
  assert.match(ownerHtml, /Undo dismissal/);
  assert.doesNotMatch(publicHtml, /Dismissed suggestion/);
});
