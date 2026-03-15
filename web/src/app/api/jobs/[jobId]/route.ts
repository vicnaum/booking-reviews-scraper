import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import {
  buildOwnedReviewJobQuery,
  toReviewJobResponseRecord,
} from '@/lib/reviewJobs';
import type { Platform, ReviewJobResponse } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();

  if (!ownerKey) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  const job = await prisma.reviewJob.findFirst(buildOwnedReviewJobQuery(jobId, ownerKey));

  if (!job) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  const response: ReviewJobResponse = toReviewJobResponseRecord(job);

  return NextResponse.json(response);
}

export async function PATCH(request: Request, { params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();

  if (!ownerKey) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  let body: {
    prompt?: string | null;
    selectedListings?: Array<{ id: string; platform: Platform }> | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const selectedListings = Array.isArray(body.selectedListings)
    ? body.selectedListings.filter(
        (item): item is { id: string; platform: Platform } =>
          !!item
          && typeof item === 'object'
          && typeof item.id === 'string'
          && (item.platform === 'airbnb' || item.platform === 'booking'),
      )
    : null;

  const existingJob = await prisma.reviewJob.findFirst({
    where: {
      id: jobId,
      ownerKey,
    },
    select: {
      id: true,
      analysisStatus: true,
      analysisCurrentPhase: true,
    },
  });

  if (!existingJob) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  if (
    existingJob.analysisStatus === 'running'
    || existingJob.analysisCurrentPhase === 'queued'
  ) {
    return NextResponse.json(
      { error: 'Wait for the current analysis run to finish before changing brief or selection' },
      { status: 409 },
    );
  }

  const job = await prisma.$transaction(async (tx) => {
    const updateData: Prisma.ReviewJobUpdateInput = {};
    if (Object.prototype.hasOwnProperty.call(body, 'prompt')) {
      updateData.prompt = body.prompt?.trim() || null;
    }

    if (Object.keys(updateData).length > 0) {
      await tx.reviewJob.update({
        where: { id: jobId },
        data: updateData,
      });
    }

    if (selectedListings) {
      await tx.reviewJobListing.updateMany({
        where: { jobId },
        data: { selected: false },
      });

      if (selectedListings.length > 0) {
        await tx.reviewJobListing.updateMany({
          where: {
            jobId,
            OR: selectedListings.map((item) => ({
              listingId: item.id,
              platform: item.platform,
            })),
          },
          data: { selected: true },
        });
      }
    }

    return tx.reviewJob.findFirstOrThrow(buildOwnedReviewJobQuery(jobId, ownerKey));
  });

  const response: ReviewJobResponse = toReviewJobResponseRecord(job);

  return NextResponse.json(response);
}
