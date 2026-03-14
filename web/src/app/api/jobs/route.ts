import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enqueueReviewJobSearch } from '@/lib/review-job-queue';
import { buildReviewJobData } from '@/lib/reviewJobs';
import type {
  CreateReviewJobRequest,
  CreateReviewJobResponse,
} from '@/types';

export const runtime = 'nodejs';

const OWNER_KEY_COOKIE = 'stayreviewr_owner';

export async function POST(request: NextRequest) {
  let body: CreateReviewJobRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.boundingBox) {
    return NextResponse.json({ error: 'Missing boundingBox' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const ownerKey = cookieStore.get(OWNER_KEY_COOKIE)?.value ?? randomUUID();

  const job = await prisma.reviewJob.create({
    data: buildReviewJobData(body, {
      ownerKey,
      mapBounds: body.mapBounds,
      mapCenter: body.mapCenter,
      mapZoom: body.mapZoom,
      searchAreaMode: body.searchAreaMode,
      poi: body.poi,
      prompt: body.prompt,
    }),
  });

  try {
    const queueJob = await enqueueReviewJobSearch(job.id);
    await prisma.reviewJob.update({
      where: { id: job.id },
      data: {
        queueJobId: queueJob.id != null ? String(queueJob.id) : null,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to enqueue review job';

    await prisma.reviewJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        errorMessage: message,
      },
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }

  const response: CreateReviewJobResponse = {
    jobId: job.id,
    status: 'pending',
  };

  const nextResponse = NextResponse.json(response);
  if (!cookieStore.get(OWNER_KEY_COOKIE)?.value) {
    nextResponse.cookies.set({
      name: OWNER_KEY_COOKIE,
      value: ownerKey,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 180,
    });
  }

  return nextResponse;
}
