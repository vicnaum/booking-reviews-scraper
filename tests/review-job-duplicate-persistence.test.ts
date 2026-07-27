import assert from 'node:assert/strict';
import test from 'node:test';
import {
  syncAddedReviewJobDuplicatePairs,
  syncReviewJobDuplicatePairs,
} from '../web/src/lib/reviewJobDuplicatePersistence.js';

test('detector resync updates evidence without overwriting user decisions', async () => {
  const upserts: Array<Record<string, any>> = [];
  const deletedIds: string[] = [];
  const clearedDetectorIds: string[] = [];
  const client = {
    reviewJobListing: {
      findMany: async () => [
        {
          listingId: 'nomo-airbnb',
          platform: 'airbnb',
          name: 'Hotel in SoHo',
          lat: 40.72,
          lng: -74,
          propertyType: 'Hotel room',
          analysis: {
            details: {
              host: {
                name: 'NoMo SoHo New York City',
              },
            },
          },
        },
        {
          listingId: 'nomo-booking',
          platform: 'booking',
          name: 'NoMo SoHo',
          lat: 40.72,
          lng: -73.99903,
          propertyType: 'Hotel',
          analysis: {
            details: {},
          },
        },
      ],
    },
    reviewJobDuplicatePair: {
      findMany: async () => [
        {
          id: 'confirmed_pair',
          airbnbListingId: 'nomo-airbnb',
          bookingListingId: 'nomo-booking',
          detectorConfidence: 'likely_same',
          decisionSource: 'user',
        },
        {
          id: 'stale_user_dismissal',
          airbnbListingId: 'old-airbnb',
          bookingListingId: 'old-booking',
          detectorConfidence: 'possible_same',
          decisionSource: 'user',
        },
        {
          id: 'stale_detector_suggestion',
          airbnbListingId: 'gone-airbnb',
          bookingListingId: 'gone-booking',
          detectorConfidence: 'possible_same',
          decisionSource: 'detector',
        },
      ],
      upsert: async (args: Record<string, any>) => {
        upserts.push(args);
        return args;
      },
      deleteMany: async (args: {
        where: { id: { in: string[] } };
      }) => {
        deletedIds.push(...args.where.id.in);
        return { count: args.where.id.in.length };
      },
      updateMany: async (args: {
        where: { id: { in: string[] } };
      }) => {
        clearedDetectorIds.push(...args.where.id.in);
        return { count: args.where.id.in.length };
      },
    },
  };

  const detected = await syncReviewJobDuplicatePairs(
    client as any,
    'job_1',
  );

  assert.equal(detected.length, 1);
  assert.equal(detected[0].confidence, 'likely_same');
  assert.equal(detected[0].nameSource, 'host');
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].create.decision, 'suggested');
  assert.equal(upserts[0].create.decisionSource, 'detector');
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      upserts[0].update,
      'decision',
    ),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      upserts[0].update,
      'decisionSource',
    ),
    false,
  );
  assert.deepEqual(deletedIds, ['stale_detector_suggestion']);
  assert.deepEqual(clearedDetectorIds, ['stale_user_dismissal']);
});

test('targeted add creates only new pairs and leaves prior decisions byte-identical', async () => {
  const existingPairs = [{
    id: 'confirmed_pair',
    airbnbListingId: 'nomo-airbnb',
    bookingListingId: 'nomo-booking',
    detectorVersion: 'existing-version',
    detectorConfidence: 'likely_same',
    decision: 'confirmed',
    decisionSource: 'user',
    evidence: { manuallyReviewed: true },
    updatedAt: '2026-07-27T00:00:00.000Z',
  }];
  const existingPairsBefore = structuredClone(existingPairs);
  const createdPairs: Array<Record<string, any>> = [];
  let updateCalls = 0;
  let deleteCalls = 0;
  const client = {
    reviewJobListing: {
      findMany: async () => [
        {
          id: 'row_airbnb',
          listingId: 'nomo-airbnb',
          platform: 'airbnb',
          name: 'Hotel in SoHo',
          lat: 40.72,
          lng: -74,
          propertyType: 'Hotel room',
          analysis: {
            details: { host: { name: 'NoMo SoHo New York City' } },
          },
        },
        {
          id: 'row_booking_existing',
          listingId: 'nomo-booking',
          platform: 'booking',
          name: 'NoMo SoHo',
          lat: 40.72,
          lng: -73.99903,
          propertyType: 'Hotel',
          analysis: { details: {} },
        },
        {
          id: 'row_booking_added',
          listingId: 'us/nomo-soho-added',
          platform: 'booking',
          name: 'NoMo SoHo New York',
          lat: 40.72001,
          lng: -73.99904,
          propertyType: 'Hotel',
          analysis: { details: {} },
        },
      ],
    },
    reviewJobDuplicatePair: {
      findMany: async () => existingPairs,
      createMany: async (args: {
        data: Array<Record<string, any>>;
      }) => {
        createdPairs.push(...args.data);
        return { count: args.data.length };
      },
      updateMany: async () => {
        updateCalls += 1;
        return { count: 0 };
      },
      deleteMany: async () => {
        deleteCalls += 1;
        return { count: 0 };
      },
    },
  };

  const additions = await syncAddedReviewJobDuplicatePairs(
    client as any,
    'job_1',
    ['row_booking_added'],
  );

  assert.equal(additions.length, 1);
  assert.equal(createdPairs.length, 1);
  assert.equal(createdPairs[0].bookingListingId, 'us/nomo-soho-added');
  assert.equal(createdPairs[0].decision, 'suggested');
  assert.equal(updateCalls, 0);
  assert.equal(deleteCalls, 0);
  assert.deepEqual(existingPairs, existingPairsBefore);
});
