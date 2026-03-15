import { notFound } from 'next/navigation';
import JobWorkspace from '@/components/JobWorkspace';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import {
  buildOwnedReviewJobQuery,
  toReviewJobResponseRecord,
} from '@/lib/reviewJobs';

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

  const job = await prisma.reviewJob.findFirst(buildOwnedReviewJobQuery(jobId, ownerKey));

  if (!job) {
    notFound();
  }

  const initialData = toReviewJobResponseRecord(job);

  return <JobWorkspace initialData={initialData} />;
}
