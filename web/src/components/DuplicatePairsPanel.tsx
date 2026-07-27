'use client';

import React, { useMemo, useState } from 'react';
import type {
  PriceDisplayMode,
  ReviewJobDuplicatePair,
  ReviewJobListing,
  ReviewJobResponse,
} from '@/types';
import { getPriceDisplayInfo } from '@/lib/pricing';
import { getListingResultsSnapshot } from '@/lib/results';
import {
  isActiveDuplicatePair,
  isMaterialDuplicateConflict,
} from '@/lib/reviewJobDuplicatePresentation';
import PlatformBadge from './PlatformBadge';

type PairDecision = 'suggested' | 'confirmed' | 'dismissed';

function listingKey(listing: ReviewJobListing): string {
  return `${listing.platform}:${listing.id}`;
}

function tierLabel(listing: ReviewJobListing): string {
  const tier = getListingResultsSnapshot(listing).triage?.tier;
  return tier?.replace(/_/g, ' ') ?? 'unscored';
}

function reviewSampleLabel(listing: ReviewJobListing): string {
  const sample = listing.analysis?.reviewSample;
  const analyzed =
    sample?.analyzedReviewCount == null
      ? 'analysed sample unknown'
      : `${sample.analyzedReviewCount.toLocaleString('en-US')} analysed`;
  const scraped =
    sample?.totalScrapedReviewCount == null
      ? 'scraped total unknown'
      : `${sample.totalScrapedReviewCount.toLocaleString('en-US')} scraped`;
  return `${analyzed} · ${scraped}`;
}

function confidenceLabel(pair: ReviewJobDuplicatePair): string {
  if (pair.decision === 'confirmed') return 'Confirmed same property';
  if (pair.decision === 'dismissed') return 'Dismissed suggestion';
  if (pair.detectorConfidence === 'likely_same') {
    return 'Likely same property';
  }
  return 'Possible same property';
}

function evidenceLabel(pair: ReviewJobDuplicatePair): string {
  const distance =
    pair.distanceMeters == null
      ? 'distance unknown'
      : `${pair.distanceMeters.toFixed(1)} m apart`;
  if (pair.nameSource === 'host') {
    return `Airbnb host name matched · ${distance}`;
  }
  if (pair.nameSource === 'address') {
    return `Exact captured address matched · ${distance}`;
  }
  if (pair.nameSource === 'card') {
    return `Listing names matched · ${distance}`;
  }
  return `Nearby cross-platform candidate · ${distance}`;
}

function ListingEvidenceCard({
  listing,
  job,
  priceDisplay,
  onSelect,
}: {
  listing: ReviewJobListing;
  job: Pick<ReviewJobResponse['job'], 'checkin' | 'checkout'>;
  priceDisplay: PriceDisplayMode;
  onSelect?: (key: string) => void;
}) {
  const price = getPriceDisplayInfo(listing, priceDisplay, {
    checkin: job.checkin,
    checkout: job.checkout,
  });
  const triage = getListingResultsSnapshot(listing).triage;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(listingKey(listing))}
      className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4 text-left transition hover:border-white/20 hover:bg-white/[0.04]"
    >
      <PlatformBadge platform={listing.platform} />
      <span className="mt-2 block text-sm font-semibold text-white">
        {listing.name}
      </span>
      <span className="mt-2 block text-xs capitalize text-stone-300">
        Verdict: {tierLabel(listing)} ·{' '}
        {(triage?.rankingStatus ?? 'unscored').replace(/_/g, ' ')}
      </span>
      <span className="mt-1 block text-xs text-stone-400">
        {price.primary}
        {price.secondary ? ` · ${price.secondary}` : ''}
      </span>
      <span className="mt-1 block text-xs text-stone-400">
        {listing.staySnapshot.bookingEligibility.reason
          ?? 'Exact-stay availability unknown'}
      </span>
      <span className="mt-1 block text-xs capitalize text-stone-400">
        Affordability: {listing.affordability.status}
      </span>
      <span className="mt-2 block text-[11px] text-stone-500">
        {listing.reviewCount.toLocaleString('en-US')} public reviews
      </span>
      <span className="mt-1 block text-[11px] text-stone-500">
        {reviewSampleLabel(listing)}
      </span>
    </button>
  );
}

export default function DuplicatePairsPanel({
  pairs,
  listings,
  job,
  priceDisplay,
  viewerCanEdit,
  onDecision,
  onSelectListing,
}: {
  pairs: ReviewJobDuplicatePair[];
  listings: ReviewJobListing[];
  job: Pick<ReviewJobResponse['job'], 'checkin' | 'checkout'>;
  priceDisplay: PriceDisplayMode;
  viewerCanEdit: boolean;
  onDecision?: (
    pair: Pick<
      ReviewJobDuplicatePair,
      'airbnbListingId' | 'bookingListingId'
    >,
    decision: PairDecision,
  ) => Promise<void>;
  onSelectListing?: (key: string) => void;
}) {
  const [manualAirbnbId, setManualAirbnbId] = useState('');
  const [manualBookingId, setManualBookingId] = useState('');
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const listingsByKey = useMemo(
    () => new Map(
      listings.map((listing) => [listingKey(listing), listing]),
    ),
    [listings],
  );
  const visiblePairs = useMemo(
    () => pairs
      .filter((pair) =>
        viewerCanEdit || pair.decision !== 'dismissed')
      .sort((left, right) =>
        Number(isActiveDuplicatePair(right))
        - Number(isActiveDuplicatePair(left))
        || left.createdAt.localeCompare(right.createdAt)),
    [pairs, viewerCanEdit],
  );
  const airbnbListings = listings.filter(
    (listing) => listing.platform === 'airbnb',
  );
  const bookingListings = listings.filter(
    (listing) => listing.platform === 'booking',
  );

  async function decide(
    pair: Pick<
      ReviewJobDuplicatePair,
      'airbnbListingId' | 'bookingListingId'
    >,
    decision: PairDecision,
  ) {
    if (!onDecision) return;
    const key =
      `${pair.airbnbListingId}:${pair.bookingListingId}:${decision}`;
    setPendingKey(key);
    setMessage(null);
    try {
      await onDecision(pair, decision);
      setMessage(
        decision === 'confirmed'
          ? 'Cross-platform link confirmed.'
          : decision === 'dismissed'
            ? 'Suggestion dismissed.'
            : 'Decision undone.',
      );
      if (decision === 'confirmed') {
        setManualAirbnbId('');
        setManualBookingId('');
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Failed to update cross-platform link.',
      );
    } finally {
      setPendingKey(null);
    }
  }

  if (
    visiblePairs.length === 0
    && (!viewerCanEdit || airbnbListings.length === 0 || bookingListings.length === 0)
  ) {
    return null;
  }

  return (
    <section className="rounded-[28px] border border-sky-300/15 bg-sky-300/[0.045] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200/70">
            Cross-platform identity
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            Same-property checks
          </h2>
          <p className="mt-2 max-w-4xl text-xs leading-5 text-stone-400">
            Each offer and its evidence stay separate. Confirmed or likely
            pairs with materially different verdicts are withheld from peer
            ranking until you review both; possible suggestions never affect
            ranking.
          </p>
        </div>
        {!viewerCanEdit && (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-stone-400">
            Read-only
          </span>
        )}
      </div>

      {visiblePairs.length > 0 && (
        <div className="mt-5 space-y-4">
          {visiblePairs.map((pair) => {
            const airbnb = listingsByKey.get(
              `airbnb:${pair.airbnbListingId}`,
            );
            const booking = listingsByKey.get(
              `booking:${pair.bookingListingId}`,
            );
            if (!airbnb || !booking) return null;
            const materialConflict = isMaterialDuplicateConflict(
              pair,
              listingsByKey,
            );
            const hostName =
              typeof pair.evidence?.airbnbHostName === 'string'
                ? pair.evidence.airbnbHostName
                : null;
            return (
              <article
                key={pair.id}
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${
                    pair.decision === 'confirmed'
                      ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100'
                      : pair.decision === 'dismissed'
                        ? 'border-white/10 bg-white/[0.04] text-stone-400'
                      : pair.detectorConfidence === 'likely_same'
                        ? 'border-sky-300/20 bg-sky-300/10 text-sky-100'
                        : 'border-amber-300/20 bg-amber-300/10 text-amber-100'
                  }`}>
                    {confidenceLabel(pair)}
                  </span>
                  <span className="text-[11px] text-stone-500">
                    {evidenceLabel(pair)}
                  </span>
                </div>
                {hostName && pair.nameSource === 'host' && (
                  <p className="mt-2 text-[11px] text-stone-400">
                    Captured Airbnb host: {hostName}
                  </p>
                )}
                {materialConflict && (
                  <p className="mt-3 rounded-xl border border-rose-300/20 bg-rose-300/[0.08] px-3 py-2 text-xs font-semibold text-rose-100">
                    Material verdict conflict — inspect both evidence sets.
                    Neither offer is included in peer ranks or the top-picks
                    hero while this link is active.
                  </p>
                )}
                {pair.decision === 'dismissed' ? (
                  <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-stone-400">
                    Dismissed — no ranking impact.
                  </p>
                ) : !isActiveDuplicatePair(pair) && (
                  <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2 text-xs text-amber-100/80">
                    Suggestion only — no ranking impact unless confirmed.
                  </p>
                )}
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <ListingEvidenceCard
                    listing={airbnb}
                    job={job}
                    priceDisplay={priceDisplay}
                    onSelect={onSelectListing}
                  />
                  <ListingEvidenceCard
                    listing={booking}
                    job={job}
                    priceDisplay={priceDisplay}
                    onSelect={onSelectListing}
                  />
                </div>
                {viewerCanEdit && onDecision && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pair.decision === 'dismissed' ? (
                      <button
                        type="button"
                        disabled={pendingKey != null}
                        onClick={() => void decide(pair, 'suggested')}
                        className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-stone-300 disabled:opacity-50"
                      >
                        Undo dismissal
                      </button>
                    ) : pair.decision === 'confirmed' ? (
                      <>
                        <button
                          type="button"
                          disabled={pendingKey != null}
                          onClick={() => void decide(pair, 'suggested')}
                          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-stone-300 disabled:opacity-50"
                        >
                          Undo confirmation
                        </button>
                        <button
                          type="button"
                          disabled={pendingKey != null}
                          onClick={() => void decide(pair, 'dismissed')}
                          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-stone-300 disabled:opacity-50"
                        >
                          Not the same
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={pendingKey != null}
                          onClick={() => void decide(pair, 'confirmed')}
                          className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-50"
                        >
                          Confirm same property
                        </button>
                        <button
                          type="button"
                          disabled={pendingKey != null}
                          onClick={() => void decide(pair, 'dismissed')}
                          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-stone-300 disabled:opacity-50"
                        >
                          Not the same
                        </button>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {viewerCanEdit
        && onDecision
        && airbnbListings.length > 0
        && bookingListings.length > 0 && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4">
            <p className="text-xs font-semibold text-white">
              Link a missed pair
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <select
                aria-label="Airbnb listing"
                value={manualAirbnbId}
                onChange={(event) =>
                  setManualAirbnbId(event.target.value)}
                className="rounded-xl border border-white/10 bg-[#171311] px-3 py-2 text-xs text-stone-200"
              >
                <option value="">Choose Airbnb listing</option>
                {airbnbListings.map((listing) => (
                  <option key={listing.id} value={listing.id}>
                    {listing.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Booking listing"
                value={manualBookingId}
                onChange={(event) =>
                  setManualBookingId(event.target.value)}
                className="rounded-xl border border-white/10 bg-[#171311] px-3 py-2 text-xs text-stone-200"
              >
                <option value="">Choose Booking listing</option>
                {bookingListings.map((listing) => (
                  <option key={listing.id} value={listing.id}>
                    {listing.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={
                  !manualAirbnbId
                  || !manualBookingId
                  || pendingKey != null
                }
                onClick={() => void decide(
                  {
                    airbnbListingId: manualAirbnbId,
                    bookingListingId: manualBookingId,
                  },
                  'confirmed',
                )}
                className="rounded-xl border border-sky-300/20 bg-sky-300/10 px-4 py-2 text-xs font-semibold text-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Link listings
              </button>
            </div>
          </div>
        )}
      {message && (
        <p className="mt-3 text-xs font-semibold text-stone-300">
          {message}
        </p>
      )}
    </section>
  );
}
