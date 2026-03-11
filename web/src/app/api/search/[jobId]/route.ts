import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toSearchJobState, toWebSearchResult } from '@/lib/searchJobs';
import type { SearchJobResponse } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;

  const job = await prisma.searchJob.findUnique({
    where: { id: jobId },
    include: {
      results: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: 'Search job not found' }, { status: 404 });
  }

  const response: SearchJobResponse = {
    job: toSearchJobState(job),
    results: job.results.map(toWebSearchResult),
  };

  return NextResponse.json(response);
}
