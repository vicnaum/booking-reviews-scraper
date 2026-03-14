import { notFound } from 'next/navigation';
import JobWorkspace from '@/components/JobWorkspace';
import { prisma } from '@/lib/prisma';
import { toReviewJobResponse } from '@/lib/reviewJobs';

interface Params {
  params: Promise<{ jobId: string }>;
}

export const dynamic = 'force-dynamic';

export default async function ReviewJobPage({ params }: Params) {
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
    notFound();
  }

  const initialData = toReviewJobResponse({
    job,
    listings: job.listings,
    events: job.events,
  });

  return <JobWorkspace initialData={initialData} />;
}
