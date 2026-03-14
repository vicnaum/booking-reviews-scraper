import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OWNER_KEY_COOKIE } from '@/lib/reviewJobOwner';
import type { ReviewJobListItem } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const ownerKey = cookieStore.get(OWNER_KEY_COOKIE)?.value;

  if (!ownerKey) {
    return NextResponse.json({ jobs: [] satisfies ReviewJobListItem[] });
  }

  const jobs = await prisma.reviewJob.findMany({
    where: { ownerKey },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true,
      location: true,
      status: true,
      currentPhase: true,
      totalResults: true,
      searchAreaMode: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const response: ReviewJobListItem[] = jobs.map((job) => ({
    id: job.id,
    location: job.location,
    status: job.status,
    currentPhase: job.currentPhase,
    totalResults: job.totalResults,
    searchAreaMode: job.searchAreaMode,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({ jobs: response });
}
