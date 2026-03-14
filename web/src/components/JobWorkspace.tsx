'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PriceDisplayMode,
  ReviewJobResponse,
} from '@/types';
import { resolveComparablePrice } from '@/lib/pricing';
import ResultCard from './ResultCard';

const JobMap = dynamic(() => import('./JobMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-neutral-900 text-neutral-600">
      Loading map...
    </div>
  ),
});

const JOB_POLL_INTERVAL_MS = 2500;

function statusLabel(status: ReviewJobResponse['job']['status']) {
  if (status === 'pending') return 'Pending';
  if (status === 'running') return 'Searching';
  if (status === 'completed') return 'Ready';
  if (status === 'failed') return 'Failed';
  return 'Cancelled';
}

function statusClassName(status: ReviewJobResponse['job']['status']) {
  if (status === 'completed') {
    return 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100';
  }
  if (status === 'running' || status === 'pending') {
    return 'border-amber-300/20 bg-amber-300/10 text-amber-100';
  }
  return 'border-rose-300/20 bg-rose-300/10 text-rose-100';
}

interface JobWorkspaceProps {
  initialData: ReviewJobResponse;
}

export default function JobWorkspace({ initialData }: JobWorkspaceProps) {
  const [data, setData] = useState(initialData);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [priceDisplay, setPriceDisplay] = useState<PriceDisplayMode>('total');
  const [prompt, setPrompt] = useState(initialData.job.prompt ?? '');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const refreshJob = useCallback(async () => {
    const res = await fetch(`/api/jobs/${data.job.id}`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('Failed to refresh job');
    }
    const nextData: ReviewJobResponse = await res.json();
    setData(nextData);
    setPrompt(nextData.job.prompt ?? '');
  }, [data.job.id]);

  useEffect(() => {
    if (data.job.status !== 'pending' && data.job.status !== 'running') {
      return;
    }

    const interval = setInterval(() => {
      void refreshJob().catch(() => {});
    }, JOB_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [data.job.status, refreshJob]);

  const sortedResults = useMemo(() => {
    const nextResults = [...data.results];
    nextResults.sort((a, b) => {
      const aAmount = resolveComparablePrice(a, priceDisplay, {
        checkin: data.job.checkin,
        checkout: data.job.checkout,
      })?.amount;
      const bAmount = resolveComparablePrice(b, priceDisplay, {
        checkin: data.job.checkin,
        checkout: data.job.checkout,
      })?.amount;

      if (aAmount == null && bAmount == null) return 0;
      if (aAmount == null) return 1;
      if (bAmount == null) return -1;
      return aAmount - bAmount;
    });

    return nextResults;
  }, [data.job.checkin, data.job.checkout, data.results, priceDisplay]);

  const selectedResult = useMemo(
    () =>
      selectedId != null
        ? sortedResults.find((result) => result.id === selectedId) ?? null
        : null,
    [selectedId, sortedResults],
  );

  const savePrompt = useCallback(async () => {
    setIsSavingPrompt(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/jobs/${data.job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to save prompt');
      }

      const nextData: ReviewJobResponse = await res.json();
      setData(nextData);
      setSaveMessage('Saved');
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Failed to save prompt');
    } finally {
      setIsSavingPrompt(false);
    }
  }, [data.job.id, prompt]);

  const resultCardContext = {
    priceDisplay,
    checkin: data.job.checkin,
    checkout: data.job.checkout,
    adults: data.job.adults,
    currency: data.job.currency,
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(255,107,95,0.18),transparent_48%)]" />

      <header className="relative z-10 px-4 pt-4 md:px-5">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 rounded-[28px] border border-white/10 bg-black/[0.28] px-4 py-4 shadow-[0_24px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                Review Job
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                {data.job.location || 'Saved search'}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-stone-400">
                Persistent workspace for the selected search area. This page only shows
                saved listings from the full search job.
              </p>
            </div>

            <div className="flex flex-col items-start gap-2 lg:items-end">
              <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${statusClassName(data.job.status)}`}>
                {statusLabel(data.job.status)}
              </span>
              <span className="text-xs text-stone-500">Job ID: {data.job.id}</span>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Search Context</p>
                  <p className="mt-1 text-xs text-stone-500">
                    {data.job.checkin || 'Flexible dates'} → {data.job.checkout || 'open'} · {data.job.adults} guests · {data.job.currency}
                  </p>
                </div>
                <div className="flex rounded-xl border border-white/10 bg-black/20 p-1">
                  {(['total', 'perNight'] as PriceDisplayMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setPriceDisplay(mode)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        priceDisplay === mode
                          ? 'bg-white text-neutral-950 shadow-sm'
                          : 'text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      {mode === 'perNight' ? 'Per night' : 'Total'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-400">
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                  Area mode: {data.job.searchAreaMode}
                </span>
                {data.job.poi && (
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                    POI saved
                  </span>
                )}
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                  {data.job.totalResults} listings
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                  {data.job.pagesScanned} pages scanned
                </span>
              </div>
              {(data.job.status === 'pending' || data.job.status === 'running') && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs font-medium text-stone-400">
                    <span>{data.job.currentPhase}</span>
                    <span>{Math.round(data.job.progress * 100)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#3bcf93,#88e2bc)] transition-all"
                      style={{ width: `${Math.max(4, Math.round(data.job.progress * 100))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Analysis Brief</p>
                  <p className="mt-1 text-xs text-stone-500">
                    Save preferences here now; queued analysis wiring is the next milestone.
                  </p>
                </div>
                <button
                  onClick={() => {
                    void savePrompt();
                  }}
                  disabled={isSavingPrompt}
                  className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSavingPrompt ? 'Saving…' : 'Save brief'}
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={5}
                placeholder="Describe what matters for this stay: work setup, quietness, walkability to POI, kitchen needs, deal-breakers, budget tradeoffs..."
                className="mt-3 w-full rounded-2xl border border-white/10 bg-black/[0.18] px-4 py-3 text-sm text-white outline-none transition placeholder:text-stone-500 focus:border-[#ff6b5f]/35 focus:bg-black/30"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-stone-500">
                  {saveMessage ?? 'This prompt will feed the later analysis phase.'}
                </span>
                <button
                  disabled
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-xs font-semibold text-stone-500"
                >
                  Analyze next
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex flex-1 px-4 pb-4 pt-3 md:px-5">
        <div className="mx-auto grid h-[calc(100vh-16rem)] w-full max-w-[1680px] min-h-[34rem] grid-cols-[360px_minmax(0,1fr)_320px] gap-0 overflow-hidden rounded-[30px] border border-white/10 bg-black/[0.24] shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-[linear-gradient(180deg,rgba(20,16,13,0.94),rgba(14,12,10,0.92))] p-3">
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="text-sm font-semibold text-stone-100">
                Listings
                <span className="ml-1 text-stone-500">({sortedResults.length})</span>
              </span>
              <span className="text-xs text-stone-500">
                {data.job.status === 'completed' ? 'Saved set' : 'Updating'}
              </span>
            </div>

            <div className="space-y-3">
              {sortedResults.map((result) => (
                <ResultCard
                  key={`${result.platform}:${result.id}`}
                  result={result}
                  isSelected={selectedId === result.id}
                  onClick={() => setSelectedId(selectedId === result.id ? null : result.id)}
                  context={resultCardContext}
                />
              ))}
            </div>
          </aside>

          <main className="relative flex min-h-0 items-center justify-center overflow-hidden bg-black/[0.08] p-3 md:p-5">
            <div
              className="relative aspect-square max-w-full overflow-hidden rounded-[26px] border border-white/10 bg-black/[0.18]"
              style={{ width: 'min(100%, calc(100vh - 16rem))' }}
            >
              <JobMap
                results={sortedResults}
                selectedId={selectedId}
                onSelect={setSelectedId}
                boundingBox={data.job.boundingBox}
                mapBounds={data.job.mapBounds}
                circle={data.job.circle}
                poi={data.job.poi}
                mapCenter={data.job.mapCenter}
                mapZoom={data.job.mapZoom}
                priceDisplay={priceDisplay}
                checkin={data.job.checkin}
                checkout={data.job.checkout}
              />
            </div>
          </main>

          <aside className="min-h-0 overflow-y-auto border-l border-white/10 bg-[linear-gradient(180deg,rgba(18,15,13,0.94),rgba(12,10,9,0.92))] p-4">
            <div className="mb-3">
              <p className="text-sm font-semibold text-white">Job timeline</p>
              <p className="mt-1 text-xs text-stone-500">
                Structured events already persist here; live analysis events will reuse this.
              </p>
            </div>
            <div className="space-y-3">
              {data.events.length > 0 ? (
                data.events.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                        {event.phase}
                      </span>
                      <span className="text-[11px] text-stone-500">
                        {new Date(event.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-stone-100">{event.message}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                  No events yet.
                </div>
              )}

              {selectedResult && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-sm font-semibold text-white">Selected listing</p>
                  <p className="mt-2 text-sm text-stone-300">{selectedResult.name}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    {selectedResult.platform} · {selectedResult.reviewCount} reviews
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
