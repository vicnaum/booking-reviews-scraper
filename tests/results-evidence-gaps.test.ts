import assert from 'node:assert/strict';
import test from 'node:test';
import { getListingResultsSnapshot } from '../web/src/lib/results.js';
import type { ReviewJobListing } from '../web/src/types.js';

function listingWithAnalysis(input: {
  triage: Record<string, unknown>;
  aiReviews: Record<string, unknown> | null;
  aiPhotos: Record<string, unknown> | null;
}): ReviewJobListing {
  return {
    id: 'example',
    platform: 'booking',
    name: 'Example',
    url: 'https://www.booking.com/hotel/us/example.en-gb.html',
    rating: null,
    reviewCount: 0,
    pricing: null,
    coordinates: null,
    propertyType: null,
    photoUrl: null,
    selected: true,
    liked: false,
    hidden: false,
    poiDistanceMeters: null,
    analysis: {
      triage: input.triage,
      aiReviews: input.aiReviews,
      aiPhotos: input.aiPhotos,
    },
  } as unknown as ReviewJobListing;
}

test('results parser preserves explicit triage evidence gaps', () => {
  const snapshot = getListingResultsSnapshot(
    listingWithAnalysis({
      triage: {
        tier: 'consider',
        fitScore: 55,
        evidenceGaps: ['photos', 'reviews', 'photos', 'invalid'],
      },
      aiReviews: {},
      aiPhotos: {},
    }),
  );

  assert.deepEqual(snapshot.triage?.evidenceGaps, ['reviews', 'photos']);
});

test('results parser derives legacy gaps from missing stored AI artifacts', () => {
  const snapshot = getListingResultsSnapshot(
    listingWithAnalysis({
      triage: { tier: 'shortlist', fitScore: 70 },
      aiReviews: null,
      aiPhotos: {},
    }),
  );

  assert.deepEqual(snapshot.triage?.evidenceGaps, ['reviews']);
});

test('an explicit empty gap list remains authoritative', () => {
  const snapshot = getListingResultsSnapshot(
    listingWithAnalysis({
      triage: { tier: 'shortlist', fitScore: 70, evidenceGaps: [] },
      aiReviews: null,
      aiPhotos: null,
    }),
  );

  assert.deepEqual(snapshot.triage?.evidenceGaps, []);
});
