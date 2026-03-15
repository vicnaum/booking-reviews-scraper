'use client';

import Link from 'next/link';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { PriceDisplayMode, ReviewJobListing, ReviewJobResponse } from '@/types';
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
import PlatformBadge from './PlatformBadge';
import ResultsJobMap from './ResultsJobMap';

const MIN_MAP_HEIGHT = 280;
const MAX_MAP_HEIGHT = 920;
const TIER_ORDER = ['top_pick', 'shortlist', 'consider', 'unlikely', 'no_go'] as const;
const SCORE_ORDER = [
  'fit',
  'location',
  'sleepQuality',
  'cleanliness',
  'modernity',
  'valueForMoney',
] as const;

type SortKey = 'rank' | 'title' | 'tier' | 'fitScore' | 'price';
type DetailTab = 'triage' | 'reviews' | 'photos' | 'snapshot';

function listingKey(listing: Pick<ReviewJobListing, 'id' | 'platform'>) {
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

function scoreLabel(key: string) {
  switch (key) {
    case 'fit':
      return 'Fit';
    case 'location':
      return 'Location';
    case 'sleepQuality':
      return 'Sleep';
    case 'cleanliness':
      return 'Clean';
    case 'modernity':
      return 'Modern';
    case 'valueForMoney':
      return 'Value';
    default:
      return key;
  }
}

function scoreColor(value: number) {
  if (value >= 7) {
    return 'bg-emerald-400';
  }
  if (value >= 4) {
    return 'bg-amber-400';
  }
  return 'bg-rose-400';
}

function hasAmenity(amenities: string[], patterns: RegExp[]) {
  const haystack = amenities.join('|').toLowerCase();
  return patterns.some((pattern) => pattern.test(haystack));
}

function getAmenityFlags(amenities: string[]) {
  return {
    parking: hasAmenity(amenities, [/parking/, /garage/]),
    wifi: hasAmenity(amenities, [/wifi/, /wi-fi/, /internet/]),
    elevator: hasAmenity(amenities, [/elevator/, /lift/]),
    ac: hasAmenity(amenities, [/air.?condition/, /\bac\b/, /cooling/]),
    balcony: hasAmenity(amenities, [/balcon/, /terrace/, /patio/]),
  };
}

function buildExportPayload(
  listings: ReviewJobListing[],
  likedIds: Set<string>,
  hiddenIds: Set<string>,
) {
  const byKey = new Map(listings.map((listing) => [listingKey(listing), listing]));

  const serialize = (key: string) => {
    const listing = byKey.get(key);
    if (!listing) {
      return { id: key };
    }

    const snapshot = getListingResultsSnapshot(listing);

    return {
      id: listing.id,
      platform: listing.platform,
      url: listing.url,
      title: listing.name,
      fitScore: snapshot.triage?.fitScore ?? null,
      tier: snapshot.triage?.tier ?? null,
      priceTotal: snapshot.triage?.priceTotal ?? null,
      pricePerNight: snapshot.triage?.pricePerNight ?? null,
    };
  };

  return {
    liked: [...likedIds].map(serialize),
    hidden: [...hiddenIds].map(serialize),
  };
}

async function copyJson(value: unknown) {
  const text = JSON.stringify(value, null, 2);

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === 'undefined') {
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function downloadJson(filename: string, value: unknown) {
  if (typeof window === 'undefined') {
    return;
  }

  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function ActionButton({
  title,
  active = false,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm transition ${
        active
          ? 'border-rose-300/30 bg-rose-300/16 text-rose-100'
          : 'border-white/10 bg-white/[0.04] text-stone-300 hover:border-white/20 hover:bg-white/[0.08] hover:text-white'
      }`}
      aria-label={title}
      title={title}
    >
      {children}
    </button>
  );
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
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        {title}
      </h3>
      <div className="mt-3 flex flex-wrap gap-2">
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
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        {title}
      </h3>
      <div className="mt-3 space-y-3">
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
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${phaseBadgeClassName(
                    theme.severity === 'high'
                      ? 'failed'
                      : theme.severity === 'medium'
                        ? 'partial'
                        : 'running',
                  )}`}
                >
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

function MiniScoreBars({ listing }: { listing: ReviewJobListing }) {
  const snapshot = getListingResultsSnapshot(listing);
  const scoreMap = new Map(
    (snapshot.triage?.scores ?? []).map((item) => [item.key, item.value]),
  );

  return (
    <div
      className="flex gap-1"
      title={SCORE_ORDER.map((key) => `${scoreLabel(key)}: ${scoreMap.get(key) ?? '-'}`).join(', ')}
    >
      {SCORE_ORDER.map((key) => {
        const value = scoreMap.get(key) ?? 0;
        return (
          <div
            key={key}
            className="relative h-7 w-2 overflow-hidden rounded-full bg-white/10"
          >
            <div
              className={`absolute inset-x-0 bottom-0 rounded-full ${scoreColor(value)}`}
              style={{ height: `${Math.max(10, value * 10)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function RequirementDots({ listing }: { listing: ReviewJobListing }) {
  const snapshot = getListingResultsSnapshot(listing);
  const requirements = snapshot.triage?.requirements ?? [];

  if (requirements.length === 0) {
    return <span className="text-xs text-stone-500">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {requirements.map((requirement) => {
        const color =
          requirement.status === 'met'
            ? 'bg-emerald-400'
            : requirement.status === 'partial'
              ? 'bg-amber-400'
              : requirement.status === 'unmet'
                ? 'bg-rose-400'
                : 'bg-stone-500';

        return (
          <span
            key={`${listingKey(listing)}:${requirement.requirement}`}
            className={`h-2.5 w-2.5 rounded-full ${color}`}
            title={`${requirement.requirement}: ${requirement.status ?? 'unknown'}`}
          />
        );
      })}
    </div>
  );
}

function HeroCard({
  listing,
  job,
  priceDisplay,
  onJump,
}: {
  listing: ReviewJobListing;
  job: ReviewJobResponse['job'];
  priceDisplay: PriceDisplayMode;
  onJump: () => void;
}) {
  const snapshot = getListingResultsSnapshot(listing);
  const priceInfo = getPriceDisplayInfo(listing, priceDisplay, {
    checkin: job.checkin,
    checkout: job.checkout,
  });

  const metaParts = [
    priceInfo.primary,
    listing.poiDistanceMeters != null
      ? `${formatPoiDistance(listing.poiDistanceMeters) ?? ''} from POI`
      : null,
    listing.bedrooms != null || listing.beds != null
      ? `${listing.bedrooms ?? '?'}BR ${listing.beds ?? '?'} beds`
      : null,
    snapshot.triage?.bedSetup ?? null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onJump}
      className="group min-w-[280px] max-w-[320px] flex-shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] text-left transition hover:border-white/20 hover:bg-white/[0.07]"
    >
      {listing.photoUrl ? (
        <img
          src={listing.photoUrl}
          alt={listing.name}
          className="h-44 w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="h-44 w-full bg-white/5" />
      )}
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-white text-black px-2 py-1 text-xs font-bold">
            {snapshot.triage?.fitScore ?? '—'}
          </span>
          <span
            className={`rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${tierClassName(
              snapshot.triage?.tier ?? null,
            )}`}
          >
            {tierLabel(snapshot.triage?.tier ?? null)}
          </span>
        </div>

        <div>
          <div className="mb-1">
            <PlatformBadge platform={listing.platform} />
          </div>
          <p className="line-clamp-2 text-sm font-semibold text-white group-hover:text-white/90">
            {listing.name}
          </p>
          <p className="mt-1 text-xs leading-5 text-stone-400">
            {metaParts.join(' · ')}
          </p>
        </div>

        {snapshot.triage?.summary && (
          <p className="line-clamp-3 text-xs leading-5 text-stone-400">
            {snapshot.triage.summary}
          </p>
        )}

        <RequirementDots listing={listing} />
      </div>
    </button>
  );
}

function ListingDetailPanel({
  listing,
  job,
  priceDisplay,
  onLocate,
}: {
  listing: ReviewJobListing;
  job: ReviewJobResponse['job'];
  priceDisplay: PriceDisplayMode;
  onLocate: () => void;
}) {
  const snapshot = useMemo(() => getListingResultsSnapshot(listing), [listing]);
  const [activeTab, setActiveTab] = useState<DetailTab>('triage');
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  useEffect(() => {
    setActiveTab('triage');
    setActivePhotoIndex(0);
  }, [listing.id, listing.platform]);

  const photos = snapshot.details?.photos ?? [];
  const activePhoto = photos[activePhotoIndex] ?? photos[0] ?? listing.photoUrl ?? null;
  const priceInfo = getPriceDisplayInfo(listing, priceDisplay, {
    checkin: job.checkin,
    checkout: job.checkout,
  });
  const listingUrl = buildListingUrl(listing.url, listing.platform, {
    checkin: job.checkin,
    checkout: job.checkout,
    adults: job.adults,
    currency: job.currency,
  });
  const amenities = snapshot.details?.amenities ?? [];
  const amenityFlags = getAmenityFlags(amenities);
  const triage = snapshot.triage;
  const aiReviews = snapshot.aiReviews;
  const aiPhotos = snapshot.aiPhotos;
  const poiDistanceLabel = formatPoiDistance(listing.poiDistanceMeters);

  return (
    <div className="border-t border-white/10 bg-black/25 px-4 py-5 md:px-5">
      <div className="flex flex-col gap-5 xl:flex-row">
        <div className="xl:w-[540px] xl:flex-none">
          {activePhoto ? (
            <img
              src={activePhoto}
              alt={listing.name}
              className="aspect-[4/3] w-full rounded-2xl border border-white/10 bg-white/5 object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm text-stone-500">
              No photos available
            </div>
          )}
          {photos.length > 0 && (
            <>
              <p className="mt-2 text-center text-xs text-stone-500">
                {activePhotoIndex + 1} / {photos.length}
              </p>
              <div className="mt-3 grid max-h-[280px] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
                {photos.map((photo, index) => (
                  <button
                    type="button"
                    key={`${photo}:${index}`}
                    onMouseEnter={() => setActivePhotoIndex(index)}
                    onClick={() => setActivePhotoIndex(index)}
                    className={`overflow-hidden rounded-xl border transition ${
                      index === activePhotoIndex
                        ? 'border-sky-300/50'
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <img
                      src={photo}
                      alt={`${listing.name} ${index + 1}`}
                      className="aspect-[4/3] w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
            {([
              ['triage', 'Triage'],
              ['reviews', 'Reviews AI'],
              ['photos', 'Photos AI'],
              ['snapshot', 'Snapshot'],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                  activeTab === tab
                    ? 'border-sky-300 text-white'
                    : 'border-transparent text-stone-500 hover:text-stone-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'triage' && (
            <div className="space-y-4 pt-4">
              <div className="flex flex-wrap gap-2 text-xs text-stone-300">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                  {priceInfo.primary}
                  {priceInfo.secondary ? ` (${priceInfo.secondary})` : ''}
                </span>
                {listing.poiDistanceMeters != null && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    {poiDistanceLabel} from POI
                  </span>
                )}
                {listing.bedrooms != null && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    {listing.bedrooms} bedrooms
                  </span>
                )}
                {listing.beds != null && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    {listing.beds} beds
                  </span>
                )}
                {listing.bathrooms != null && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    {listing.bathrooms} baths
                  </span>
                )}
                {listing.maxGuests != null && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    {listing.maxGuests} guests
                  </span>
                )}
                {snapshot.details?.checkIn && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    Check-in {snapshot.details.checkIn}
                  </span>
                )}
                {snapshot.details?.checkOut && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    Check-out {snapshot.details.checkOut}
                  </span>
                )}
                {amenityFlags.parking && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    Parking
                  </span>
                )}
                {amenityFlags.elevator && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    Elevator
                  </span>
                )}
                {amenityFlags.balcony && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    Balcony
                  </span>
                )}
              </div>

              {triage?.bedSetup && (
                <p className="text-sm leading-6 text-stone-300">{triage.bedSetup}</p>
              )}

              {triage?.requirements && triage.requirements.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Requirements
                  </h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-xs text-stone-300">
                      <thead className="text-stone-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Need</th>
                          <th className="px-3 py-2 font-semibold">Type</th>
                          <th className="px-3 py-2 font-semibold">Status</th>
                          <th className="px-3 py-2 font-semibold">Confidence</th>
                          <th className="px-3 py-2 font-semibold">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {triage.requirements.map((requirement) => (
                          <tr key={requirement.requirement} className="border-t border-white/5">
                            <td className="px-3 py-2 text-white">{requirement.requirement}</td>
                            <td className="px-3 py-2 text-stone-400">
                              {requirement.type?.replace(/_/g, ' ') ?? '—'}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${phaseBadgeClassName(
                                  requirement.status === 'met'
                                    ? 'completed'
                                    : requirement.status === 'partial'
                                      ? 'partial'
                                      : requirement.status === 'unmet'
                                        ? 'failed'
                                        : 'pending',
                                )}`}
                              >
                                {requirement.status ?? 'unknown'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-stone-400">{requirement.confidence ?? '—'}</td>
                            <td className="px-3 py-2 text-stone-400">{requirement.note ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {triage?.scores && triage.scores.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Scores
                  </h3>
                  <div className="mt-3 space-y-2">
                    {SCORE_ORDER.map((key) => {
                      const item = triage.scores.find((score) => score.key === key);
                      if (!item) {
                        return null;
                      }
                      return (
                        <div key={key} className="flex items-center gap-3 text-xs">
                          <span className="w-24 text-right text-stone-500">{scoreLabel(key)}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full rounded-full ${scoreColor(item.value)}`}
                              style={{ width: `${item.value * 10}%` }}
                            />
                          </div>
                          <span className="w-8 font-semibold text-white">{item.value}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <DetailList title="Highlights" items={triage?.highlights ?? []} tone="positive" />
              <DetailList title="Concerns" items={triage?.concerns ?? []} tone="warning" />
              <DetailList
                title="Deal breakers"
                items={triage?.dealBreakers ?? []}
                tone="danger"
              />

              {triage?.summary && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Summary
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-stone-300">{triage.summary}</p>
                  {triage.tierReason && (
                    <p className="mt-3 text-xs leading-6 text-stone-500">{triage.tierReason}</p>
                  )}
                </section>
              )}

              {listing.analysis && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Analysis status
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      ['details', listing.analysis.detailsStatus],
                      ['reviews', listing.analysis.reviewsStatus],
                      ['photos', listing.analysis.photosStatus],
                      ['ai reviews', listing.analysis.aiReviewsStatus],
                      ['ai photos', listing.analysis.aiPhotosStatus],
                      ['triage', listing.analysis.triageStatus],
                    ].map(([label, status]) => (
                      <span
                        key={label}
                        className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${phaseBadgeClassName(status)}`}
                      >
                        {label}: {status}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === 'reviews' && (
            <div className="space-y-4 pt-4">
              {!aiReviews ? (
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-stone-400">
                  No AI review analysis available for this listing.
                </section>
              ) : (
                <>
                  {(aiReviews.overallSentiment ||
                    aiReviews.summaryScore != null ||
                    aiReviews.trends ||
                    aiReviews.guestDemographics) && (
                    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        Review intelligence
                      </h3>
                      <div className="mt-3 space-y-3 text-sm leading-6 text-stone-300">
                        {aiReviews.summaryScore != null && (
                          <p className="text-white">
                            Review score {aiReviews.summaryScore}/10
                            {aiReviews.summaryJustification && (
                              <span className="ml-2 text-stone-400">
                                {aiReviews.summaryJustification}
                              </span>
                            )}
                          </p>
                        )}
                        {aiReviews.overallSentiment && <p>{aiReviews.overallSentiment}</p>}
                        {aiReviews.trends && (
                          <p>
                            <span className="text-stone-500">Trend:</span> {aiReviews.trends}
                          </p>
                        )}
                        {aiReviews.guestDemographics && (
                          <p>
                            <span className="text-stone-500">Guests:</span>{' '}
                            {aiReviews.guestDemographics}
                          </p>
                        )}
                      </div>
                    </section>
                  )}

                  <ThemeSection
                    title="Strengths"
                    themes={aiReviews.strengths}
                    tone="positive"
                  />
                  <ThemeSection
                    title="Weaknesses"
                    themes={aiReviews.weaknesses}
                    tone="warning"
                  />
                  <ThemeSection
                    title="Red flags"
                    themes={aiReviews.redFlags}
                    tone="danger"
                  />
                  <ThemeSection
                    title="Deal breakers"
                    themes={aiReviews.dealBreakers}
                    tone="danger"
                  />
                </>
              )}
            </div>
          )}

          {activeTab === 'photos' && (
            <div className="space-y-4 pt-4">
              {!aiPhotos ? (
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-stone-400">
                  No AI photo analysis available for this listing.
                </section>
              ) : (
                <>
                  <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                      Photo intelligence
                    </h3>
                    <div className="mt-3 space-y-3 text-sm leading-6 text-stone-300">
                      {aiPhotos.overallImpression && <p>{aiPhotos.overallImpression}</p>}
                      <div className="flex flex-wrap gap-2 text-xs text-stone-200">
                        {aiPhotos.overallCleanliness != null && (
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                            Cleanliness {aiPhotos.overallCleanliness}/10
                          </span>
                        )}
                        {aiPhotos.overallModernity != null && (
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                            Modernity {aiPhotos.overallModernity}/10
                          </span>
                        )}
                        {aiPhotos.listingAccuracyScore != null && (
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                            Accuracy {aiPhotos.listingAccuracyScore}/10
                          </span>
                        )}
                      </div>
                    </div>
                  </section>

                  <DetailList
                    title="Photo highlights"
                    items={aiPhotos.highlights}
                    tone="positive"
                  />
                  <DetailList
                    title="Photo concerns"
                    items={aiPhotos.concerns}
                    tone="warning"
                  />
                  <DetailList
                    title="Discrepancies"
                    items={aiPhotos.listingAccuracyDiscrepancies}
                    tone="warning"
                  />
                </>
              )}
            </div>
          )}

          {activeTab === 'snapshot' && (
            <div className="space-y-4 pt-4">
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Listing snapshot
                </h3>
                {snapshot.details?.description ? (
                  <p className="mt-3 text-sm leading-7 text-stone-300">
                    {snapshot.details.description}
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-stone-400">
                    No detailed description was captured for this listing.
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-stone-300">
                  {snapshot.details?.address && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                      {snapshot.details.address}
                    </span>
                  )}
                  {listing.poiDistanceMeters != null && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                      POI distance: {poiDistanceLabel}
                    </span>
                  )}
                  {snapshot.details?.checkIn && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                      Check-in: {snapshot.details.checkIn}
                    </span>
                  )}
                  {snapshot.details?.checkOut && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                      Check-out: {snapshot.details.checkOut}
                    </span>
                  )}
                </div>
              </section>

              <DetailList title="Amenities" items={amenities} />

              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                      Source
                    </h3>
                    <p className="mt-2 text-sm text-stone-300">{listing.name}</p>
                    {listing.poiDistanceMeters != null && (
                      <p className="mt-1 text-xs text-stone-500">
                        {poiDistanceLabel} from POI
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onLocate}
                      className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.08]"
                    >
                      Locate on map
                    </button>
                    <a
                      href={listingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.08]"
                    >
                      Open listing ↗
                    </a>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ResultsWorkspaceProps {
  initialData: ReviewJobResponse;
}

export default function ResultsWorkspace({ initialData }: ResultsWorkspaceProps) {
  const [data, setData] = useState(initialData);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mapFocusToken, setMapFocusToken] = useState(0);
  const [priceDisplay, setPriceDisplay] = useState<PriceDisplayMode>(
    getStoredReviewJobPriceDisplay(initialData.job),
  );
  const [showHidden, setShowHidden] = useState(false);
  const [mapHeight, setMapHeight] = useState(500);
  const [activeTiers, setActiveTiers] = useState<Set<string>>(
    () => new Set(TIER_ORDER),
  );
  const [sortKey, setSortKey] = useState<SortKey>('fitScore');
  const [sortAsc, setSortAsc] = useState(false);
  const [isUpdatingSharing, setIsUpdatingSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const applyJobUpdate = useCallback((nextData: ReviewJobResponse) => {
    setData(nextData);
  }, []);

  const refreshJob = useCallback(async () => {
    const nextData = await fetchReviewJobResponse(data.job.id);
    applyJobUpdate(nextData);
  }, [applyJobUpdate, data.job.id]);

  useReviewJobPolling(data.job, refreshJob, applyJobUpdate, {
    keepSynced: true,
  });

  const viewerCanEdit = data.job.viewerCanEdit;

  const setPublicSharing = useCallback(async (nextValue: boolean) => {
    if (!viewerCanEdit) {
      return;
    }

    setIsUpdatingSharing(true);
    setShareMessage(null);

    try {
      const res = await fetch(`/api/jobs/${data.job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: nextValue }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to update public sharing');
      }

      const nextData: ReviewJobResponse = await res.json();
      applyJobUpdate(nextData);
      setShareMessage(nextValue ? 'Public link enabled' : 'Public link disabled');
    } catch (error) {
      setShareMessage(
        error instanceof Error ? error.message : 'Failed to update public sharing',
      );
    } finally {
      setIsUpdatingSharing(false);
    }
  }, [applyJobUpdate, data.job.id, viewerCanEdit]);

  const copyShareLink = useCallback(async (target: 'job' | 'results') => {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(
      target === 'results' ? `/jobs/${data.job.id}/results` : `/jobs/${data.job.id}`,
      window.location.origin,
    ).toString();

    try {
      await navigator.clipboard.writeText(url);
      setShareMessage(
        target === 'results' ? 'Copied public results link' : 'Copied public job link',
      );
    } catch {
      setShareMessage('Failed to copy link');
    }
  }, [data.job.id]);

  const likedIds = useMemo(
    () =>
      new Set(
        data.listings
          .filter((listing) => listing.liked)
          .map((listing) => listingKey(listing)),
      ),
    [data.listings],
  );

  const hiddenIds = useMemo(
    () =>
      new Set(
        data.listings
          .filter((listing) => listing.hidden)
          .map((listing) => listingKey(listing)),
      ),
    [data.listings],
  );

  const persistCuration = useCallback(async (nextLikedIds: Set<string>, nextHiddenIds: Set<string>) => {
    try {
      const likedListings = data.listings
        .filter((listing) => nextLikedIds.has(listingKey(listing)))
        .map((listing) => ({
          id: listing.id,
          platform: listing.platform,
        }));

      const hiddenListings = data.listings
        .filter((listing) => nextHiddenIds.has(listingKey(listing)))
        .map((listing) => ({
          id: listing.id,
          platform: listing.platform,
        }));

      const res = await fetch(`/api/jobs/${data.job.id}/curation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          likedListings,
          hiddenListings,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to update curation');
      }

      const nextData: ReviewJobResponse = await res.json();
      applyJobUpdate(nextData);
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : 'Failed to update curation');
    }
  }, [applyJobUpdate, data.job.id, data.listings]);

  const baseRankedResults = useMemo(() => {
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
      if (priceA == null) {
        return 1;
      }
      if (priceB == null) {
        return -1;
      }
      return priceA - priceB;
    });
    return next;
  }, [data.job.checkin, data.job.checkout, data.listings, priceDisplay]);

  const sortableResults = useMemo(() => {
    const next = [...baseRankedResults];

    if (sortKey === 'rank') {
      return sortAsc ? [...next].reverse() : next;
    }

    next.sort((a, b) => {
      if (sortKey === 'title') {
        return sortAsc
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }

      if (sortKey === 'tier') {
        const value = getTierRank(getListingResultsSnapshot(a).triage?.tier ?? null)
          - getTierRank(getListingResultsSnapshot(b).triage?.tier ?? null);
        return sortAsc ? value : -value;
      }

      if (sortKey === 'fitScore') {
        const value =
          (getListingResultsSnapshot(a).triage?.fitScore ?? -1)
          - (getListingResultsSnapshot(b).triage?.fitScore ?? -1);
        return sortAsc ? value : -value;
      }

      const priceA = resolveComparablePrice(a, priceDisplay, {
        checkin: data.job.checkin,
        checkout: data.job.checkout,
      })?.amount;
      const priceB = resolveComparablePrice(b, priceDisplay, {
        checkin: data.job.checkin,
        checkout: data.job.checkout,
      })?.amount;
      const value = (priceA ?? Number.POSITIVE_INFINITY) - (priceB ?? Number.POSITIVE_INFINITY);
      return sortAsc ? value : -value;
    });

    return next;
  }, [
    baseRankedResults,
    data.job.checkin,
    data.job.checkout,
    priceDisplay,
    sortAsc,
    sortKey,
  ]);

  const displayableResults = useMemo(
    () =>
      showHidden
        ? sortableResults
        : sortableResults.filter((listing) => !hiddenIds.has(listingKey(listing))),
    [hiddenIds, showHidden, sortableResults],
  );

  const filteredResults = useMemo(
    () =>
      displayableResults.filter((listing) => {
        const tier = getListingResultsSnapshot(listing).triage?.tier ?? 'unscored';
        return activeTiers.has(tier);
      }),
    [activeTiers, displayableResults],
  );

  const likedResults = useMemo(
    () => filteredResults.filter((listing) => likedIds.has(listingKey(listing))),
    [filteredResults, likedIds],
  );

  const mainResults = useMemo(
    () => filteredResults.filter((listing) => !likedIds.has(listingKey(listing))),
    [filteredResults, likedIds],
  );

  const heroResults = useMemo(() => {
    const topPicks = displayableResults.filter(
      (listing) => getListingResultsSnapshot(listing).triage?.tier === 'top_pick',
    );
    return topPicks.length >= 3 ? topPicks.slice(0, 5) : displayableResults.slice(0, 5);
  }, [displayableResults]);

  const tierCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const listing of displayableResults) {
      const tier = getListingResultsSnapshot(listing).triage?.tier ?? 'unscored';
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
    return counts;
  }, [displayableResults]);

  useEffect(() => {
    if (filteredResults.length === 0) {
      setSelectedId(null);
      setExpandedId(null);
      return;
    }

    if (!selectedId || !filteredResults.some((listing) => listingKey(listing) === selectedId)) {
      const nextKey = listingKey(filteredResults[0]);
      setSelectedId(nextKey);
      setExpandedId(nextKey);
    }
  }, [filteredResults, selectedId]);

  useEffect(() => {
    if (expandedId && !filteredResults.some((listing) => listingKey(listing) === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, filteredResults]);

  const handleSelect = useCallback(
    (key: string, options?: { scroll?: boolean; toggle?: boolean }) => {
      setSelectedId(key);
      setMapFocusToken((current) => current + 1);
      setExpandedId((current) => {
        if (options?.toggle && current === key) {
          return null;
        }
        return key;
      });

      if (options?.scroll) {
        window.setTimeout(() => {
          rowRefs.current[key]?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }, 60);
      }
    },
    [],
  );

  const toggleLike = useCallback((key: string) => {
    const nextLikedIds = new Set(likedIds);
    const nextHiddenIds = new Set(hiddenIds);

    if (nextLikedIds.has(key)) {
      nextLikedIds.delete(key);
    } else {
      nextLikedIds.add(key);
      nextHiddenIds.delete(key);
    }

    void persistCuration(nextLikedIds, nextHiddenIds);
  }, [hiddenIds, likedIds, persistCuration]);

  const toggleHidden = useCallback((key: string) => {
    const nextLikedIds = new Set(likedIds);
    const nextHiddenIds = new Set(hiddenIds);

    if (nextHiddenIds.has(key)) {
      nextHiddenIds.delete(key);
    } else {
      nextHiddenIds.add(key);
      nextLikedIds.delete(key);
    }

    void persistCuration(nextLikedIds, nextHiddenIds);
  }, [hiddenIds, likedIds, persistCuration]);

  const beginMapResize = useCallback(
    (direction: 1 | -1) => (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = mapHeight;

      const handleMove = (moveEvent: globalThis.MouseEvent) => {
        const delta = (moveEvent.clientY - startY) * direction;
        setMapHeight(
          Math.max(MIN_MAP_HEIGHT, Math.min(MAX_MAP_HEIGHT, startHeight + delta)),
        );
      };

      const handleUp = () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [mapHeight],
  );

  const handleSort = useCallback((nextKey: SortKey) => {
    setSortKey((current) => {
      if (current === nextKey) {
        setSortAsc((value) => !value);
        return current;
      }
      setSortAsc(false);
      return nextKey;
    });
  }, []);

  const handleSavePicks = useCallback(() => {
    downloadJson('picks.json', {
      liked: [...likedIds],
      hidden: [...hiddenIds],
    });
  }, [hiddenIds, likedIds]);

  const handleCopyList = useCallback(
    async (kind: 'liked' | 'hidden' | 'all') => {
      const payload = buildExportPayload(data.listings, likedIds, hiddenIds);
      if (kind === 'liked') {
        await copyJson({ liked: payload.liked });
        return;
      }
      if (kind === 'hidden') {
        await copyJson({ hidden: payload.hidden });
        return;
      }
      await copyJson(payload);
    },
    [data.listings, hiddenIds, likedIds],
  );

  const renderRows = useCallback(
    (rows: ReviewJobListing[]) =>
      rows.map((listing, index) => {
        const key = listingKey(listing);
        const snapshot = getListingResultsSnapshot(listing);
        const priceInfo = getPriceDisplayInfo(listing, priceDisplay, {
          checkin: data.job.checkin,
          checkout: data.job.checkout,
        });
        const listingUrl = buildListingUrl(listing.url, listing.platform, {
          checkin: data.job.checkin,
          checkout: data.job.checkout,
          adults: data.job.adults,
          currency: data.job.currency,
        });
        const amenities = snapshot.details?.amenities ?? [];
        const amenityFlags = getAmenityFlags(amenities);
        const issueCount = Math.max(
          snapshot.triage?.dealBreakers.length ?? 0,
          snapshot.aiReviews?.redFlags.length ?? 0,
        );
        const isLiked = likedIds.has(key);
        const isHidden = hiddenIds.has(key);
        const isExpanded = expandedId === key;
        const isSelected = selectedId === key;

        return (
          <Fragment key={key}>
            <tr
              ref={(node) => {
                rowRefs.current[key] = node;
              }}
              onClick={() => handleSelect(key, { toggle: true })}
              className={`cursor-pointer border-b border-white/6 transition ${
                isSelected
                  ? 'bg-sky-400/[0.08]'
                  : isLiked
                    ? 'bg-rose-400/[0.06] hover:bg-rose-400/[0.09]'
                    : 'hover:bg-white/[0.04]'
              } ${isHidden && showHidden ? 'opacity-45' : ''}`}
            >
              <td className="px-3 py-3 align-top">
                <ActionButton
                  title={isLiked ? 'Remove from liked' : 'Add to liked'}
                  active={isLiked}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleLike(key);
                  }}
                >
                  ♥
                </ActionButton>
              </td>
              <td className="px-3 py-3 align-top text-sm font-semibold text-stone-400">
                {index + 1}
              </td>
              <td className="px-3 py-3 align-top">
                {listing.photoUrl ? (
                  <img
                    src={listing.photoUrl}
                    alt={listing.name}
                    className="h-24 w-36 rounded-lg object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-24 w-36 rounded-lg bg-white/5" />
                )}
              </td>
              <td className="px-3 py-3 align-top">
                <div className="space-y-2">
                  <PlatformBadge platform={listing.platform} />
                  <div>
                    <a
                      href={listingUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="text-sm font-semibold text-white transition hover:text-[#ff9a7d]"
                    >
                      {listing.name}
                    </a>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-stone-400">
                      {listing.propertyType && <span>{listing.propertyType}</span>}
                      {listing.rating != null && (
                        <span>
                          {listing.platform === 'airbnb'
                            ? `★ ${listing.rating}`
                            : `${listing.rating}/10`}
                        </span>
                      )}
                      {listing.reviewCount > 0 && <span>({listing.reviewCount})</span>}
                    </div>
                    {listing.poiDistanceMeters != null && (
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-300">
                        <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2.5 py-1 text-sky-100">
                          POI {formatPoiDistance(listing.poiDistanceMeters)} away
                        </span>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-stone-500">
                      {listing.poiDistanceMeters != null && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSelect(key, { scroll: false });
                          }}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-semibold text-stone-300 transition hover:bg-white/[0.08] hover:text-white"
                        >
                          Locate on map
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 align-top">
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${tierClassName(
                    snapshot.triage?.tier ?? null,
                  )}`}
                >
                  {tierLabel(snapshot.triage?.tier ?? null)}
                </span>
              </td>
              <td className="px-3 py-3 align-top text-sm font-semibold text-white">
                {snapshot.triage?.fitScore ?? '—'}
              </td>
              <td className="px-3 py-3 align-top">
                <div className="text-sm font-semibold text-white">{priceInfo.primary}</div>
                {priceInfo.secondary && (
                  <div className="mt-1 text-xs text-stone-500">{priceInfo.secondary}</div>
                )}
                {listing.poiDistanceMeters != null && (
                  <div className="mt-2 text-xs text-stone-400">
                    {formatPoiDistance(listing.poiDistanceMeters)} from POI
                  </div>
                )}
              </td>
              <td className="px-3 py-3 align-top">
                <div className="space-y-2 text-xs text-stone-400">
                  <div className="flex flex-wrap gap-2">
                    {listing.bedrooms != null && <span>{listing.bedrooms}bd</span>}
                    {listing.beds != null && <span>{listing.beds}bed</span>}
                    {listing.bathrooms != null && <span>{listing.bathrooms}ba</span>}
                    {listing.maxGuests != null && <span>{listing.maxGuests}g</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      ['P', amenityFlags.parking],
                      ['W', amenityFlags.wifi],
                      ['E', amenityFlags.elevator],
                      ['AC', amenityFlags.ac],
                      ['B', amenityFlags.balcony],
                    ].map(([label, enabled]) => (
                      <span
                        key={`${key}:${label}`}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          enabled
                            ? 'border-white/15 bg-white/[0.08] text-white'
                            : 'border-white/5 bg-white/[0.02] text-stone-600'
                        }`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 align-top">
                <MiniScoreBars listing={listing} />
              </td>
              <td className="px-3 py-3 align-top">
                <RequirementDots listing={listing} />
              </td>
              <td className="px-3 py-3 align-top">
                {issueCount > 0 ? (
                  <span className="inline-flex rounded-full bg-rose-500 px-2.5 py-1 text-xs font-bold text-white">
                    {issueCount}
                  </span>
                ) : (
                  <span className="text-xs text-stone-500">0</span>
                )}
              </td>
              <td className="px-3 py-3 align-top">
                <ActionButton
                  title={isHidden ? 'Restore listing' : 'Hide listing'}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleHidden(key);
                  }}
                >
                  {isHidden ? '↺' : '×'}
                </ActionButton>
              </td>
            </tr>

            {isExpanded && (
              <tr className="border-b border-white/10">
                <td colSpan={12} className="p-0">
                  <ListingDetailPanel
                    listing={listing}
                    job={data.job}
                    priceDisplay={priceDisplay}
                    onLocate={() => handleSelect(key, { scroll: false })}
                  />
                </td>
              </tr>
            )}
          </Fragment>
        );
      }),
    [
      data.job,
      expandedId,
      handleSelect,
      hiddenIds,
      likedIds,
      priceDisplay,
      selectedId,
      showHidden,
      toggleHidden,
      toggleLike,
    ],
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b0908] px-4 py-6 text-white md:px-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(255,107,95,0.18),transparent_48%)]" />

      <div className="relative mx-auto flex w-full max-w-[1760px] flex-col gap-4">
        <header className="rounded-[28px] border border-white/10 bg-black/[0.28] px-5 py-5 shadow-[0_24px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                Native results
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                {data.job.location || 'Review job results'}
              </h1>
              <p className="mt-3 text-sm leading-6 text-stone-400">
                Persisted results driven from saved job state, reshaped to match the legacy
                HTML report flow.
              </p>
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
                    type="button"
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

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Sharing</p>
                <p className="mt-1 text-xs text-stone-500">
                  Public sharing exposes this job and its results without the owner cookie,
                  but keeps editing and analysis owner-only.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    data.job.isPublic
                      ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100'
                      : 'border-white/10 bg-white/[0.04] text-stone-400'
                  }`}
                >
                  {data.job.isPublic ? 'Public link enabled' : 'Private'}
                </span>
                {viewerCanEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      void setPublicSharing(!data.job.isPublic);
                    }}
                    disabled={isUpdatingSharing}
                    className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isUpdatingSharing
                      ? 'Updating…'
                      : data.job.isPublic
                        ? 'Disable public link'
                        : 'Enable public link'}
                  </button>
                )}
                {data.job.isPublic && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void copyShareLink('job');
                      }}
                      className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/[0.1]"
                    >
                      Copy job link
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void copyShareLink('results');
                      }}
                      className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/[0.1]"
                    >
                      Copy results link
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-stone-500">
              {shareMessage
                ?? (
                  viewerCanEdit
                    ? 'Share links stay stable, so previously analyzed results remain available after you enable public access.'
                    : data.job.isPublic
                      ? 'This is a public, read-only results view.'
                      : 'This results page is private to the owner.'
                )}
            </p>
          </div>

          {data.job.prompt && (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm leading-7 text-stone-300">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Brief
              </p>
              {data.job.prompt}
            </div>
          )}
        </header>

        {heroResults.length > 0 && (
          <section className="rounded-[28px] border border-white/10 bg-black/[0.24] px-5 py-5 shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
            <h2 className="text-lg font-semibold text-white">Top picks</h2>
            <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
              {heroResults.map((listing) => (
                <HeroCard
                  key={`hero:${listingKey(listing)}`}
                  listing={listing}
                  job={data.job}
                  priceDisplay={priceDisplay}
                  onJump={() => handleSelect(listingKey(listing), { scroll: true })}
                />
              ))}
            </div>
          </section>
        )}

        <section className="sticky top-4 z-20 rounded-[24px] border border-white/10 bg-[#0f0c0b]/90 px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.25)] backdrop-blur-xl">
          <div className="flex flex-wrap gap-2">
            {TIER_ORDER.map((tier) => {
              const active = activeTiers.has(tier);
              return (
                <button
                  key={tier}
                  type="button"
                  onClick={() =>
                    setActiveTiers((current) => {
                      const next = new Set(current);
                      if (next.has(tier)) {
                        next.delete(tier);
                      } else {
                        next.add(tier);
                      }
                      return next;
                    })
                  }
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    active
                      ? 'border-white/30 bg-white text-black'
                      : 'border-white/10 bg-white/[0.04] text-stone-300 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      tier === 'top_pick'
                        ? 'bg-emerald-400'
                        : tier === 'shortlist'
                          ? 'bg-sky-400'
                          : tier === 'consider'
                            ? 'bg-amber-400'
                            : tier === 'unlikely'
                              ? 'bg-orange-400'
                              : 'bg-rose-400'
                    }`}
                  />
                  {tier.replace(/_/g, ' ')}
                  <span className="text-[11px] opacity-70">{tierCounts.get(tier) ?? 0}</span>
                </button>
              );
            })}
          </div>
        </section>

        {likedResults.length > 0 && (
          <section className="rounded-[28px] border border-rose-300/20 bg-rose-300/[0.06] shadow-[0_28px_90px_rgba(0,0,0,0.28)] backdrop-blur-xl">
            <div className="border-b border-rose-300/15 px-5 py-4">
              <h2 className="text-lg font-semibold text-rose-100">♥ Liked</h2>
            </div>
            <div className="overflow-x-auto px-5 py-4">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.16em] text-stone-500">
                    <th className="w-12 px-3 py-3" />
                    <th className="w-12 px-3 py-3">#</th>
                    <th className="px-3 py-3">Photo</th>
                    <th className="px-3 py-3">Title</th>
                    <th className="px-3 py-3">Tier</th>
                    <th className="px-3 py-3">Score</th>
                    <th className="px-3 py-3">Total</th>
                    <th className="px-3 py-3">Info</th>
                    <th className="px-3 py-3">Scores</th>
                    <th className="px-3 py-3">Requirements</th>
                    <th className="px-3 py-3">Issues</th>
                    <th className="w-12 px-3 py-3" />
                  </tr>
                </thead>
                <tbody>{renderRows(likedResults)}</tbody>
              </table>
            </div>
          </section>
        )}

        <section className="rounded-[28px] border border-white/10 bg-black/[0.24] shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <div className="flex items-center justify-between px-5 pt-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Map</h2>
              <p className="mt-1 text-xs text-stone-500">
                Saved search geometry and persisted analyzed listings
              </p>
            </div>
            <span
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${phaseBadgeClassName(data.job.analysisStatus)}`}
            >
              {data.job.analysisStatus}
            </span>
          </div>

          <div className="px-5 pb-5 pt-4">
            <button
              type="button"
              onMouseDown={beginMapResize(-1)}
              className="flex h-4 w-full items-center justify-center rounded-t-xl border border-white/10 bg-white/[0.03] text-xs text-stone-500 transition hover:bg-white/[0.06]"
              title="Drag to resize map"
            >
              ⋯
            </button>
            <div
              className="relative w-full overflow-hidden border-x border-white/10 bg-black/[0.18]"
              style={{ height: mapHeight }}
            >
              <ResultsJobMap
                results={filteredResults}
                selectedId={selectedId}
                onSelect={(key) => handleSelect(key, { scroll: true })}
                selectedPointToken={mapFocusToken}
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
            <button
              type="button"
              onMouseDown={beginMapResize(1)}
              className="flex h-4 w-full items-center justify-center rounded-b-xl border border-white/10 bg-white/[0.03] text-xs text-stone-500 transition hover:bg-white/[0.06]"
              title="Drag to resize map"
            >
              ⋯
            </button>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-black/[0.24] shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-white">All listings</h2>
              <p className="mt-1 text-xs text-stone-500">
                Same structure as the legacy report: ranked table with inline detail rows
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                Showing {filteredResults.length}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                Liked {likedIds.size}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                Hidden {hiddenIds.size}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto px-5 py-4">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.16em] text-stone-500">
                  <th className="w-12 px-3 py-3" />
                  <th
                    className="w-12 cursor-pointer px-3 py-3 hover:text-stone-300"
                    onClick={() => handleSort('rank')}
                  >
                    #
                    {sortKey === 'rank' && <span>{sortAsc ? ' ▲' : ' ▼'}</span>}
                  </th>
                  <th className="px-3 py-3">Photo</th>
                  <th
                    className="cursor-pointer px-3 py-3 hover:text-stone-300"
                    onClick={() => handleSort('title')}
                  >
                    Title
                    {sortKey === 'title' && <span>{sortAsc ? ' ▲' : ' ▼'}</span>}
                  </th>
                  <th
                    className="cursor-pointer px-3 py-3 hover:text-stone-300"
                    onClick={() => handleSort('tier')}
                  >
                    Tier
                    {sortKey === 'tier' && <span>{sortAsc ? ' ▲' : ' ▼'}</span>}
                  </th>
                  <th
                    className="cursor-pointer px-3 py-3 hover:text-stone-300"
                    onClick={() => handleSort('fitScore')}
                  >
                    Score
                    {sortKey === 'fitScore' && <span>{sortAsc ? ' ▲' : ' ▼'}</span>}
                  </th>
                  <th
                    className="cursor-pointer px-3 py-3 hover:text-stone-300"
                    onClick={() => handleSort('price')}
                  >
                    Total
                    {sortKey === 'price' && <span>{sortAsc ? ' ▲' : ' ▼'}</span>}
                  </th>
                  <th className="px-3 py-3">Info</th>
                  <th className="px-3 py-3">Scores</th>
                  <th className="px-3 py-3">Requirements</th>
                  <th className="px-3 py-3">Issues</th>
                  <th className="w-12 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {mainResults.length > 0 ? (
                  renderRows(mainResults)
                ) : (
                  <tr>
                    <td
                      colSpan={12}
                      className="px-4 py-10 text-center text-sm text-stone-400"
                    >
                      {hiddenIds.size > 0 && !showHidden
                        ? 'All listings are hidden. Use “Show hidden” to bring them back.'
                        : 'No listings to show.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="sticky bottom-0 z-20 rounded-[24px] border border-white/10 bg-[#110d0c]/92 px-5 py-4 shadow-[0_-16px_40px_rgba(0,0,0,0.25)] backdrop-blur-xl">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-4 text-sm text-stone-300">
              <span>
                Liked: <strong className="text-white">{likedIds.size}</strong>
              </span>
              <span>
                Hidden: <strong className="text-white">{hiddenIds.size}</strong>
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowHidden((current) => !current)}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.08]"
              >
                {showHidden ? 'Hide hidden' : 'Show hidden'}
              </button>
              <button
                type="button"
                onClick={handleSavePicks}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.08]"
              >
                Save picks.json
              </button>
              <button
                type="button"
                onClick={() => void handleCopyList('liked')}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.08]"
              >
                Copy liked
              </button>
              <button
                type="button"
                onClick={() => void handleCopyList('hidden')}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.08]"
              >
                Copy hidden
              </button>
              <button
                type="button"
                onClick={() => void handleCopyList('all')}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.08]"
              >
                Copy all
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
