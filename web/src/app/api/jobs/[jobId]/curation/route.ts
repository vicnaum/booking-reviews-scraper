import { NextResponse } from 'next/server';
import type { Platform } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import {
  buildAccessibleReviewJobQuery,
  toReviewJobResponseRecordForViewer,
} from '@/lib/reviewJobs';
import type { ReviewJobResponse } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ jobId: string }>;
}

interface ListingRef {
  id: string;
  platform: Platform;
}

function parseListingRefs(value: unknown): ListingRef[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter(
    (item): item is ListingRef =>
      !!item
      && typeof item === 'object'
      && typeof (item as { id?: unknown }).id === 'string'
      && (((item as { platform?: unknown }).platform === 'airbnb')
        || ((item as { platform?: unknown }).platform === 'booking')),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();

  let body: {
    likedListings?: ListingRef[] | null;
    hiddenListings?: ListingRef[] | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const likedListings = parseListingRefs(body.likedListings);
  const hiddenListings = parseListingRefs(body.hiddenListings);

  if (!likedListings || !hiddenListings) {
    return NextResponse.json(
      { error: 'likedListings and hiddenListings must be arrays of { id, platform }' },
      { status: 400 },
    );
  }

  const accessibleJob = await prisma.reviewJob.findFirst({
    where: ownerKey
      ? {
          id: jobId,
          OR: [{ ownerKey }, { isPublic: true }],
        }
      : {
          id: jobId,
          isPublic: true,
        },
    select: { id: true },
  });

  if (!accessibleJob) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  const hiddenKeys = new Set(hiddenListings.map((item) => `${item.platform}:${item.id}`));
  const effectiveLikedListings = likedListings.filter(
    (item) => !hiddenKeys.has(`${item.platform}:${item.id}`),
  );

  const job = await prisma.$transaction(async (tx) => {
    await tx.reviewJobListing.updateMany({
      where: { jobId },
      data: {
        liked: false,
        hidden: false,
      },
    });

    if (effectiveLikedListings.length > 0) {
      await tx.reviewJobListing.updateMany({
        where: {
          jobId,
          OR: effectiveLikedListings.map((item) => ({
            listingId: item.id,
            platform: item.platform,
          })),
        },
        data: {
          liked: true,
          hidden: false,
        },
      });
    }

    if (hiddenListings.length > 0) {
      await tx.reviewJobListing.updateMany({
        where: {
          jobId,
          OR: hiddenListings.map((item) => ({
            listingId: item.id,
            platform: item.platform,
          })),
        },
        data: {
          hidden: true,
          liked: false,
        },
      });
    }

    return tx.reviewJob.findFirstOrThrow(buildAccessibleReviewJobQuery(jobId, ownerKey));
  });

  const response: ReviewJobResponse = toReviewJobResponseRecordForViewer(job, ownerKey);
  return NextResponse.json(response);
}
