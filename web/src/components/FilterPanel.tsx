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

const fieldClassName =
  'h-10 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-[#ff6b5f]/35 focus:bg-black/30';

const groupClassName =
  'flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-black/[0.18] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';

const smallButtonClassName =
  'flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-xs font-semibold text-stone-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-30';

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
  const drawMode = useSearchStore((s) => s.drawMode);
  const circleFilter = useSearchStore((s) => s.circleFilter);
  const poi = useSearchStore((s) => s.poi);
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
  const setDrawMode = useSearchStore((s) => s.setDrawMode);
  const setUseLocationSearch = useSearchStore((s) => s.setUseLocationSearch);
  const setUserBbox = useSearchStore((s) => s.setUserBbox);
  const setCircleFilter = useSearchStore((s) => s.setCircleFilter);
  const setPoi = useSearchStore((s) => s.setPoi);
  const setPendingViewportSearch = useSearchStore(
    (s) => s.setPendingViewportSearch,
  );
  const triggerQuickSearch = useSearchStore((s) => s.triggerQuickSearch);
  const startFullSearch = useSearchStore((s) => s.startFullSearch);

  const fullSearchBbox = userBbox ?? viewportBbox;
  const canStartFullSearch =
    hasInitializedSearch &&
    !!fullSearchBbox &&
    (userBbox !== null || zoom >= 12) &&
    !activeJobId;
  const canDrawArea = hasInitializedSearch && !activeJobId;
  const canTogglePoi = hasInitializedSearch;

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
    <div className="rounded-[28px] border border-white/10 bg-black/[0.24] p-3 shadow-[0_22px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-3">
        <div className={groupClassName}>
          <input
            type="date"
            value={checkin ?? ''}
            onChange={(e) => updateSilent('checkin', e.target.value || null)}
            onBlur={commitSearch}
            onKeyDown={onEnter}
            className={`${fieldClassName} w-[9.5rem]`}
          />
          <input
            type="date"
            value={checkout ?? ''}
            onChange={(e) => updateSilent('checkout', e.target.value || null)}
            onBlur={commitSearch}
            onKeyDown={onEnter}
            className={`${fieldClassName} w-[9.5rem]`}
          />
          <div className="mx-1 hidden h-7 w-px bg-white/[0.08] xl:block" />
          <div className="flex items-center gap-1 rounded-xl bg-black/[0.18] px-1 py-1">
            <button
              onClick={() => update('adults', Math.max(1, adults - 1))}
              className={smallButtonClassName}
              disabled={adults <= 1}
            >
              -
            </button>
            <span className="min-w-16 text-center text-xs font-semibold text-stone-200">
              {adults} {adults === 1 ? 'guest' : 'guests'}
            </span>
            <button
              onClick={() => update('adults', Math.min(16, adults + 1))}
              className={smallButtonClassName}
            >
              +
            </button>
          </div>
        </div>

        <div className={groupClassName}>
          <input
            type="number"
            min={0}
            value={minBedrooms ?? ''}
            onChange={(e) =>
              updateSilent(
                'minBedrooms',
                e.target.value ? Number(e.target.value) : null,
              )
            }
            onBlur={commitSearch}
            onKeyDown={onEnter}
            placeholder="Bedrooms"
            className={`${fieldClassName} w-28`}
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
            className={`${fieldClassName} w-24`}
          />
          <input
            type="number"
            value={priceMin ?? ''}
            onChange={(e) =>
              updateSilent('priceMin', e.target.value ? Number(e.target.value) : null)
            }
            onBlur={commitSearch}
            onKeyDown={onEnter}
            placeholder={`Min ${currency === 'EUR' ? '\u20AC' : '$'}`}
            className={`${fieldClassName} w-24`}
          />
          <input
            type="number"
            value={priceMax ?? ''}
            onChange={(e) =>
              updateSilent('priceMax', e.target.value ? Number(e.target.value) : null)
            }
            onBlur={commitSearch}
            onKeyDown={onEnter}
            placeholder={`Max ${currency === 'EUR' ? '\u20AC' : '$'}`}
            className={`${fieldClassName} w-24`}
          />
        </div>

        <div className={groupClassName}>
          <select
            value={minRating ?? ''}
            onChange={(e) =>
              update('minRating', e.target.value ? Number(e.target.value) : null)
            }
            className={`${fieldClassName} w-28`}
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

          <select
            value={propertyType ?? ''}
            onChange={(e) => update('propertyType', e.target.value || null)}
            className={`${fieldClassName} w-32`}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <select
            value={currency}
            onChange={(e) => update('currency', e.target.value)}
            className={`${fieldClassName} w-20`}
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>

          <div className="flex rounded-xl border border-white/10 bg-black/20 p-1">
            {(['perNight', 'total'] as PriceDisplay[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilter('priceDisplay', mode)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  priceDisplay === mode
                    ? 'bg-white text-neutral-950 shadow-sm'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                {mode === 'perNight' ? '/night' : 'total'}
              </button>
            ))}
          </div>
        </div>

        <div className={groupClassName}>
          {platform === 'airbnb' && (
            <>
              <label className="flex items-center gap-2 rounded-xl px-2 py-1 text-xs font-medium text-stone-300">
                <input
                  type="checkbox"
                  checked={airbnbFilters.superhost ?? false}
                  onChange={(e) =>
                    updateAirbnb('superhost', e.target.checked || undefined)
                  }
                  className="accent-[#ff6b5f]"
                />
                Superhost
              </label>
              <label className="flex items-center gap-2 rounded-xl px-2 py-1 text-xs font-medium text-stone-300">
                <input
                  type="checkbox"
                  checked={airbnbFilters.instantBook ?? false}
                  onChange={(e) =>
                    updateAirbnb('instantBook', e.target.checked || undefined)
                  }
                  className="accent-[#ff6b5f]"
                />
                Instant Book
              </label>
            </>
          )}

          {platform === 'booking' && (
            <label className="flex items-center gap-2 rounded-xl px-2 py-1 text-xs font-medium text-stone-300">
              <input
                type="checkbox"
                checked={bookingFilters.freeCancellation ?? false}
                onChange={(e) =>
                  updateBooking('freeCancellation', e.target.checked || undefined)
                }
                className="accent-[#2870ff]"
              />
              Free cancellation
            </label>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <button
          onClick={() => setDrawMode(drawMode === 'rectangle' ? null : 'rectangle')}
          disabled={!canDrawArea}
          className={`rounded-2xl border px-4 py-2.5 text-xs font-semibold transition ${
            drawMode === 'rectangle'
              ? 'border-[#f4b56a]/60 bg-[#3b2914] text-[#ffe3bc]'
              : 'border-white/10 bg-white/[0.04] text-stone-300 hover:bg-white/[0.08] hover:text-white'
          } disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.03] disabled:text-stone-600`}
        >
          {drawMode === 'rectangle' ? 'Cancel rectangle' : 'Draw rectangle'}
        </button>
        <button
          onClick={() => setDrawMode(drawMode === 'circle' ? null : 'circle')}
          disabled={!canDrawArea}
          className={`rounded-2xl border px-4 py-2.5 text-xs font-semibold transition ${
            drawMode === 'circle'
              ? 'border-sky-400/50 bg-sky-950/60 text-sky-100'
              : 'border-white/10 bg-white/[0.04] text-stone-300 hover:bg-white/[0.08] hover:text-white'
          } disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.03] disabled:text-stone-600`}
        >
          {drawMode === 'circle' ? 'Cancel circle' : 'Draw circle'}
        </button>
        <button
          onClick={() => {
            if (drawMode === 'poi' || poi) {
              setDrawMode(null);
              setPoi(null);
              return;
            }

            setDrawMode('poi');
          }}
          disabled={!canTogglePoi}
          className={`rounded-2xl border px-4 py-2.5 text-xs font-semibold transition ${
            drawMode === 'poi' || poi
              ? 'border-orange-400/50 bg-orange-950/60 text-orange-100'
              : 'border-white/10 bg-white/[0.04] text-stone-300 hover:bg-white/[0.08] hover:text-white'
          } disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.03] disabled:text-stone-600`}
        >
          {drawMode === 'poi' || poi ? 'Clear POI' : 'Set POI'}
        </button>
        {(userBbox || circleFilter) && (
          <button
            onClick={() => {
              setDrawMode(null);
              setUseLocationSearch(false);
              setCircleFilter(null);
              setUserBbox(null);
              setPendingViewportSearch(false);
              void triggerQuickSearch({ force: true });
            }}
            disabled={!hasInitializedSearch || !!activeJobId}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-stone-300 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.03] disabled:text-stone-600"
          >
            Clear area
          </button>
        )}
        <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-stone-300">
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(e) => setAutoUpdate(e.target.checked)}
            className="accent-[#ff6b5f]"
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
            className="rounded-2xl border border-[#f4b56a]/30 bg-[#3a2917] px-4 py-2.5 text-xs font-semibold text-[#ffe0b0] transition hover:brightness-110 disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.03] disabled:text-stone-600"
          >
            {pendingViewportSearch ? 'Update map' : 'Map up to date'}
          </button>
        )}
        {activeJobId && (
          <span className="text-xs font-medium text-stone-500">
            Full search {Math.round(jobProgress * 100)}%
          </span>
        )}
        <button
          onClick={() => {
            void startFullSearch();
          }}
          disabled={!canStartFullSearch}
          className="rounded-2xl border border-emerald-300/20 bg-[linear-gradient(135deg,rgba(15,76,52,0.95),rgba(28,108,76,0.95))] px-4 py-2.5 text-xs font-semibold text-emerald-100 shadow-[0_12px_30px_rgba(8,56,37,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.03] disabled:text-stone-600 disabled:shadow-none"
        >
          {activeJobId ? 'Full search running...' : 'Full search this area'}
        </button>
      </div>
    </div>
    </div>
  );
}
