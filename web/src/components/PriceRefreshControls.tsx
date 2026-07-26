'use client';

import React, { useState } from 'react';
import type { ReviewJobListing, ReviewJobResponse } from '@/types';

export default function PriceRefreshControls({
  job,
  selectedListings,
  onQueued,
}: {
  job: ReviewJobResponse['job'];
  selectedListings: ReviewJobListing[];
  onQueued: () => Promise<void>;
}) {
  const [isQueueing, setIsQueueing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const running =
    job.priceRefreshStatus === 'running'
    || job.priceRefreshCurrentPhase === 'queued';
  const locked =
    !job.viewerCanEdit
    || isQueueing
    || running
    || job.status === 'pending'
    || job.status === 'running'
    || job.analysisStatus === 'running'
    || job.analysisCurrentPhase === 'queued'
    || !job.checkin
    || !job.checkout
    || !job.artifactArchiveAvailable;

  async function queueRefresh(scope: 'all' | 'selected') {
    setIsQueueing(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}/refresh-prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          listings:
            scope === 'selected'
              ? selectedListings.map((listing) => ({
                  id: listing.id,
                  platform: listing.platform,
                }))
              : undefined,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to queue price refresh');
      }
      setMessage(
        `Queued exact-stay price refresh for ${payload.listingCount} listings.`,
      );
      await onQueued();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Failed to queue price refresh',
      );
    } finally {
      setIsQueueing(false);
    }
  }

  const summary = job.priceRefreshSummary;
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Price & availability</p>
          <p className="mt-1 text-xs text-stone-500">
            Refreshes public exact-stay details only. Reviews, photos, AI, and
            quality scores are left untouched.
          </p>
        </div>
        {job.viewerCanEdit && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={locked}
              onClick={() => void queueRefresh('all')}
              className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Refresh all
            </button>
            <button
              type="button"
              disabled={locked || selectedListings.length === 0}
              onClick={() => void queueRefresh('selected')}
              className="rounded-xl border border-sky-300/20 bg-sky-300/10 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-sky-300/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Refresh selected ({selectedListings.length})
            </button>
          </div>
        )}
      </div>

      {running && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-stone-400">
            <span>{job.priceRefreshCurrentPhase ?? 'refreshing details'}</span>
            <span>{Math.round(job.priceRefreshProgress * 100)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8,#6ee7b7)] transition-all"
              style={{
                width: `${Math.max(
                  4,
                  Math.round(job.priceRefreshProgress * 100),
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-stone-500" aria-live="polite">
        {message
          ?? (summary
            ? (
                `Last refresh: ${summary.succeeded}/${summary.requested} succeeded`
                + (summary.failed > 0
                  ? `; ${summary.failed} failed with last known snapshots preserved.`
                  : '.')
              )
            : 'No price refresh has run yet.')}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-stone-600">
        One snapshot covers this job’s single date range. Create separate jobs
        for separate trip legs.
      </p>
    </section>
  );
}
