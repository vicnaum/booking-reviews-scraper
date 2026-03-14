import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildSearchFilters } from '@/lib/searchJobs';
import { enqueueSearchJob } from '@/lib/search-queue';
import type { FullSearchRequest, StartSearchResponse } from '@/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let body: FullSearchRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.boundingBox) {
    return NextResponse.json(
      { error: 'Missing boundingBox' },
      { status: 400 },
    );
  }

  if (!body.platform) {
    return NextResponse.json(
      { error: 'Legacy /api/search requires a single platform' },
      { status: 400 },
    );
  }

  const job = await prisma.searchJob.create({
    data: {
      status: 'pending',
      platform: body.platform,
      location: body.location ?? null,
      boundingBox: body.boundingBox as unknown as Prisma.InputJsonValue,
      checkin: body.checkin ?? null,
      checkout: body.checkout ?? null,
      adults: body.adults ?? 2,
      currency: body.currency ?? 'USD',
      filters: buildSearchFilters(body),
      progress: 0,
    },
  });

  try {
    const queueJob = await enqueueSearchJob(job.id);
    await prisma.searchJob.update({
      where: { id: job.id },
      data: {
        bullJobId: queueJob.id != null ? String(queueJob.id) : null,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to enqueue search job';

    await prisma.searchJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        errorMessage: message,
      },
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }

  const response: StartSearchResponse = {
    jobId: job.id,
    status: 'pending',
  };

  return NextResponse.json(response);
}
