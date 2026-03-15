import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enqueueReviewJobSearch } from '@/lib/review-job-queue';
import { OWNER_KEY_COOKIE } from '@/lib/reviewJobOwner';
import { buildReviewJobData } from '@/lib/reviewJobs';
import type {
  CreateReviewJobRequest,
  CreateReviewJobResponse,
} from '@/types';

export const runtime = 'nodejs';

function withOwnerCookie(
  response: NextResponse,
  options: {
    hasExistingOwnerKey: boolean;
    ownerKey: string;
  },
) {
  if (!options.hasExistingOwnerKey) {
    response.cookies.set({
      name: OWNER_KEY_COOKIE,
      value: options.ownerKey,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 180,
    });
  }

  return response;
}

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
  const existingOwnerKey = cookieStore.get(OWNER_KEY_COOKIE)?.value ?? null;
  const ownerKey = existingOwnerKey ?? randomUUID();

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

    return withOwnerCookie(
      NextResponse.json({ error: message }, { status: 500 }),
      {
        hasExistingOwnerKey: !!existingOwnerKey,
        ownerKey,
      },
    );
  }

  const response: CreateReviewJobResponse = {
    jobId: job.id,
    status: 'pending',
  };

  return withOwnerCookie(NextResponse.json(response), {
    hasExistingOwnerKey: !!existingOwnerKey,
    ownerKey,
  });
}
