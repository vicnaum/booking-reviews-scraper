import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enqueueReviewJobPriceRefresh } from '@/lib/review-job-queue';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import type { Platform } from '@/types';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ jobId: string }>;
}

interface ListingRef {
  id: string;
  platform: Platform;
}

function parseListingRefs(value: unknown): ListingRef[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const refs = value.filter(
    (item): item is ListingRef =>
      !!item
      && typeof item === 'object'
      && typeof (item as ListingRef).id === 'string'
      && (
        (item as ListingRef).platform === 'airbnb'
        || (item as ListingRef).platform === 'booking'
      ),
  );
  return refs.length === value.length ? refs : null;
}

export async function POST(request: Request, { params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();
  if (!ownerKey) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (
    !parsedBody
    || typeof parsedBody !== 'object'
    || Array.isArray(parsedBody)
  ) {
    return NextResponse.json(
      { error: 'JSON body must be an object' },
      { status: 400 },
    );
  }
  const body = parsedBody as {
    scope?: 'all' | 'selected';
    listings?: unknown;
  };
  if (body.scope != null && body.scope !== 'all' && body.scope !== 'selected') {
    return NextResponse.json(
      { error: 'scope must be "all" or "selected"' },
      { status: 400 },
    );
  }
  const scope = body.scope ?? 'all';
  const listingRefs = parseListingRefs(body?.listings);
  if (!listingRefs) {
    return NextResponse.json(
      { error: 'listings must contain only { id, platform } values' },
      { status: 400 },
    );
  }

  const job = await prisma.reviewJob.findFirst({
    where: { id: jobId, ownerKey },
    include: {
      listings: {
        where: { hidden: false },
        select: {
          id: true,
          listingId: true,
          platform: true,
          selected: true,
        },
      },
    },
  });
  if (!job) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }
  if (!job.checkin || !job.checkout) {
    return NextResponse.json(
      { error: 'Exact check-in and check-out dates are required to refresh prices' },
      { status: 409 },
    );
  }
  if (!job.artifactRoot) {
    return NextResponse.json(
      { error: 'Run analysis once before refreshing its price snapshots' },
      { status: 409 },
    );
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
  ) {
    return NextResponse.json(
      { error: 'Wait for the current analysis run to finish' },
      { status: 409 },
    );
  }
  if (
    job.priceRefreshStatus === 'running'
    || job.priceRefreshCurrentPhase === 'queued'
  ) {
    return NextResponse.json(
      { error: 'A price refresh is already running for this job' },
      { status: 409 },
    );
  }

  const requestedKeys = new Set(
    listingRefs.map((item) => `${item.platform}:${item.id}`),
  );
  const targetListings =
    scope === 'all'
      ? job.listings
      : job.listings.filter((listing) =>
          listingRefs.length > 0
            ? requestedKeys.has(`${listing.platform}:${listing.listingId}`)
            : listing.selected);
  if (targetListings.length === 0) {
    return NextResponse.json(
      { error: 'No visible listings matched the requested refresh scope' },
      { status: 400 },
    );
  }

  const queueJob = await enqueueReviewJobPriceRefresh(
    jobId,
    targetListings.map((listing) => listing.id),
  );
  await prisma.reviewJob.update({
    where: { id: jobId },
    data: {
      priceRefreshStatus: 'pending',
      priceRefreshCurrentPhase: 'queued',
      priceRefreshProgress: 0,
      priceRefreshErrorMessage: null,
      priceRefreshSummary: {
        requested: targetListings.length,
        succeeded: 0,
        failed: 0,
      },
      priceRefreshQueueJobId:
        queueJob.id != null ? String(queueJob.id) : null,
    },
  });

  return NextResponse.json({
    jobId,
    status: 'queued',
    scope,
    listingCount: targetListings.length,
  }, { status: 202 });
}
