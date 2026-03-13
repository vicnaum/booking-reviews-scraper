'use client';

import { useCallback, type KeyboardEvent } from 'react';
import { useSearchStore } from '@/hooks/useSearchStore';

const fieldClassName =
  'h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-[#ff6b5f]/35 focus:bg-black/30';

const stepperButtonClassName =
  'flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-sm font-semibold text-stone-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-30';

const labelClassName =
  'mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500';

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

  return (
    <div className="mt-6 w-full rounded-[28px] border border-white/10 bg-black/[0.24] p-5 shadow-[0_22px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div>
          <label className={labelClassName}>Check-in</label>
          <input
            type="date"
            value={checkin ?? ''}
            onChange={(e) => setFilter('checkin', e.target.value || null)}
            className={fieldClassName}
          />
        </div>

        <div>
          <label className={labelClassName}>Check-out</label>
          <input
            type="date"
            value={checkout ?? ''}
            onChange={(e) => setFilter('checkout', e.target.value || null)}
            className={fieldClassName}
          />
        </div>

        <div>
          <label className={labelClassName}>Guests</label>
          <div className="flex h-11 items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-2">
            <button
              onClick={() => setFilter('adults', Math.max(1, adults - 1))}
              className={stepperButtonClassName}
              disabled={adults <= 1}
            >
              -
            </button>
            <span className="text-sm font-semibold text-stone-100">
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

        <div>
          <label className={labelClassName}>At least bedrooms</label>
          <input
            type="number"
            min={0}
            value={minBedrooms ?? ''}
            onChange={(e) => updateNumber('minBedrooms', e.target.value)}
            onKeyDown={onEnter}
            placeholder="2"
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
            placeholder="2"
            className={fieldClassName}
          />
        </div>

        <div>
          <label className={labelClassName}>Price range ({currency})</label>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              value={priceMin ?? ''}
              onChange={(e) => updateNumber('priceMin', e.target.value)}
              onKeyDown={onEnter}
              placeholder="Min"
              className={fieldClassName}
            />
            <input
              type="number"
              value={priceMax ?? ''}
              onChange={(e) => updateNumber('priceMax', e.target.value)}
              onKeyDown={onEnter}
              placeholder="Max"
              className={fieldClassName}
            />
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm text-stone-500">
        These filters carry straight into the map after the first city search.
      </p>
    </div>
  );
}
