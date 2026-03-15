import { notFound } from 'next/navigation';
import JobWorkspace from '@/components/JobWorkspace';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import {
  buildAccessibleReviewJobQuery,
  toReviewJobResponseRecordForViewer,
} from '@/lib/reviewJobs';

interface Params {
  params: Promise<{ jobId: string }>;
}

export const dynamic = 'force-dynamic';

export default async function ReviewJobPage({ params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();

  const job = await prisma.reviewJob.findFirst(
    buildAccessibleReviewJobQuery(jobId, ownerKey),
  );

  if (!job) {
    notFound();
  }

  const initialData = toReviewJobResponseRecordForViewer(job, ownerKey);

  return <JobWorkspace initialData={initialData} />;
}
