import { Prisma } from '@prisma/client';
import {
  detectReviewJobDuplicatePairs,
  REVIEW_JOB_DUPLICATE_DETECTOR_VERSION,
  type DuplicateListingInput,
} from './reviewJobDuplicates.js';

type DuplicateSyncClient = Pick<
  Prisma.TransactionClient,
  'reviewJobListing' | 'reviewJobDuplicatePair'
>;

function pairKey(
  airbnbListingId: string,
  bookingListingId: string,
): string {
  return `${airbnbListingId}\u0000${bookingListingId}`;
}

export async function syncReviewJobDuplicatePairs(
  client: DuplicateSyncClient,
  jobId: string,
) {
  const rows = await client.reviewJobListing.findMany({
    where: { jobId },
    select: {
      id: true,
      listingId: true,
      platform: true,
      name: true,
      lat: true,
      lng: true,
      propertyType: true,
      analysis: {
        select: {
          details: true,
        },
      },
    },
  });
  const listings: DuplicateListingInput[] = rows.map((row) => ({
    listingId: row.listingId,
    platform: row.platform,
    name: row.name,
    coordinates:
      row.lat != null && row.lng != null
        ? { lat: row.lat, lng: row.lng }
        : null,
    propertyType: row.propertyType,
    details: row.analysis?.details,
  }));
  const detected = detectReviewJobDuplicatePairs(listings);
  const detectedKeys = new Set(
    detected.map((pair) =>
      pairKey(
        pair.airbnbListingId,
        pair.bookingListingId,
      )),
  );
  const existing = await client.reviewJobDuplicatePair.findMany({
    where: { jobId },
    select: {
      id: true,
      airbnbListingId: true,
      bookingListingId: true,
      detectorConfidence: true,
      decisionSource: true,
    },
  });

  for (const pair of detected) {
    await client.reviewJobDuplicatePair.upsert({
      where: {
        jobId_airbnbListingId_bookingListingId: {
          jobId,
          airbnbListingId: pair.airbnbListingId,
          bookingListingId: pair.bookingListingId,
        },
      },
      create: {
        jobId,
        airbnbListingId: pair.airbnbListingId,
        bookingListingId: pair.bookingListingId,
        detectorVersion: pair.detectorVersion,
        detectorConfidence: pair.confidence,
        decision: 'suggested',
        decisionSource: 'detector',
        distanceMeters: pair.distanceMeters,
        nameScore: pair.nameScore,
        nameSource: pair.nameSource,
        evidence:
          pair.evidence as unknown as Prisma.InputJsonValue,
      },
      update: {
        detectorVersion: pair.detectorVersion,
        detectorConfidence: pair.confidence,
        distanceMeters: pair.distanceMeters,
        nameScore: pair.nameScore,
        nameSource: pair.nameSource,
        evidence:
          pair.evidence as unknown as Prisma.InputJsonValue,
      },
    });
  }

  const staleDetectorPairIds = existing
    .filter(
      (pair) =>
        pair.decisionSource === 'detector'
        && !detectedKeys.has(pairKey(
          pair.airbnbListingId,
          pair.bookingListingId,
        )),
    )
    .map((pair) => pair.id);
  if (staleDetectorPairIds.length > 0) {
    await client.reviewJobDuplicatePair.deleteMany({
      where: {
        id: { in: staleDetectorPairIds },
      },
    });
  }
  const staleUserDetectorPairIds = existing
    .filter(
      (pair) =>
        pair.decisionSource === 'user'
        && pair.detectorConfidence != null
        && !detectedKeys.has(pairKey(
          pair.airbnbListingId,
          pair.bookingListingId,
        )),
    )
    .map((pair) => pair.id);
  if (staleUserDetectorPairIds.length > 0) {
    await client.reviewJobDuplicatePair.updateMany({
      where: {
        id: { in: staleUserDetectorPairIds },
      },
      data: {
        detectorVersion: REVIEW_JOB_DUPLICATE_DETECTOR_VERSION,
        detectorConfidence: null,
        nameScore: null,
        nameSource: null,
        evidence: {
          detectorInactive: true,
        },
      },
    });
  }

  return detected;
}

export async function syncAddedReviewJobDuplicatePairs(
  client: DuplicateSyncClient,
  jobId: string,
  addedListingRowIds: string[],
) {
  if (addedListingRowIds.length === 0) {
    return [];
  }

  const rows = await client.reviewJobListing.findMany({
    where: { jobId },
    select: {
      id: true,
      listingId: true,
      platform: true,
      name: true,
      lat: true,
      lng: true,
      propertyType: true,
      analysis: {
        select: {
          details: true,
        },
      },
    },
  });
  const addedRowIdSet = new Set(addedListingRowIds);
  const addedListingKeys = new Set(
    rows
      .filter((row) => addedRowIdSet.has(row.id))
      .map((row) => `${row.platform}:${row.listingId}`),
  );
  const listings: DuplicateListingInput[] = rows.map((row) => ({
    listingId: row.listingId,
    platform: row.platform,
    name: row.name,
    coordinates:
      row.lat != null && row.lng != null
        ? { lat: row.lat, lng: row.lng }
        : null,
    propertyType: row.propertyType,
    details: row.analysis?.details,
  }));
  const detected = detectReviewJobDuplicatePairs(listings).filter((pair) =>
    addedListingKeys.has(`airbnb:${pair.airbnbListingId}`)
    || addedListingKeys.has(`booking:${pair.bookingListingId}`));
  if (detected.length === 0) {
    return [];
  }

  const existing = await client.reviewJobDuplicatePair.findMany({
    where: { jobId },
    select: {
      airbnbListingId: true,
      bookingListingId: true,
    },
  });
  const existingKeys = new Set(
    existing.map((pair) =>
      pairKey(pair.airbnbListingId, pair.bookingListingId)),
  );
  const additions = detected.filter((pair) =>
    !existingKeys.has(pairKey(
      pair.airbnbListingId,
      pair.bookingListingId,
    )));

  if (additions.length > 0) {
    await client.reviewJobDuplicatePair.createMany({
      data: additions.map((pair) => ({
        jobId,
        airbnbListingId: pair.airbnbListingId,
        bookingListingId: pair.bookingListingId,
        detectorVersion: pair.detectorVersion,
        detectorConfidence: pair.confidence,
        decision: 'suggested' as const,
        decisionSource: 'detector' as const,
        distanceMeters: pair.distanceMeters,
        nameScore: pair.nameScore,
        nameSource: pair.nameSource,
        evidence:
          pair.evidence as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }

  return additions;
}
