import type { Prisma } from '@prisma/client';
import {
  parseListingUrl,
  type ParsedListingUrl,
} from '@cli/listing-url';

type AddListingsClient = Pick<
  Prisma.TransactionClient,
  'reviewJobListing' | 'reviewJobListingAnalysis'
>;

export interface AddNewReviewJobListingsResult {
  addedListingRowIds: string[];
  addedCount: number;
  existingCount: number;
}

function storedListingMatchKey(listing: {
  listingId: string;
  platform: 'airbnb' | 'booking';
  url: string;
}): string {
  try {
    const parsed = parseListingUrl(listing.url);
    if (parsed.platform === listing.platform) {
      return parsed.matchKey;
    }
  } catch {
    // Legacy rows can contain URLs that predate strict URL normalization.
  }

  return `${listing.platform}:${listing.listingId.toLowerCase()}`;
}

export function toAddedReviewJobListingRecord(
  jobId: string,
  listing: ParsedListingUrl,
): Prisma.ReviewJobListingCreateManyInput {
  return {
    jobId,
    listingId: listing.listingId,
    platform: listing.platform,
    name: listing.displayName,
    url: listing.normalizedUrl,
    reviewCount: 0,
  };
}

export async function addNewReviewJobListings(
  client: AddListingsClient,
  jobId: string,
  requestedListings: ParsedListingUrl[],
): Promise<AddNewReviewJobListingsResult> {
  const existingRows = await client.reviewJobListing.findMany({
    where: { jobId },
    select: {
      id: true,
      listingId: true,
      platform: true,
      url: true,
    },
  });
  const existingKeys = new Set(existingRows.map(storedListingMatchKey));
  const addedListings: ParsedListingUrl[] = [];
  let existingCount = 0;

  for (const listing of requestedListings) {
    if (existingKeys.has(listing.matchKey)) {
      existingCount += 1;
      continue;
    }

    const inserted = await client.reviewJobListing.createMany({
      data: [toAddedReviewJobListingRecord(jobId, listing)],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      existingCount += 1;
      continue;
    }

    existingKeys.add(listing.matchKey);
    addedListings.push(listing);
  }

  if (addedListings.length === 0) {
    return {
      addedListingRowIds: [],
      addedCount: 0,
      existingCount,
    };
  }

  const addedRows = await client.reviewJobListing.findMany({
    where: {
      jobId,
      OR: addedListings.map((listing) => ({
        listingId: listing.listingId,
        platform: listing.platform,
      })),
    },
    select: { id: true },
  });
  await client.reviewJobListingAnalysis.createMany({
    data: addedRows.map((listing) => ({
      jobListingId: listing.id,
    })),
    skipDuplicates: true,
  });

  return {
    addedListingRowIds: addedRows.map((listing) => listing.id),
    addedCount: addedRows.length,
    existingCount,
  };
}
