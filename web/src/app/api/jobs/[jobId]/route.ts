import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toReviewJobResponse } from '@/lib/reviewJobs';
import type { ReviewJobResponse } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;

  const job = await prisma.reviewJob.findUnique({
    where: { id: jobId },
    include: {
      listings: {
        where: { hidden: false },
        orderBy: { createdAt: 'asc' },
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

  let body: { prompt?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const job = await prisma.reviewJob.update({
    where: { id: jobId },
    data: {
      prompt: body.prompt?.trim() || null,
    },
    include: {
      listings: {
        where: { hidden: false },
        orderBy: { createdAt: 'asc' },
      },
      events: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  const response: ReviewJobResponse = toReviewJobResponse({
    job,
    listings: job.listings,
    events: job.events,
  });

  return NextResponse.json(response);
}
