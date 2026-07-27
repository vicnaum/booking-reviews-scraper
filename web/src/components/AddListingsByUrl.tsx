'use client';

import React, { useState } from 'react';
import type { ReviewJobResponse } from '@/types';

interface AddListingsByUrlProps {
  job: Pick<
    ReviewJobResponse['job'],
    | 'id'
    | 'viewerCanEdit'
    | 'status'
    | 'analysisStatus'
    | 'analysisCurrentPhase'
    | 'priceRefreshStatus'
    | 'priceRefreshCurrentPhase'
  >;
  onQueued: () => Promise<void>;
}

function splitUrls(value: string): string[] {
  return value
    .split(/\s+/)
    .map((url) => url.trim())
    .filter(Boolean);
}

export default function AddListingsByUrl({
  job,
  onQueued,
}: AddListingsByUrlProps) {
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const urls = splitUrls(value);
  const locked =
    !job.viewerCanEdit
    || job.status === 'pending'
    || job.status === 'running'
    || job.analysisStatus === 'running'
    || job.analysisCurrentPhase === 'queued'
    || job.priceRefreshStatus === 'running'
    || job.priceRefreshCurrentPhase === 'queued';

  if (!job.viewerCanEdit) {
    return null;
  }

  async function submit() {
    if (locked || urls.length === 0) {
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}/listings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const invalidDetail =
          Array.isArray(payload?.invalidUrls)
          && payload.invalidUrls.length > 0
            ? `: ${payload.invalidUrls[0].input} (${payload.invalidUrls[0].error})`
            : '';
        throw new Error(
          `${payload?.error || 'Failed to add listings'}${invalidDetail}`,
        );
      }

      setMessage(payload?.message || 'Listing URLs processed.');
      if (payload?.status === 'queued') {
        setValue('');
        await onQueued();
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Failed to add listings',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="add-listing-urls"
            className="text-sm font-semibold text-white"
          >
            Add listings by URL
          </label>
          <p className="mt-1 text-xs text-stone-500">
            Paste Airbnb or Booking.com listing URLs. Only new listings are
            scraped and analyzed; existing results and your shortlist stay
            unchanged.
          </p>
          <textarea
            id="add-listing-urls"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={'https://www.booking.com/hotel/…\nhttps://www.airbnb.com/rooms/…'}
            rows={3}
            disabled={locked || isSubmitting}
            className="mt-3 w-full resize-y rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-stone-100 outline-none transition placeholder:text-stone-600 focus:border-[#ff6b5f]/40 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            void submit();
          }}
          disabled={locked || isSubmitting || urls.length === 0}
          className="rounded-2xl border border-[#ff6b5f]/20 bg-[#ff6b5f]/12 px-4 py-2 text-xs font-semibold text-[#ffcabf] transition hover:bg-[#ff6b5f]/18 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.03] disabled:text-stone-500"
        >
          {isSubmitting
            ? 'Adding…'
            : urls.length > 1
              ? `Add and analyze ${urls.length}`
              : 'Add and analyze'}
        </button>
      </div>
      {message && (
        <p className="mt-3 text-xs text-stone-300" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
