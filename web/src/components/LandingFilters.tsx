'use client';

import { useCallback, useRef, type KeyboardEvent } from 'react';
import { useSearchStore } from '@/hooks/useSearchStore';
import { currencySymbol } from '@/lib/format';

const fieldClassName =
  'h-12 w-full min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-[#ff6b5f]/35 focus:bg-black/30';
const dateFieldClassName = `${fieldClassName} pr-12`;

const stepperButtonClassName =
  'flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-sm font-semibold text-stone-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-30';

const labelClassName =
  'mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500';

function openDatePicker(input: HTMLInputElement | null) {
  if (!input) {
    return;
  }

  if (typeof input.showPicker === 'function') {
    input.showPicker();
    return;
  }

  input.focus();
  input.click();
}

export default function LandingFilters() {
  const checkin = useSearchStore((s) => s.checkin);
  const checkout = useSearchStore((s) => s.checkout);
  const adults = useSearchStore((s) => s.adults);
  const minBedrooms = useSearchStore((s) => s.minBedrooms);
  const minBeds = useSearchStore((s) => s.minBeds);
  const priceMin = useSearchStore((s) => s.priceMin);
  const priceMax = useSearchStore((s) => s.priceMax);
  const currency = useSearchStore((s) => s.currency);
  const setFilter = useSearchStore((s) => s.setFilter);
  const checkinInputRef = useRef<HTMLInputElement | null>(null);
  const checkoutInputRef = useRef<HTMLInputElement | null>(null);

  const onEnter = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  }, []);

  const updateNumber = useCallback(
    (key: string, value: string) => {
      setFilter(key, value ? Number(value) : null);
    },
    [setFilter],
  );
  const currencyPrefix = currencySymbol(currency);

  return (
    <div className="mt-6 w-full rounded-[28px] border border-white/10 bg-black/[0.24] p-5 shadow-[0_22px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={labelClassName}>Check-in</label>
            <div className="relative">
              <input
                ref={checkinInputRef}
                type="date"
                value={checkin ?? ''}
                onChange={(e) => setFilter('checkin', e.target.value || null)}
                className={`${dateFieldClassName} tabular-nums`}
              />
              <button
                type="button"
                onClick={() => openDatePicker(checkinInputRef.current)}
                className="absolute inset-y-0 right-2 flex w-9 items-center justify-center rounded-xl text-stone-400 transition hover:bg-white/[0.06] hover:text-stone-200"
                aria-label="Open check-in calendar"
                title="Open calendar"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4" />
                  <path d="M8 2v4" />
                  <path d="M3 10h18" />
                </svg>
              </button>
            </div>
          </div>

          <div>
            <label className={labelClassName}>Check-out</label>
            <div className="relative">
              <input
                ref={checkoutInputRef}
                type="date"
                value={checkout ?? ''}
                onChange={(e) => setFilter('checkout', e.target.value || null)}
                className={`${dateFieldClassName} tabular-nums`}
              />
              <button
                type="button"
                onClick={() => openDatePicker(checkoutInputRef.current)}
                className="absolute inset-y-0 right-2 flex w-9 items-center justify-center rounded-xl text-stone-400 transition hover:bg-white/[0.06] hover:text-stone-200"
                aria-label="Open check-out calendar"
                title="Open calendar"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4" />
                  <path d="M8 2v4" />
                  <path d="M3 10h18" />
                </svg>
              </button>
            </div>
          </div>

          <div>
            <label className={labelClassName}>Guests</label>
            <div className="flex h-12 items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-2">
              <button
                onClick={() => setFilter('adults', Math.max(1, adults - 1))}
                className={stepperButtonClassName}
                disabled={adults <= 1}
              >
                -
              </button>
              <span className="min-w-[6.5rem] text-center text-sm font-semibold tabular-nums text-stone-100">
                {adults} {adults === 1 ? 'guest' : 'guests'}
              </span>
              <button
                onClick={() => setFilter('adults', Math.min(16, adults + 1))}
                className={stepperButtonClassName}
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)]">
          <div>
            <label className={labelClassName}>At least bedrooms</label>
            <input
              type="number"
              min={0}
              value={minBedrooms ?? ''}
              onChange={(e) => updateNumber('minBedrooms', e.target.value)}
              onKeyDown={onEnter}
              placeholder="Any"
              className={fieldClassName}
            />
          </div>

          <div>
            <label className={labelClassName}>At least beds</label>
            <input
              type="number"
              min={0}
              value={minBeds ?? ''}
              onChange={(e) => updateNumber('minBeds', e.target.value)}
              onKeyDown={onEnter}
              placeholder="Any"
              className={fieldClassName}
            />
          </div>

          <div>
            <label className={labelClassName}>Price range ({currency})</label>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-stone-400">
                  {currencyPrefix}
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={priceMin ?? ''}
                  onChange={(e) => updateNumber('priceMin', e.target.value)}
                  onKeyDown={onEnter}
                  placeholder="Min"
                  className={`${fieldClassName} pl-9`}
                />
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-stone-400">
                  {currencyPrefix}
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={priceMax ?? ''}
                  onChange={(e) => updateNumber('priceMax', e.target.value)}
                  onKeyDown={onEnter}
                  placeholder="Max"
                  className={`${fieldClassName} pl-9`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm text-stone-500">
        These filters carry straight into the map after the first city search.
      </p>
    </div>
  );
}
