import type { Prisma } from '@prisma/client';
import type { MapPoint, SearchResult } from '../types';
import { toReviewJobListingRecord } from './reviewJobs';

export async function persistIncrementalReviewJobListings(
  tx: Prisma.TransactionClient,
  input: {
    jobId: string;
    results: SearchResult[];
    poi?: MapPoint | null;
  },
): Promise<number> {
  const rows = input.results.map((result) =>
    toReviewJobListingRecord(input.jobId, result, { poi: input.poi }),
  );

  if (rows.length > 0) {
    await tx.reviewJobListing.createMany({
      data: rows,
      skipDuplicates: true,
    });

    const keys = Array.from(
      new Map(
        rows.map((row) => [
          `${row.platform}:${row.listingId}`,
          {
            platform: row.platform,
            listingId: row.listingId,
          },
        ]),
      ).values(),
    );
    const persistedListings = await tx.reviewJobListing.findMany({
      where: {
        jobId: input.jobId,
        OR: keys,
      },
      select: { id: true },
    });

    if (persistedListings.length > 0) {
      await tx.reviewJobListingAnalysis.createMany({
        data: persistedListings.map((listing) => ({
          jobListingId: listing.id,
        })),
        skipDuplicates: true,
      });
    }
  }

  return tx.reviewJobListing.count({
    where: { jobId: input.jobId },
  });
}
