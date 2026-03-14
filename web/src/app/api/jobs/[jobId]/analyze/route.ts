import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enqueueReviewJobAnalysis } from '@/lib/review-job-queue';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ jobId: string }>;
}

export async function POST(_request: Request, { params }: Params) {
  const { jobId } = await params;

  const job = await prisma.reviewJob.findUnique({
    where: { id: jobId },
    include: {
      listings: {
        where: { hidden: false },
        select: { id: true },
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  if (job.listings.length === 0) {
    return NextResponse.json(
      { error: 'Review job has no listings to analyze' },
      { status: 400 },
    );
  }

  if (job.status === 'pending' || (job.status === 'running' && job.currentPhase !== 'analysis')) {
    return NextResponse.json(
      { error: 'Wait for the full search to finish before starting analysis' },
      { status: 409 },
    );
  }

  if (job.analysisStatus === 'running') {
    return NextResponse.json(
      { error: 'Analysis is already running for this job' },
      { status: 409 },
    );
  }

  const queueJob = await enqueueReviewJobAnalysis(jobId);

  await prisma.reviewJob.update({
    where: { id: jobId },
    data: {
      analysisStatus: 'pending',
      analysisCurrentPhase: 'queued',
      analysisProgress: 0,
      analysisErrorMessage: null,
      analysisQueueJobId: queueJob.id != null ? String(queueJob.id) : null,
    },
  });

  return NextResponse.json({
    jobId,
    status: 'queued',
    analysisStatus: 'pending',
  });
}
