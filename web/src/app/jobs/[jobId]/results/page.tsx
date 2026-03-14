import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';

interface Params {
  params: Promise<{ jobId: string }>;
}

export const dynamic = 'force-dynamic';

export default async function ReviewJobResultsPage({ params }: Params) {
  const { jobId } = await params;

  const job = await prisma.reviewJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      location: true,
      reportPath: true,
      analysisStatus: true,
    },
  });

  if (!job) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[#0b0908] px-4 py-6 text-white md:px-6">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
        <div className="flex items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-white/[0.04] px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">
              Results
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              {job.location || 'Review job results'}
            </h1>
            <p className="mt-1 text-sm text-stone-400">
              Reused from the existing CLI report generator for parity with the current
              review workflow.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/jobs/${job.id}`}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.08]"
            >
              Back to job
            </Link>
          </div>
        </div>

        {job.reportPath ? (
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03]">
            <iframe
              title="Review results"
              src={`/api/jobs/${job.id}/report`}
              className="h-[calc(100vh-9rem)] w-full bg-white"
            />
          </div>
        ) : (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-8 text-center text-stone-400">
            {job.analysisStatus === 'running'
              ? 'Analysis is still running. Refresh this page when the report is ready.'
              : 'No report is available for this job yet.'}
          </div>
        )}
      </div>
    </div>
  );
}
