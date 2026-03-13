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
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-3">
        <span className="text-sm font-semibold tracking-tight text-white">
          StayReviewr
        </span>
        <div className="flex-1 max-w-md">
          <SearchBar />
        </div>
        <PlatformToggle />
      </header>

      {/* Filter bar */}
      <FilterPanel />

      {/* Main content */}
      {hasInitializedSearch ? (
        <div className="flex flex-1 overflow-hidden">
          <ResultsSidebar />

          <main className="relative flex-1">
            <SearchMap />
          </main>
        </div>
      ) : (
        <main className="flex flex-1 items-center justify-center bg-neutral-950 px-6">
          <div className="max-w-lg text-center">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">
              City-first search
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
              Search a city, then refine it on the map.
            </h1>
            <p className="mt-4 text-sm leading-6 text-neutral-400">
              Pick a city in the top bar and set your filters first. The map and
              results will open after the first search, so you start from a real
              area instead of zooming in from the world view.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}
