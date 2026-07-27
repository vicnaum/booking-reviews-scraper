import test from 'node:test';
import assert from 'node:assert/strict';
import type { SearchResult } from '../src/search/types.js';
import {
  persistIncrementalReviewJobListings,
} from '../web/src/lib/reviewJobSearchPersistence.js';

function result(
  id: string,
  platform: 'airbnb' | 'booking',
  name = `${platform} ${id}`,
): SearchResult {
  return {
    id,
    platform,
    name,
    url:
      platform === 'airbnb'
        ? `https://www.airbnb.com/rooms/${id}`
        : `https://www.booking.com/hotel/us/${id}.html`,
    rating: 4.8,
    reviewCount: 20,
    pricing: null,
    coordinates: { lat: 40.72, lng: -74 },
    propertyType: null,
    photoUrl: null,
  };
}

test('incremental persistence deduplicates pages and creates analysis rows immediately', async () => {
  const listings = new Map<string, {
    id: string;
    jobId: string;
    listingId: string;
    platform: 'airbnb' | 'booking';
    name: string;
  }>();
  const analysisListingIds = new Set<string>();
  let nextRowId = 1;

  const tx = {
    reviewJobListing: {
      async createMany(input: {
        data: Array<{
          jobId: string;
          listingId: string;
          platform: 'airbnb' | 'booking';
          name: string;
        }>;
      }) {
        let count = 0;
        for (const row of input.data) {
          const key = `${row.jobId}:${row.platform}:${row.listingId}`;
          if (listings.has(key)) continue;
          listings.set(key, {
            ...row,
            id: `row_${nextRowId++}`,
          });
          count++;
        }
        return { count };
      },
      async findMany(input: {
        where: {
          jobId: string;
          OR: Array<{
            listingId: string;
            platform: 'airbnb' | 'booking';
          }>;
        };
      }) {
        const keys = new Set(
          input.where.OR.map((key) =>
            `${input.where.jobId}:${key.platform}:${key.listingId}`),
        );
        return Array.from(listings.entries())
          .filter(([key]) => keys.has(key))
          .map(([, listing]) => ({ id: listing.id }));
      },
      async count(input: { where: { jobId: string } }) {
        return Array.from(listings.values()).filter(
          (listing) => listing.jobId === input.where.jobId,
        ).length;
      },
    },
    reviewJobListingAnalysis: {
      async createMany(input: {
        data: Array<{ jobListingId: string }>;
      }) {
        let count = 0;
        for (const row of input.data) {
          if (analysisListingIds.has(row.jobListingId)) continue;
          analysisListingIds.add(row.jobListingId);
          count++;
        }
        return { count };
      },
    },
  } as unknown as Parameters<typeof persistIncrementalReviewJobListings>[0];

  const firstTotal = await persistIncrementalReviewJobListings(tx, {
    jobId: 'job_1',
    results: [
      result('a1', 'airbnb', 'Original Airbnb card'),
      result('b1', 'booking'),
    ],
  });
  const secondTotal = await persistIncrementalReviewJobListings(tx, {
    jobId: 'job_1',
    results: [
      result('a1', 'airbnb', 'Duplicate callback card'),
      result('a2', 'airbnb'),
    ],
  });

  assert.equal(firstTotal, 2);
  assert.equal(secondTotal, 3);
  assert.equal(analysisListingIds.size, 3);
  assert.equal(
    listings.get('job_1:airbnb:a1')?.name,
    'Original Airbnb card',
  );
});
