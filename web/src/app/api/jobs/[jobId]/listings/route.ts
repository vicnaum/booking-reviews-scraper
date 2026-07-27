import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enqueueReviewJobAnalysis } from '@/lib/review-job-queue';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import { addNewReviewJobListings } from '@/lib/reviewJobAddListings';
import { parseListingUrls } from '@cli/listing-url';

export const runtime = 'nodejs';

const MAX_URLS_PER_REQUEST = 50;

interface Params {
  params: Promise<{ jobId: string }>;
}

function duplicateMessage(count: number): string {
  return count === 1
    ? 'That listing is already in this job. Nothing was queued.'
    : `All ${count} listings are already in this job. Nothing was queued.`;
}

export async function POST(request: Request, { params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();
  if (!ownerKey) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'JSON body must be an object' },
      { status: 400 },
    );
  }

  const urls = (body as { urls?: unknown }).urls;
  if (
    !Array.isArray(urls)
    || urls.length === 0
    || !urls.every((url) => typeof url === 'string')
  ) {
    return NextResponse.json(
      { error: 'urls must be a non-empty array of strings' },
      { status: 400 },
    );
  }
  if (urls.length > MAX_URLS_PER_REQUEST) {
    return NextResponse.json(
      { error: `A maximum of ${MAX_URLS_PER_REQUEST} URLs can be added at once` },
      { status: 400 },
    );
  }

  const parsed = parseListingUrls(urls);
  if (parsed.invalid.length > 0) {
    return NextResponse.json({
      error: 'One or more listing URLs are invalid',
      invalidUrls: parsed.invalid,
    }, { status: 400 });
  }
  if (parsed.listings.length === 0) {
    return NextResponse.json(
      { error: 'No Airbnb or Booking.com listing URLs were provided' },
      { status: 400 },
    );
  }

  const job = await prisma.reviewJob.findFirst({
    where: { id: jobId, ownerKey },
    select: {
      id: true,
      status: true,
      analysisStatus: true,
      analysisCurrentPhase: true,
      analysisQueueJobId: true,
      priceRefreshStatus: true,
      priceRefreshCurrentPhase: true,
    },
  });
  if (!job) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }
  if (job.status === 'pending' || job.status === 'running') {
    return NextResponse.json(
      { error: 'Wait for the current search or analysis run to finish' },
      { status: 409 },
    );
  }
  if (
    job.analysisStatus === 'running'
    || job.analysisCurrentPhase === 'queued'
    || job.priceRefreshStatus === 'running'
    || job.priceRefreshCurrentPhase === 'queued'
  ) {
    return NextResponse.json(
      { error: 'Wait for the current analysis or price refresh to finish' },
      { status: 409 },
    );
  }

  const addition = await prisma.$transaction(async (tx) => {
    const result = await addNewReviewJobListings(
      tx,
      jobId,
      parsed.listings,
    );
    if (result.addedCount > 0) {
      await tx.reviewJob.update({
        where: { id: jobId },
        data: {
          totalResults: { increment: result.addedCount },
          analysisCurrentPhase: 'queued',
        },
      });
    }
    return result;
  });
  const duplicateCount =
    parsed.duplicateCount + addition.existingCount;

  if (addition.addedCount === 0) {
    return NextResponse.json({
      jobId,
      status: 'unchanged',
      addedCount: 0,
      duplicateCount,
      listingCount: 0,
      message: duplicateMessage(duplicateCount),
    });
  }

  let queueJob;
  try {
    queueJob = await enqueueReviewJobAnalysis(
      jobId,
      'full',
      {
        listingRowIds: addition.addedListingRowIds,
        previousAnalysisCurrentPhase: job.analysisCurrentPhase,
      },
    );
  } catch (error) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.reviewJobListing.deleteMany({
          where: {
            jobId,
            id: { in: addition.addedListingRowIds },
          },
        });
        await tx.reviewJob.update({
          where: { id: jobId },
          data: {
            totalResults: { decrement: addition.addedCount },
            analysisCurrentPhase: job.analysisCurrentPhase,
            analysisQueueJobId: job.analysisQueueJobId,
          },
        });
      });
    } catch (rollbackError) {
      console.error(
        `[review-job] failed to roll back added listings for ${jobId}`,
        rollbackError,
      );
    }

    return NextResponse.json({
      error:
        error instanceof Error
          ? error.message
          : 'Failed to queue added listings',
    }, { status: 500 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.reviewJob.update({
      where: { id: jobId },
      data: {
        analysisQueueJobId:
          queueJob.id != null ? String(queueJob.id) : null,
      },
    });
    await tx.reviewJobEvent.create({
      data: {
        jobId,
        phase: 'analysis',
        level: 'info',
        message:
          `Added ${addition.addedCount} listing`
          + `${addition.addedCount === 1 ? '' : 's'} by URL and queued targeted analysis`,
        payload: {
          addedCount: addition.addedCount,
          duplicateCount,
          listingRowIds: addition.addedListingRowIds,
          mode: 'targeted-add',
        },
      },
    });
  });

  const skipped =
    duplicateCount > 0
      ? ` ${duplicateCount} duplicate${duplicateCount === 1 ? ' was' : 's were'} already in the job.`
      : '';
  return NextResponse.json({
    jobId,
    status: 'queued',
    addedCount: addition.addedCount,
    duplicateCount,
    listingCount: addition.addedCount,
    message:
      `Queued scrape and analysis for ${addition.addedCount} newly added listing`
      + `${addition.addedCount === 1 ? '' : 's'}.${skipped}`,
  }, { status: 202 });
}
