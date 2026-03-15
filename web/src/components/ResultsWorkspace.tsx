'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PriceDisplayMode, ReviewJobResponse } from '@/types';
import { getPriceDisplayInfo, resolveComparablePrice } from '@/lib/pricing';
import { buildListingUrl } from '@/lib/listingLinks';
import {
  formatPoiDistance,
  getListingResultsSnapshot,
  getTierRank,
  type ParsedTheme,
} from '@/lib/results';
import {
  fetchReviewJobResponse,
  getStoredReviewJobPriceDisplay,
} from '@/lib/reviewJobClient';
import { useReviewJobPolling } from '@/hooks/useReviewJobPolling';
import ResultCard from './ResultCard';
import PlatformBadge from './PlatformBadge';

const JobMap = dynamic(() => import('./JobMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-neutral-900 text-neutral-600">
      Loading map...
    </div>
  ),
});

function listingKey(listing: Pick<ReviewJobResponse['listings'][number], 'id' | 'platform'>) {
  return `${listing.platform}:${listing.id}`;
}

function tierLabel(tier: string | null): string {
  return tier ? tier.replace(/_/g, ' ') : 'Unscored';
}

function tierClassName(tier: string | null): string {
  switch (tier) {
    case 'top_pick':
      return 'border-emerald-300/20 bg-emerald-300/12 text-emerald-100';
    case 'shortlist':
      return 'border-sky-300/20 bg-sky-300/12 text-sky-100';
    case 'consider':
      return 'border-amber-300/20 bg-amber-300/12 text-amber-100';
    case 'unlikely':
      return 'border-orange-300/20 bg-orange-300/12 text-orange-100';
    case 'no_go':
      return 'border-rose-300/20 bg-rose-300/12 text-rose-100';
    default:
      return 'border-white/10 bg-white/[0.05] text-stone-300';
  }
}

function phaseBadgeClassName(status: string) {
  switch (status) {
    case 'completed':
      return 'border-emerald-300/20 bg-emerald-300/12 text-emerald-100';
    case 'partial':
      return 'border-amber-300/20 bg-amber-300/12 text-amber-100';
    case 'failed':
      return 'border-rose-300/20 bg-rose-300/12 text-rose-100';
    case 'running':
      return 'border-sky-300/20 bg-sky-300/12 text-sky-100';
    case 'skipped':
      return 'border-white/10 bg-white/[0.04] text-stone-400';
    default:
      return 'border-white/10 bg-white/[0.04] text-stone-500';
  }
}

function DetailList({
  title,
  items,
  tone = 'neutral',
}: {
  title: string;
  items: string[];
  tone?: 'positive' | 'warning' | 'danger' | 'neutral';
}) {
  if (items.length === 0) {
    return null;
  }

  const badgeClassName =
    tone === 'positive'
      ? 'bg-emerald-300/12 text-emerald-100'
      : tone === 'warning'
        ? 'bg-amber-300/12 text-amber-100'
        : tone === 'danger'
          ? 'bg-rose-300/12 text-rose-100'
          : 'bg-white/[0.05] text-stone-200';

  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
        {title}
      </h3>
      <div className="mt-4 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={`${title}:${item}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${badgeClassName}`}
          >
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}

function ThemeSection({
  title,
  themes,
  tone = 'neutral',
}: {
  title: string;
  themes: ParsedTheme[];
  tone?: 'positive' | 'warning' | 'danger' | 'neutral';
}) {
  if (themes.length === 0) {
    return null;
  }

  const borderClassName =
    tone === 'positive'
      ? 'border-emerald-300/18'
      : tone === 'warning'
        ? 'border-amber-300/18'
        : tone === 'danger'
          ? 'border-rose-300/18'
          : 'border-white/10';

  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
        {title}
      </h3>
      <div className="mt-4 space-y-3">
        {themes.map((theme) => (
          <div
            key={`${title}:${theme.title}`}
            className={`rounded-2xl border bg-black/10 p-4 ${borderClassName}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-white">{theme.title}</p>
              {theme.frequency && (
                <span className="text-[11px] text-stone-500">{theme.frequency}</span>
              )}
              {theme.severity && (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${phaseBadgeClassName(theme.severity === 'high' ? 'failed' : theme.severity === 'medium' ? 'partial' : 'running')}`}>
                  {theme.severity}
                </span>
              )}
            </div>
            {theme.description && (
              <p className="mt-2 text-sm leading-6 text-stone-300">{theme.description}</p>
            )}
            {theme.evidence.length > 0 && (
              <div className="mt-3 space-y-1">
                {theme.evidence.slice(0, 2).map((line) => (
                  <p key={line} className="text-xs italic text-stone-500">
                    “{line}”
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

interface ResultsWorkspaceProps {
  initialData: ReviewJobResponse;
}

export default function ResultsWorkspace({ initialData }: ResultsWorkspaceProps) {
  const [data, setData] = useState(initialData);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [priceDisplay, setPriceDisplay] = useState<PriceDisplayMode>(
    getStoredReviewJobPriceDisplay(initialData.job),
  );
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  const refreshJob = useCallback(async () => {
    const nextData = await fetchReviewJobResponse(data.job.id);
    setData(nextData);
  }, [data.job.id]);
  useReviewJobPolling(data.job, refreshJob);

  const sortedResults = useMemo(() => {
    const next = [...data.listings];
    next.sort((a, b) => {
      const triageA = getListingResultsSnapshot(a).triage;
      const triageB = getListingResultsSnapshot(b).triage;

      const fitA = triageA?.fitScore ?? -1;
      const fitB = triageB?.fitScore ?? -1;
      if (fitA !== fitB) {
        return fitB - fitA;
      }

      const tierA = getTierRank(triageA?.tier ?? null);
      const tierB = getTierRank(triageB?.tier ?? null);
      if (tierA !== tierB) {
        return tierA - tierB;
      }

      const priceA = resolveComparablePrice(a, priceDisplay, {
        checkin: data.job.checkin,
        checkout: data.job.checkout,
      })?.amount;
      const priceB = resolveComparablePrice(b, priceDisplay, {
        checkin: data.job.checkin,
        checkout: data.job.checkout,
      })?.amount;

      if (priceA == null && priceB == null) {
        return a.name.localeCompare(b.name);
      }
      if (priceA == null) return 1;
      if (priceB == null) return -1;
      return priceA - priceB;
    });
    return next;
  }, [data.job.checkin, data.job.checkout, data.listings, priceDisplay]);

  useEffect(() => {
    if (sortedResults.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !sortedResults.some((result) => listingKey(result) === selectedId)) {
      setSelectedId(listingKey(sortedResults[0]));
    }
  }, [selectedId, sortedResults]);

  const selectedResult = useMemo(
    () =>
      selectedId != null
        ? sortedResults.find((result) => listingKey(result) === selectedId) ?? null
        : null,
    [selectedId, sortedResults],
  );

  const selectedSnapshot = useMemo(
    () => (selectedResult ? getListingResultsSnapshot(selectedResult) : null),
    [selectedResult],
  );

  useEffect(() => {
    setActivePhotoIndex(0);
  }, [selectedId]);

  const tierCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const listing of sortedResults) {
      const tier = getListingResultsSnapshot(listing).triage?.tier ?? 'unscored';
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
    return counts;
  }, [sortedResults]);

  const analyzedCount = useMemo(
    () =>
      sortedResults.filter((listing) => {
        const status = listing.analysis?.status;
        return status === 'completed' || status === 'partial';
      }).length,
    [sortedResults],
  );

  const averageFitScore = useMemo(() => {
    const scores = sortedResults
      .map((listing) => getListingResultsSnapshot(listing).triage?.fitScore)
      .filter((value): value is number => value != null);

    if (scores.length === 0) {
      return null;
    }

    return Math.round(
      scores.reduce((total, score) => total + score, 0) / scores.length,
    );
  }, [sortedResults]);

  const selectedPhotos = selectedSnapshot?.details?.photos ?? [];
  const activePhoto = selectedPhotos[activePhotoIndex] ?? selectedPhotos[0] ?? selectedResult?.photoUrl ?? null;
  const selectedPrice = selectedResult
    ? getPriceDisplayInfo(selectedResult, priceDisplay, {
        checkin: data.job.checkin,
        checkout: data.job.checkout,
      })
    : null;
  const selectedListingUrl = selectedResult
    ? buildListingUrl(selectedResult.url, selectedResult.platform, {
        checkin: data.job.checkin,
        checkout: data.job.checkout,
        adults: data.job.adults,
        currency: data.job.currency,
      })
    : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b0908] px-4 py-6 text-white md:px-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(255,107,95,0.18),transparent_48%)]" />

      <div className="relative mx-auto flex w-full max-w-[1760px] flex-col gap-4">
        <header className="rounded-[28px] border border-white/10 bg-black/[0.28] px-5 py-5 shadow-[0_24px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                Native Results
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                {data.job.location || 'Review job results'}
              </h1>
              <p className="mt-3 text-sm leading-6 text-stone-400">
                Persisted results for this review job. The map, listings, and analysis below
                are driven directly from saved job state instead of the legacy iframe report.
              </p>
              {data.job.prompt && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-stone-300">
                  <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Brief
                  </span>
                  {data.job.prompt}
                </div>
              )}
            </div>

            <div className="flex flex-col items-start gap-3 xl:items-end">
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/jobs/${data.job.id}`}
                  className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.08]"
                >
                  Back to job
                </Link>
                {data.job.legacyReportAvailable && (
                  <a
                    href={`/api/jobs/${data.job.id}/report`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.08]"
                  >
                    Legacy HTML export
                  </a>
                )}
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
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Listings</p>
              <p className="mt-2 text-2xl font-semibold text-white">{sortedResults.length}</p>
              <p className="mt-1 text-xs text-stone-500">{analyzedCount} with analysis data</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Average fit</p>
              <p className="mt-2 text-2xl font-semibold text-white">{averageFitScore ?? '—'}</p>
              <p className="mt-1 text-xs text-stone-500">Derived from triage scores</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Top picks</p>
              <p className="mt-2 text-2xl font-semibold text-white">{tierCounts.get('top_pick') ?? 0}</p>
              <p className="mt-1 text-xs text-stone-500">Highest-confidence matches</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Shortlist</p>
              <p className="mt-2 text-2xl font-semibold text-white">{tierCounts.get('shortlist') ?? 0}</p>
              <p className="mt-1 text-xs text-stone-500">Worth comparing closely</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">No-go</p>
              <p className="mt-2 text-2xl font-semibold text-white">{tierCounts.get('no_go') ?? 0}</p>
              <p className="mt-1 text-xs text-stone-500">Clear deal-breaker candidates</p>
            </div>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)_440px]">
          <aside className="min-h-[42rem] overflow-hidden rounded-[28px] border border-white/10 bg-black/[0.24] shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-white">Ranked listings</p>
                <p className="mt-1 text-xs text-stone-500">
                  Sorted by fit score, then tier, then price
                </p>
              </div>
            </div>
            <div className="max-h-[calc(100vh-15rem)] space-y-4 overflow-y-auto p-3">
              {sortedResults.map((listing, index) => {
                const triage = getListingResultsSnapshot(listing).triage;
                return (
                  <div key={listingKey(listing)} className="space-y-2">
                    <div className="flex items-center justify-between px-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-stone-500">#{index + 1}</span>
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${tierClassName(triage?.tier ?? null)}`}>
                          {tierLabel(triage?.tier ?? null)}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-white">{triage?.fitScore ?? '—'}</p>
                        <p className="text-[10px] text-stone-500">fit score</p>
                      </div>
                    </div>
                    <ResultCard
                      result={listing}
                      isSelected={listingKey(listing) === selectedId}
                      onClick={() => setSelectedId(listingKey(listing))}
                      context={{
                        priceDisplay,
                        checkin: data.job.checkin,
                        checkout: data.job.checkout,
                        adults: data.job.adults,
                        currency: data.job.currency,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </aside>

          <div className="space-y-4">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-black/[0.24] shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-white">Map</p>
                  <p className="mt-1 text-xs text-stone-500">
                    Saved search geometry and persisted analyzed listings
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${phaseBadgeClassName(data.job.analysisStatus)}`}>
                  {data.job.analysisStatus}
                </span>
              </div>
              <div className="p-4">
                <div className="relative aspect-square w-full overflow-hidden rounded-[24px] border border-white/10 bg-black/[0.18]">
                  <JobMap
                    results={sortedResults}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    searchAreaMode={data.job.searchAreaMode}
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
              </div>
            </div>

            {selectedSnapshot?.triage?.requirements && selectedSnapshot.triage.requirements.length > 0 && (
              <section className="rounded-[28px] border border-white/10 bg-black/[0.24] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Requirement check
                </h2>
                <div className="mt-4 space-y-3">
                  {selectedSnapshot.triage.requirements.map((requirement) => (
                    <div
                      key={requirement.requirement}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-white">{requirement.requirement}</p>
                        {requirement.status && (
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${phaseBadgeClassName(requirement.status === 'met' ? 'completed' : requirement.status === 'partial' ? 'partial' : 'failed')}`}>
                            {requirement.status}
                          </span>
                        )}
                        {requirement.confidence && (
                          <span className="text-[11px] text-stone-500">{requirement.confidence} confidence</span>
                        )}
                      </div>
                      {requirement.note && (
                        <p className="mt-2 text-sm leading-6 text-stone-300">{requirement.note}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-4">
            {selectedResult ? (
              <>
                <section className="overflow-hidden rounded-[28px] border border-white/10 bg-black/[0.24] shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                  <div className="border-b border-white/10 px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <PlatformBadge platform={selectedResult.platform} />
                        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                          {selectedResult.name}
                        </h2>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-400">
                          {selectedSnapshot?.triage?.fitScore != null && (
                            <span className="font-semibold text-white">
                              {selectedSnapshot.triage.fitScore}/100 fit
                            </span>
                          )}
                          {selectedSnapshot?.triage?.tier && (
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${tierClassName(selectedSnapshot.triage.tier)}`}>
                              {tierLabel(selectedSnapshot.triage.tier)}
                            </span>
                          )}
                          {selectedResult.rating != null && (
                            <span>{selectedResult.platform === 'airbnb' ? `★ ${selectedResult.rating}` : `${selectedResult.rating}/10`}</span>
                          )}
                          {selectedResult.reviewCount > 0 && <span>({selectedResult.reviewCount} reviews)</span>}
                          {formatPoiDistance(selectedResult.poiDistanceMeters) && (
                            <span>{formatPoiDistance(selectedResult.poiDistanceMeters)} from POI</span>
                          )}
                        </div>
                      </div>
                      <a
                        href={selectedListingUrl ?? selectedResult.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.08]"
                      >
                        Open listing
                      </a>
                    </div>
                  </div>

                  <div className="p-5">
                    {activePhoto && (
                      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/20">
                        <img
                          src={activePhoto}
                          alt={selectedResult.name}
                          className="h-[260px] w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    )}
                    {selectedPhotos.length > 1 && (
                      <div className="mt-3 grid grid-cols-5 gap-2">
                        {selectedPhotos.slice(0, 10).map((photo, index) => (
                          <button
                            type="button"
                            key={photo}
                            onClick={() => setActivePhotoIndex(index)}
                            className={`overflow-hidden rounded-xl border transition ${
                              index === activePhotoIndex
                                ? 'border-white/40'
                                : 'border-white/10 opacity-80 hover:opacity-100'
                            }`}
                          >
                            <img
                              src={photo}
                              alt={`${selectedResult.name} ${index + 1}`}
                              className="h-14 w-full object-cover"
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-stone-400">
                      {selectedResult.bedrooms != null && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                          {selectedResult.bedrooms} bedrooms
                        </span>
                      )}
                      {selectedResult.beds != null && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                          {selectedResult.beds} beds
                        </span>
                      )}
                      {selectedResult.bathrooms != null && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                          {selectedResult.bathrooms} bathrooms
                        </span>
                      )}
                      {selectedResult.maxGuests != null && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                          Up to {selectedResult.maxGuests} guests
                        </span>
                      )}
                      {selectedPrice && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-stone-200">
                          {selectedPrice.primary}
                        </span>
                      )}
                    </div>

                    {selectedSnapshot?.triage?.summary && (
                      <p className="mt-4 text-sm leading-7 text-stone-300">
                        {selectedSnapshot.triage.summary}
                      </p>
                    )}
                    {selectedSnapshot?.triage?.tierReason && (
                      <p className="mt-3 text-xs leading-6 text-stone-500">
                        {selectedSnapshot.triage.tierReason}
                      </p>
                    )}
                  </div>
                </section>

                {selectedSnapshot?.details?.description && (
                  <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                      Listing snapshot
                    </h3>
                    <p className="mt-4 text-sm leading-7 text-stone-300">
                      {selectedSnapshot.details.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-stone-400">
                      {selectedSnapshot.details.address && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                          {selectedSnapshot.details.address}
                        </span>
                      )}
                      {selectedSnapshot.details.checkIn && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                          Check-in: {selectedSnapshot.details.checkIn}
                        </span>
                      )}
                      {selectedSnapshot.details.checkOut && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                          Check-out: {selectedSnapshot.details.checkOut}
                        </span>
                      )}
                    </div>
                  </section>
                )}

                <DetailList
                  title="Highlights"
                  items={selectedSnapshot?.triage?.highlights ?? []}
                  tone="positive"
                />
                <DetailList
                  title="Concerns"
                  items={selectedSnapshot?.triage?.concerns ?? []}
                  tone="warning"
                />
                <DetailList
                  title="Deal-breakers"
                  items={selectedSnapshot?.triage?.dealBreakers ?? []}
                  tone="danger"
                />
                <DetailList
                  title="Amenities"
                  items={selectedSnapshot?.details?.amenities.slice(0, 12) ?? []}
                />

                {selectedSnapshot?.aiReviews && (
                  <>
                    {(selectedSnapshot.aiReviews.overallSentiment
                      || selectedSnapshot.aiReviews.summaryScore != null
                      || selectedSnapshot.aiReviews.trends
                      || selectedSnapshot.aiReviews.guestDemographics) && (
                      <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
                        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                          Review intelligence
                        </h3>
                        <div className="mt-4 space-y-3 text-sm leading-6 text-stone-300">
                          {selectedSnapshot.aiReviews.overallSentiment && (
                            <p>{selectedSnapshot.aiReviews.overallSentiment}</p>
                          )}
                          {selectedSnapshot.aiReviews.summaryScore != null && (
                            <p className="text-white">
                              Review score: {selectedSnapshot.aiReviews.summaryScore}/10
                              {selectedSnapshot.aiReviews.summaryJustification && (
                                <span className="ml-2 text-stone-400">
                                  {selectedSnapshot.aiReviews.summaryJustification}
                                </span>
                              )}
                            </p>
                          )}
                          {selectedSnapshot.aiReviews.trends && (
                            <p><span className="text-stone-500">Trend:</span> {selectedSnapshot.aiReviews.trends}</p>
                          )}
                          {selectedSnapshot.aiReviews.guestDemographics && (
                            <p><span className="text-stone-500">Guests:</span> {selectedSnapshot.aiReviews.guestDemographics}</p>
                          )}
                        </div>
                      </section>
                    )}
                    <ThemeSection title="Review strengths" themes={selectedSnapshot.aiReviews.strengths} tone="positive" />
                    <ThemeSection title="Review weaknesses" themes={selectedSnapshot.aiReviews.weaknesses} tone="warning" />
                    <ThemeSection title="Review red flags" themes={selectedSnapshot.aiReviews.redFlags} tone="danger" />
                  </>
                )}

                {selectedSnapshot?.aiPhotos && (
                  <>
                    <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                        Photo intelligence
                      </h3>
                      <div className="mt-4 space-y-3 text-sm leading-6 text-stone-300">
                        {selectedSnapshot.aiPhotos.overallImpression && (
                          <p>{selectedSnapshot.aiPhotos.overallImpression}</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {selectedSnapshot.aiPhotos.overallCleanliness != null && (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs">
                              Cleanliness {selectedSnapshot.aiPhotos.overallCleanliness}/10
                            </span>
                          )}
                          {selectedSnapshot.aiPhotos.overallModernity != null && (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs">
                              Modernity {selectedSnapshot.aiPhotos.overallModernity}/10
                            </span>
                          )}
                          {selectedSnapshot.aiPhotos.listingAccuracyScore != null && (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs">
                              Accuracy {selectedSnapshot.aiPhotos.listingAccuracyScore}/10
                            </span>
                          )}
                        </div>
                      </div>
                    </section>
                    <DetailList title="Photo highlights" items={selectedSnapshot.aiPhotos.highlights} tone="positive" />
                    <DetailList title="Photo concerns" items={selectedSnapshot.aiPhotos.concerns} tone="warning" />
                    <DetailList
                      title="Photo discrepancies"
                      items={selectedSnapshot.aiPhotos.listingAccuracyDiscrepancies}
                      tone="warning"
                    />
                  </>
                )}

                {selectedResult.analysis && (
                  <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                      Analysis status
                    </h3>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {[
                        ['details', selectedResult.analysis.detailsStatus],
                        ['reviews', selectedResult.analysis.reviewsStatus],
                        ['photos', selectedResult.analysis.photosStatus],
                        ['ai reviews', selectedResult.analysis.aiReviewsStatus],
                        ['ai photos', selectedResult.analysis.aiPhotosStatus],
                        ['triage', selectedResult.analysis.triageStatus],
                      ].map(([label, status]) => (
                        <span
                          key={label}
                          className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${phaseBadgeClassName(status)}`}
                        >
                          {label}: {status}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <section className="rounded-[28px] border border-white/10 bg-black/[0.24] p-8 text-center text-stone-400 shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                Select a listing to inspect its native results.
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
