import { notFound } from 'next/navigation';
import JobWorkspace from '@/components/JobWorkspace';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import { toReviewJobResponse } from '@/lib/reviewJobs';

interface Params {
  params: Promise<{ jobId: string }>;
}

export const dynamic = 'force-dynamic';

export default async function ReviewJobPage({ params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();

  if (!ownerKey) {
    notFound();
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
    notFound();
  }

  const initialData = toReviewJobResponse({
    job,
    listings: job.listings,
    events: job.events,
  });

  return <JobWorkspace initialData={initialData} />;
}
