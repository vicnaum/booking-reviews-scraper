'use client';

import dynamic from 'next/dynamic';
import SearchBar from '@/components/SearchBar';
import PlatformToggle from '@/components/PlatformToggle';
import FilterPanel from '@/components/FilterPanel';
import ResultsSidebar from '@/components/ResultsSidebar';
import { useSearchStore } from '@/hooks/useSearchStore';

const SearchMap = dynamic(() => import('@/components/SearchMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-neutral-900 text-neutral-600">
      Loading map...
    </div>
  ),
});

export default function HomePage() {
  const hasInitializedSearch = useSearchStore((s) => s.hasInitializedSearch);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(255,107,95,0.18),transparent_48%)]" />
      <div className="pointer-events-none absolute right-[-10rem] top-24 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(40,112,255,0.16),transparent_62%)] blur-3xl" />

      <header className="relative z-10 px-4 pt-4 md:px-5">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 rounded-[28px] border border-white/10 bg-black/[0.28] px-4 py-4 shadow-[0_24px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-sm font-semibold text-[#f7c992] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                SR
              </div>
              <div className="min-w-0">
                <div className="font-[family:var(--font-display)] text-xl font-semibold tracking-tight text-white">
                  StayReviewr
                </div>
                <p className="text-sm text-stone-400">
                  Search by city first, then carve out the area you actually care about.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:min-w-[720px] lg:flex-row lg:items-center lg:justify-end">
              <div className="lg:flex-1">
                <SearchBar />
              </div>
              <PlatformToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 px-4 pt-3 md:px-5">
        <div className="mx-auto w-full max-w-[1600px]">
          <FilterPanel />
        </div>
      </div>

      {hasInitializedSearch ? (
        <div className="relative z-10 flex flex-1 px-4 pb-4 pt-3 md:px-5">
          <div className="mx-auto flex w-full max-w-[1600px] overflow-hidden rounded-[30px] border border-white/10 bg-black/[0.24] shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
            <ResultsSidebar />
            <main className="relative flex-1 overflow-hidden">
              <SearchMap />
            </main>
          </div>
        </div>
      ) : (
        <main className="relative z-10 flex flex-1 items-center px-4 pb-4 pt-3 md:px-5">
          <div className="mx-auto grid w-full max-w-[1600px] gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.06),rgba(255,255,255,0.015))] p-8 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:p-10 lg:p-12">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(255,107,95,0.16),transparent_58%)]" />
              <div className="relative max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
                  City-first search
                </p>
                <h1 className="mt-5 max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  Search a city, then shape the exact stay zone on the map.
                </h1>
                <p className="mt-5 max-w-xl text-base leading-7 text-stone-300">
                  Start with a real place, filter for the apartment you need, then refine with rectangles, circles, POIs, and full-area search when you want exhaustive coverage.
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-stone-200">
                    Search a city
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-stone-200">
                    Filter for 2-bedroom apartments
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-stone-200">
                    Draw areas and compare platforms
                  </span>
                </div>
              </div>
            </section>

            <aside className="rounded-[34px] border border-white/10 bg-black/[0.24] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                Suggested Flow
              </p>
              <div className="mt-6 space-y-4">
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
                  <div className="text-sm font-semibold text-white">1. Start with a city</div>
                  <p className="mt-1 text-sm leading-6 text-stone-400">
                    Try London, Lisbon, or Rome and let the map open at a useful zoom level immediately.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
                  <div className="text-sm font-semibold text-white">2. Tighten the brief</div>
                  <p className="mt-1 text-sm leading-6 text-stone-400">
                    Set bedrooms, beds, dates, price, and platform-specific filters before you start area work.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
                  <div className="text-sm font-semibold text-white">3. Refine by geometry</div>
                  <p className="mt-1 text-sm leading-6 text-stone-400">
                    Use rectangles today, circles and POIs now, and then run full search when you want persisted results to export.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </main>
      )}
    </div>
  );
}
