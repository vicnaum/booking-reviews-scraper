'use client';

import { useEffect, useState } from 'react';
import type { ReviewJobListItem } from '@/types';

interface RecentJobsResponse {
  jobs: ReviewJobListItem[];
}

function statusClassName(status: ReviewJobListItem['status']) {
  if (status === 'completed') {
    return 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100';
  }
  if (status === 'running' || status === 'pending') {
    return 'border-amber-300/20 bg-amber-300/10 text-amber-100';
  }
  return 'border-rose-300/20 bg-rose-300/10 text-rose-100';
}

export default function RecentJobs() {
  const [jobs, setJobs] = useState<ReviewJobListItem[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/jobs/recent', { cache: 'no-store' });
        if (!res.ok) return;
        const data: RecentJobsResponse = await res.json();
        setJobs(data.jobs);
      } catch {
        // Ignore landing-page history failures for now.
      }
    })();
  }, []);

  if (jobs.length === 0) {
    return null;
  }

  return (
    <div className="mt-10 w-full max-w-4xl rounded-[28px] border border-white/10 bg-black/[0.22] p-5 text-left shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Recent jobs</p>
          <p className="mt-1 text-xs text-stone-500">
            Temporary browser history until a real dashboard and login exist.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {jobs.map((job) => (
          <a
            key={job.id}
            href={`/jobs/${job.id}`}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:bg-white/[0.06]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">
                  {job.location || 'Saved search'}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {job.searchAreaMode} area · {job.totalResults} listings
                </p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClassName(job.status)}`}>
                {job.status}
              </span>
            </div>
            <p className="mt-3 text-xs text-stone-500">
              {new Date(job.createdAt).toLocaleString()}
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}
