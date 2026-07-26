import React from 'react';
import type { StaySnapshotReadModel } from '@cli/stay-snapshot';

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-US')}`;
  }
}

export function formatSnapshotAge(
  capturedAt: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!capturedAt) return null;
  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedMs)) return null;
  const ageMs = Math.max(0, now - capturedMs);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function availabilityTone(status: StaySnapshotReadModel['availability']['status']) {
  if (status === 'yes') {
    return 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100';
  }
  if (status === 'no') {
    return 'border-rose-300/20 bg-rose-300/10 text-rose-100';
  }
  if (status === 'partial') {
    return 'border-amber-300/20 bg-amber-300/10 text-amber-100';
  }
  return 'border-stone-300/20 bg-stone-300/10 text-stone-200';
}

export default function StaySnapshotStatus({
  snapshot,
  compact = false,
}: {
  snapshot: StaySnapshotReadModel;
  compact?: boolean;
}) {
  const priceAge = formatSnapshotAge(snapshot.priceForStay?.capturedAt);
  const availabilityAge = formatSnapshotAge(snapshot.availability.capturedAt);
  const pricePrefix =
    snapshot.freshness.price === 'fresh'
      ? 'Price'
      : snapshot.priceForStay
        ? 'Last known price'
        : 'Price';
  const availabilityLabel =
    snapshot.freshness.availability === 'fresh'
      ? snapshot.availability.status
      : `${snapshot.availability.status} · ${snapshot.freshness.availability}`;

  return (
    <section
      className={`rounded-2xl border border-white/10 bg-white/[0.03] ${
        compact ? 'p-3' : 'p-4'
      }`}
      data-testid="stay-snapshot"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            Exact-stay public snapshot
          </p>
          <p className="mt-1 text-xs text-stone-300">
            {snapshot.request.checkIn ?? 'Dates missing'} →{' '}
            {snapshot.request.checkOut ?? 'Dates missing'} ·{' '}
            {snapshot.request.adults ?? '?'} adult
            {snapshot.request.adults === 1 ? '' : 's'}
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${availabilityTone(
            snapshot.availability.status,
          )}`}
        >
          Availability: {availabilityLabel}
        </span>
      </div>

      <div className="mt-3 text-sm text-stone-200">
        {snapshot.priceForStay ? (
          <p>
            <span className="font-semibold text-white">
              {pricePrefix}:{' '}
              {formatPrice(
                snapshot.priceForStay.amount,
                snapshot.priceForStay.currency,
              )}{' '}
              total
            </span>{' '}
            <span className="text-xs text-stone-500">
              · public rate · full stay
              {priceAge ? ` · as of ${priceAge}` : ''}
            </span>
          </p>
        ) : (
          <p className="font-semibold text-stone-300">
            Price unknown
            <span className="ml-2 text-xs font-normal text-stone-500">
              No numeric public full-stay price was captured.
            </span>
          </p>
        )}
        {snapshot.priceForStay
          && !snapshot.priceForStay.mandatoryChargesResolved && (
            <p className="mt-1 text-xs text-amber-200">
              Mandatory charges could not be resolved, so affordability is conditional.
            </p>
          )}
        <p className="mt-2 text-xs text-stone-400">
          {snapshot.bookingEligibility.reason}
          {availabilityAge ? ` Availability checked ${availabilityAge}.` : ''}
        </p>
        {snapshot.availability.availableRange && (
          <p className="mt-1 text-xs text-amber-200">
            Provider-offered range:{' '}
            {snapshot.availability.availableRange.checkIn} →{' '}
            {snapshot.availability.availableRange.checkOut}
          </p>
        )}
        {snapshot.refreshAttempt?.status === 'failed' && (
          <p className="mt-2 text-xs text-rose-200" role="alert">
            Latest refresh failed; last known snapshot preserved.{' '}
            {snapshot.refreshAttempt.error ?? 'Provider failure.'}
          </p>
        )}
      </div>

      {!compact && (
        <p className="mt-3 border-t border-white/5 pt-3 text-[11px] leading-5 text-stone-500">
          Signed-in or Genius prices may be lower. This snapshot applies only to
          the dates and guest count shown above.
        </p>
      )}
    </section>
  );
}
