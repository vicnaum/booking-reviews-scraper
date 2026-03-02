'use client';

import dynamic from 'next/dynamic';
import SearchBar from '@/components/SearchBar';
import PlatformToggle from '@/components/PlatformToggle';
import FilterPanel from '@/components/FilterPanel';
import ResultsSidebar from '@/components/ResultsSidebar';

const SearchMap = dynamic(() => import('@/components/SearchMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-neutral-900 text-neutral-600">
      Loading map...
    </div>
  ),
});

export default function HomePage() {
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
      <div className="flex flex-1 overflow-hidden">
        <ResultsSidebar />

        {/* Map */}
        <main className="flex-1 relative">
          <SearchMap />
        </main>
      </div>
    </div>
  );
}
