import { notFound } from 'next/navigation';
import ResultsWorkspace from '@/components/ResultsWorkspace';
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

export default async function ReviewJobResultsPage({ params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();

  const job = await prisma.reviewJob.findFirst(
    buildAccessibleReviewJobQuery(jobId, ownerKey),
  );

  if (!job) {
    notFound();
  }

  const initialData = toReviewJobResponseRecordForViewer(job, ownerKey);

  return <ResultsWorkspace initialData={initialData} />;
}
