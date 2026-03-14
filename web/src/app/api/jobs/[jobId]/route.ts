import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import { toReviewJobResponse } from '@/lib/reviewJobs';
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

  const job = await prisma.reviewJob.findFirst({
    where: {
      id: jobId,
      ownerKey,
    },
    include: {
      listings: {
        where: { hidden: false },
        orderBy: { createdAt: 'asc' },
        include: {
          analysis: true,
        },
      },
      events: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  const response: ReviewJobResponse = toReviewJobResponse({
    job,
    listings: job.listings,
    events: job.events,
  });

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
    },
  });

  if (!existingJob) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  if (existingJob.analysisStatus === 'running') {
    return NextResponse.json(
      { error: 'Wait for the current analysis run to finish before changing brief or selection' },
      { status: 409 },
    );
  }

  const job = await prisma.$transaction(async (tx) => {
    await tx.reviewJob.update({
      where: { id: jobId },
      data: {
        prompt: body.prompt?.trim() || null,
      },
    });

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

    return tx.reviewJob.findFirstOrThrow({
      where: {
        id: jobId,
        ownerKey,
      },
      include: {
        listings: {
          where: { hidden: false },
          orderBy: { createdAt: 'asc' },
          include: {
            analysis: true,
          },
        },
        events: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  });

  const response: ReviewJobResponse = toReviewJobResponse({
    job,
    listings: job.listings,
    events: job.events,
  });

  return NextResponse.json(response);
}
