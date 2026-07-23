import React from 'react';
import type { ReviewJobState } from '@/types';

interface AiBudgetNoticeProps {
  job: Pick<
    ReviewJobState,
    | 'aiCostBudgetExceeded'
    | 'analysisCurrentPhase'
    | 'analysisErrorMessage'
    | 'analysisStatus'
  >;
  variant?: 'job' | 'results';
  className?: string;
}

function formatStatus(status: ReviewJobState['analysisStatus']): string {
  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;
}

export default function AiBudgetNotice({
  job,
  variant = 'job',
  className = '',
}: AiBudgetNoticeProps) {
  if (!job.aiCostBudgetExceeded) {
    return null;
  }

  const isResults = variant === 'results';

  return (
    <div
      className={`${className} rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100`.trim()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          {isResults
            ? 'Partial results — AI cost limit reached'
            : 'Analysis stopped at the AI cost limit'}
        </p>
        <span className="rounded-full border border-amber-200/20 bg-black/10 px-2.5 py-1 text-[11px] font-semibold">
          {formatStatus(job.analysisStatus)} · {job.analysisCurrentPhase ?? 'budget-exceeded'}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-amber-100/75">
        {job.analysisErrorMessage
          ?? (
            isResults
              ? 'The completed analysis artifacts are shown below; remaining AI calls were skipped.'
              : 'Partial results were preserved and no further AI calls were started.'
          )}
      </p>
    </div>
  );
}
