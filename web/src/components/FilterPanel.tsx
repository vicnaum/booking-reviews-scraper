'use client';

import { useCallback, type KeyboardEvent } from 'react';
import { useSearchStore } from '@/hooks/useSearchStore';
import type { PriceDisplay } from '@/lib/format';

const PROPERTY_TYPES = [
  { value: '', label: 'Any type' },
  { value: 'entire', label: 'Entire place' },
  { value: 'private', label: 'Private room' },
  { value: 'hotel', label: 'Hotel room' },
  { value: 'shared', label: 'Shared room' },
];

export default function FilterPanel() {
  const checkin = useSearchStore((s) => s.checkin);
  const checkout = useSearchStore((s) => s.checkout);
  const adults = useSearchStore((s) => s.adults);
  const priceMin = useSearchStore((s) => s.priceMin);
  const priceMax = useSearchStore((s) => s.priceMax);
  const minRating = useSearchStore((s) => s.minRating);
  const minBedrooms = useSearchStore((s) => s.minBedrooms);
  const minBeds = useSearchStore((s) => s.minBeds);
  const propertyType = useSearchStore((s) => s.propertyType);
  const currency = useSearchStore((s) => s.currency);
  const platform = useSearchStore((s) => s.platform);
  const priceDisplay = useSearchStore((s) => s.priceDisplay);
  const hasInitializedSearch = useSearchStore((s) => s.hasInitializedSearch);
  const autoUpdate = useSearchStore((s) => s.autoUpdate);
  const pendingViewportSearch = useSearchStore((s) => s.pendingViewportSearch);
  const airbnbFilters = useSearchStore((s) => s.airbnbFilters);
  const bookingFilters = useSearchStore((s) => s.bookingFilters);
  const viewportBbox = useSearchStore((s) => s.viewportBbox);
  const userBbox = useSearchStore((s) => s.userBbox);
  const zoom = useSearchStore((s) => s.zoom);
  const activeJobId = useSearchStore((s) => s.activeJobId);
  const jobProgress = useSearchStore((s) => s.jobProgress);
  const setFilter = useSearchStore((s) => s.setFilter);
  const setAutoUpdate = useSearchStore((s) => s.setAutoUpdate);
  const triggerQuickSearch = useSearchStore((s) => s.triggerQuickSearch);
  const startFullSearch = useSearchStore((s) => s.startFullSearch);

  const fullSearchBbox = userBbox ?? viewportBbox;
  const canStartFullSearch =
    hasInitializedSearch &&
    !!fullSearchBbox &&
    (userBbox !== null || zoom >= 12) &&
    !activeJobId;

  // Immediate update + search (for selects, checkboxes, buttons)
  const update = useCallback(
    (key: string, value: unknown) => {
      setFilter(key, value);
      triggerQuickSearch();
    },
    [setFilter, triggerQuickSearch],
  );

  // Update store only, no search (for text/date/number inputs while typing)
  const updateSilent = useCallback(
    (key: string, value: unknown) => {
      setFilter(key, value);
    },
    [setFilter],
  );

  // Trigger search on blur or Enter for text-like inputs
  const commitSearch = useCallback(() => {
    triggerQuickSearch();
  }, [triggerQuickSearch]);

  const onEnter = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') triggerQuickSearch();
    },
    [triggerQuickSearch],
  );

  const updateAirbnb = useCallback(
    (key: string, value: unknown) => {
      setFilter('airbnbFilters', { ...airbnbFilters, [key]: value });
      triggerQuickSearch();
    },
    [airbnbFilters, setFilter, triggerQuickSearch],
  );

  const updateBooking = useCallback(
    (key: string, value: unknown) => {
      setFilter('bookingFilters', { ...bookingFilters, [key]: value });
      triggerQuickSearch();
    },
    [bookingFilters, setFilter, triggerQuickSearch],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-4 py-2">
      {/* Dates — search on blur/Enter, not every keystroke */}
      <input
        type="date"
        value={checkin ?? ''}
        onChange={(e) => updateSilent('checkin', e.target.value || null)}
        onBlur={commitSearch}
        onKeyDown={onEnter}
        className="h-8 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 outline-none focus:border-neutral-500"
      />
      <input
        type="date"
        value={checkout ?? ''}
        onChange={(e) => updateSilent('checkout', e.target.value || null)}
        onBlur={commitSearch}
        onKeyDown={onEnter}
        className="h-8 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 outline-none focus:border-neutral-500"
      />

      <div className="h-5 w-px bg-neutral-700" />

      {/* Guests — immediate search (button clicks) */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => update('adults', Math.max(1, adults - 1))}
          className="flex h-7 w-7 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-xs text-neutral-400 hover:bg-neutral-800 disabled:opacity-30"
          disabled={adults <= 1}
        >
          -
        </button>
        <span className="w-12 text-center text-xs text-neutral-300">
          {adults} {adults === 1 ? 'guest' : 'guests'}
        </span>
        <button
          onClick={() => update('adults', Math.min(16, adults + 1))}
          className="flex h-7 w-7 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-xs text-neutral-400 hover:bg-neutral-800"
        >
          +
        </button>
      </div>

      <div className="h-5 w-px bg-neutral-700" />

      {/* Bedrooms — search on blur/Enter */}
      <input
        type="number"
        min={0}
        value={minBedrooms ?? ''}
        onChange={(e) =>
          updateSilent('minBedrooms', e.target.value ? Number(e.target.value) : null)
        }
        onBlur={commitSearch}
        onKeyDown={onEnter}
        placeholder="Bedrooms"
        className="h-8 w-24 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 outline-none focus:border-neutral-500"
      />

      <input
        type="number"
        min={0}
        value={minBeds ?? ''}
        onChange={(e) =>
          updateSilent('minBeds', e.target.value ? Number(e.target.value) : null)
        }
        onBlur={commitSearch}
        onKeyDown={onEnter}
        placeholder="Beds"
        className="h-8 w-20 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 outline-none focus:border-neutral-500"
      />

      <div className="h-5 w-px bg-neutral-700" />

      {/* Price range — search on blur/Enter */}
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={priceMin ?? ''}
          onChange={(e) =>
            updateSilent('priceMin', e.target.value ? Number(e.target.value) : null)
          }
          onBlur={commitSearch}
          onKeyDown={onEnter}
          placeholder={`Min ${currency === 'EUR' ? '\u20AC' : '$'}`}
          className="h-8 w-20 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 outline-none focus:border-neutral-500"
        />
        <span className="text-xs text-neutral-600">-</span>
        <input
          type="number"
          value={priceMax ?? ''}
          onChange={(e) =>
            updateSilent('priceMax', e.target.value ? Number(e.target.value) : null)
          }
          onBlur={commitSearch}
          onKeyDown={onEnter}
          placeholder={`Max ${currency === 'EUR' ? '\u20AC' : '$'}`}
          className="h-8 w-20 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 outline-none focus:border-neutral-500"
        />
      </div>

      <div className="h-5 w-px bg-neutral-700" />

      {/* Rating — immediate (select) */}
      <select
        value={minRating ?? ''}
        onChange={(e) =>
          update('minRating', e.target.value ? Number(e.target.value) : null)
        }
        className="h-8 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 outline-none focus:border-neutral-500"
      >
        <option value="">Any rating</option>
        {platform === 'airbnb' ? (
          <>
            <option value="4.5">4.5+</option>
            <option value="4.7">4.7+</option>
            <option value="4.9">4.9+</option>
          </>
        ) : (
          <>
            <option value="7">7+</option>
            <option value="8">8+</option>
            <option value="9">9+</option>
          </>
        )}
      </select>

      {/* Property type — immediate (select) */}
      <select
        value={propertyType ?? ''}
        onChange={(e) => update('propertyType', e.target.value || null)}
        className="h-8 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 outline-none focus:border-neutral-500"
      >
        {PROPERTY_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Currency — immediate (select) */}
      <select
        value={currency}
        onChange={(e) => update('currency', e.target.value)}
        className="h-8 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 outline-none focus:border-neutral-500"
      >
        <option value="USD">USD</option>
        <option value="EUR">EUR</option>
        <option value="GBP">GBP</option>
      </select>

      {/* Price display toggle — no search needed, just re-render */}
      <div className="flex rounded border border-neutral-700 overflow-hidden">
        {(['perNight', 'total'] as PriceDisplay[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setFilter('priceDisplay', mode)}
            className={`px-2 py-1 text-xs transition-colors ${
              priceDisplay === mode
                ? 'bg-neutral-700 text-white'
                : 'bg-neutral-900 text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {mode === 'perNight' ? '/night' : 'total'}
          </button>
        ))}
      </div>

      {/* Platform-specific filters — immediate (checkboxes) */}
      {platform === 'airbnb' && (
        <>
          <div className="h-5 w-px bg-neutral-700" />
          <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={airbnbFilters.superhost ?? false}
              onChange={(e) => updateAirbnb('superhost', e.target.checked || undefined)}
              className="accent-red-500"
            />
            Superhost
          </label>
          <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={airbnbFilters.instantBook ?? false}
              onChange={(e) => updateAirbnb('instantBook', e.target.checked || undefined)}
              className="accent-red-500"
            />
            Instant Book
          </label>
        </>
      )}

      {platform === 'booking' && (
        <>
          <div className="h-5 w-px bg-neutral-700" />
          <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={bookingFilters.freeCancellation ?? false}
              onChange={(e) =>
                updateBooking('freeCancellation', e.target.checked || undefined)
              }
              className="accent-blue-500"
            />
            Free cancellation
          </label>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(e) => setAutoUpdate(e.target.checked)}
            className="accent-neutral-400"
          />
          Auto-update
        </label>
        {!autoUpdate && (
          <button
            onClick={() => {
              void triggerQuickSearch({ force: true });
            }}
            disabled={
              !hasInitializedSearch ||
              !pendingViewportSearch ||
              !!activeJobId ||
              !fullSearchBbox
            }
            className="rounded border border-amber-700 bg-amber-900/30 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-900 disabled:text-neutral-600"
          >
            {pendingViewportSearch ? 'Update map' : 'Map up to date'}
          </button>
        )}
        {activeJobId && (
          <span className="text-xs text-neutral-500">
            Full search {Math.round(jobProgress * 100)}%
          </span>
        )}
        <button
          onClick={() => {
            void startFullSearch();
          }}
          disabled={!canStartFullSearch}
          className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-900 disabled:text-neutral-600"
        >
          {activeJobId ? 'Full search running...' : 'Full search this area'}
        </button>
      </div>
    </div>
  );
}
