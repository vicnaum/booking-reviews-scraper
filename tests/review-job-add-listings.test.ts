import test from 'node:test';
import assert from 'node:assert/strict';

import { parseListingUrls } from '../src/listing-url.js';
import {
  addNewReviewJobListings,
  toAddedReviewJobListingRecord,
} from '../web/src/lib/reviewJobAddListings.js';

test('added listing rows use stable URL-derived identities and placeholders', () => {
  const parsed = parseListingUrls([
    'https://www.booking.com/hotel/us/hotel-hugo.html',
  ]).listings[0];

  assert.deepEqual(
    toAddedReviewJobListingRecord('job_1', parsed),
    {
      jobId: 'job_1',
      listingId: 'us/hotel-hugo',
      platform: 'booking',
      name: 'Hotel Hugo',
      url: 'https://www.booking.com/hotel/us/hotel-hugo.en-gb.html',
      reviewCount: 0,
    },
  );
});

test('duplicate URLs are byte-preserving no-ops, including search-derived Booking rows', async () => {
  const existingRows = [{
    id: 'row_existing',
    jobId: 'job_1',
    listingId: '987654',
    platform: 'booking' as const,
    name: 'Hotel Hugo',
    url: 'https://www.booking.com/hotel/us/hotel-hugo.html',
    selected: true,
    liked: true,
    hidden: false,
    analysis: {
      status: 'completed',
      triage: { fitScore: 91 },
      totalAiCostUsd: 1.23,
    },
  }];
  const before = structuredClone(existingRows);
  let createCalls = 0;
  let analysisCreateCalls = 0;
  const client = {
    reviewJobListing: {
      findMany: async () => existingRows,
      createMany: async () => {
        createCalls += 1;
        return { count: 1 };
      },
    },
    reviewJobListingAnalysis: {
      createMany: async () => {
        analysisCreateCalls += 1;
        return { count: 1 };
      },
    },
  };

  const result = await addNewReviewJobListings(
    client as never,
    'job_1',
    parseListingUrls([
      'https://www.booking.com/hotel/us/hotel-hugo.en-gb.html?aid=123',
    ]).listings,
  );

  assert.deepEqual(result, {
    addedListingRowIds: [],
    addedCount: 0,
    existingCount: 1,
  });
  assert.equal(createCalls, 0);
  assert.equal(analysisCreateCalls, 0);
  assert.deepEqual(existingRows, before);
});

test('only genuinely new URLs create listing and analysis rows', async () => {
  const rows = [{
    id: 'row_existing',
    listingId: '123',
    platform: 'airbnb' as const,
    url: 'https://www.airbnb.com/rooms/123',
  }];
  const createdRecords: Array<Record<string, unknown>> = [];
  const analysisRecords: Array<Record<string, unknown>> = [];
  const client = {
    reviewJobListing: {
      findMany: async (args: {
        where?: { OR?: Array<{ listingId: string; platform: string }> };
      }) => {
        if (!args.where?.OR) {
          return rows;
        }
        return rows.filter((row) =>
          args.where?.OR?.some((candidate) =>
            candidate.listingId === row.listingId
            && candidate.platform === row.platform));
      },
      createMany: async (args: {
        data: Array<Record<string, unknown>>;
      }) => {
        const record = args.data[0];
        createdRecords.push(record);
        rows.push({
          id: `row_${record.listingId}`,
          listingId: String(record.listingId),
          platform: record.platform as 'airbnb',
          url: String(record.url),
        });
        return { count: 1 };
      },
    },
    reviewJobListingAnalysis: {
      createMany: async (args: {
        data: Array<Record<string, unknown>>;
      }) => {
        analysisRecords.push(...args.data);
        return { count: args.data.length };
      },
    },
  };

  const result = await addNewReviewJobListings(
    client as never,
    'job_1',
    parseListingUrls([
      'https://www.airbnb.com/rooms/123',
      'https://www.airbnb.com/rooms/456',
    ]).listings,
  );

  assert.equal(result.addedCount, 1);
  assert.equal(result.existingCount, 1);
  assert.deepEqual(result.addedListingRowIds, ['row_456']);
  assert.equal(createdRecords.length, 1);
  assert.deepEqual(analysisRecords, [{ jobListingId: 'row_456' }]);
});
