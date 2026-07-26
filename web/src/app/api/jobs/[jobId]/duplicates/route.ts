import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import {
  buildOwnedReviewJobQuery,
  toReviewJobResponseRecordForViewer,
} from '@/lib/reviewJobs';
import {
  duplicateDistanceMeters,
  REVIEW_JOB_DUPLICATE_DETECTOR_VERSION,
} from '@/lib/reviewJobDuplicates';
import type { ReviewJobResponse } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ jobId: string }>;
}

type DuplicateDecision = 'suggested' | 'confirmed' | 'dismissed';

function isDecision(value: unknown): value is DuplicateDecision {
  return (
    value === 'suggested'
    || value === 'confirmed'
    || value === 'dismissed'
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();
  if (!ownerKey) {
    return NextResponse.json(
      { error: 'Review job not found' },
      { status: 404 },
    );
  }

  let body: {
    airbnbListingId?: unknown;
    bookingListingId?: unknown;
    decision?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  if (
    typeof body.airbnbListingId !== 'string'
    || !body.airbnbListingId.trim()
    || typeof body.bookingListingId !== 'string'
    || !body.bookingListingId.trim()
    || !isDecision(body.decision)
  ) {
    return NextResponse.json(
      {
        error:
          'airbnbListingId, bookingListingId, and a valid decision are required',
      },
      { status: 400 },
    );
  }

  const airbnbListingId = body.airbnbListingId.trim();
  const bookingListingId = body.bookingListingId.trim();
  const decision = body.decision;
  const ownedJob = await prisma.reviewJob.findFirst({
    where: { id: jobId, ownerKey },
    select: { id: true },
  });
  if (!ownedJob) {
    return NextResponse.json(
      { error: 'Review job not found' },
      { status: 404 },
    );
  }

  const listings = await prisma.reviewJobListing.findMany({
    where: {
      jobId,
      OR: [
        {
          platform: 'airbnb',
          listingId: airbnbListingId,
        },
        {
          platform: 'booking',
          listingId: bookingListingId,
        },
      ],
    },
    select: {
      platform: true,
      listingId: true,
      lat: true,
      lng: true,
    },
  });
  const airbnb = listings.find(
    (listing) =>
      listing.platform === 'airbnb'
      && listing.listingId === airbnbListingId,
  );
  const booking = listings.find(
    (listing) =>
      listing.platform === 'booking'
      && listing.listingId === bookingListingId,
  );
  if (!airbnb || !booking) {
    return NextResponse.json(
      { error: 'Both listings must belong to this review job' },
      { status: 400 },
    );
  }

  const job = await prisma.$transaction(async (tx) => {
    const pairWhere = {
      jobId_airbnbListingId_bookingListingId: {
        jobId,
        airbnbListingId,
        bookingListingId,
      },
    };
    const existing = await tx.reviewJobDuplicatePair.findUnique({
      where: pairWhere,
    });

    if (decision === 'suggested') {
      if (!existing) {
        throw new Error('DUPLICATE_PAIR_NOT_FOUND');
      }
      if (existing.detectorConfidence == null) {
        await tx.reviewJobDuplicatePair.delete({
          where: pairWhere,
        });
      } else {
        await tx.reviewJobDuplicatePair.update({
          where: pairWhere,
          data: {
            decision: 'suggested',
            decisionSource: 'detector',
          },
        });
      }
    } else if (existing) {
      await tx.reviewJobDuplicatePair.update({
        where: pairWhere,
        data: {
          decision,
          decisionSource: 'user',
        },
      });
    } else if (decision === 'confirmed') {
      const distanceMeters =
        airbnb.lat != null
        && airbnb.lng != null
        && booking.lat != null
        && booking.lng != null
          ? duplicateDistanceMeters(
              { lat: airbnb.lat, lng: airbnb.lng },
              { lat: booking.lat, lng: booking.lng },
            )
          : null;
      await tx.reviewJobDuplicatePair.create({
        data: {
          jobId,
          airbnbListingId,
          bookingListingId,
          detectorVersion: REVIEW_JOB_DUPLICATE_DETECTOR_VERSION,
          detectorConfidence: null,
          decision: 'confirmed',
          decisionSource: 'user',
          distanceMeters,
          evidence: {
            manual: true,
          },
        },
      });
    } else {
      throw new Error('DUPLICATE_PAIR_NOT_FOUND');
    }

    await tx.reviewJobEvent.create({
      data: {
        jobId,
        phase: 'duplicates',
        level: 'info',
        message:
          decision === 'confirmed'
            ? 'Cross-platform listing link confirmed'
            : decision === 'dismissed'
              ? 'Cross-platform listing suggestion dismissed'
              : 'Cross-platform listing decision undone',
        payload: {
          airbnbListingId,
          bookingListingId,
          decision,
        },
      },
    });

    return tx.reviewJob.findFirstOrThrow(
      buildOwnedReviewJobQuery(jobId, ownerKey),
    );
  }).catch((error: unknown) => {
    if (
      error instanceof Error
      && error.message === 'DUPLICATE_PAIR_NOT_FOUND'
    ) {
      return null;
    }
    throw error;
  });

  if (!job) {
    return NextResponse.json(
      { error: 'Duplicate pair not found' },
      { status: 404 },
    );
  }

  const response: ReviewJobResponse =
    toReviewJobResponseRecordForViewer(job, ownerKey);
  return NextResponse.json(response);
}
