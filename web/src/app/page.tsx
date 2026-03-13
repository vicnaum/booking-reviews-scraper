'use client';

import dynamic from 'next/dynamic';
import SearchBar from '@/components/SearchBar';
import PlatformToggle from '@/components/PlatformToggle';
import LandingFilters from '@/components/LandingFilters';
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

  if (!hasInitializedSearch) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,107,95,0.16),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(40,112,255,0.12),transparent_28%)]" />
        <div className="relative w-full max-w-5xl rounded-[36px] border border-white/10 bg-black/[0.28] p-8 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:p-10">
          <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-base font-semibold text-[#f7c992] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              SR
            </div>
            <p className="mt-5 text-sm font-semibold uppercase tracking-[0.26em] text-stone-500">
              StayReviewr
            </p>
            <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Search a city first.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-stone-300">
              Start with a real place, then open the map only after the first search.
              Filters and area tools appear when they are actually useful.
            </p>

            <div className="mt-8 flex justify-center">
              <PlatformToggle />
            </div>

            <div className="mt-6 w-full">
              <SearchBar />
            </div>

            <LandingFilters />

            <p className="mt-4 text-sm text-stone-500">
              Enter a city like London, Lisbon, or Rome, then open the map with
              your filters already in place.
            </p>
          </div>
        </div>
      </main>
    );
  }

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

      <div className="relative z-10 flex flex-1 px-4 pb-4 pt-3 md:px-5">
        <div className="mx-auto flex w-full max-w-[1600px] overflow-hidden rounded-[30px] border border-white/10 bg-black/[0.24] shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <ResultsSidebar />
          <main className="relative flex-1 overflow-hidden">
            <SearchMap />
          </main>
        </div>
      </div>
    </div>
  );
}
