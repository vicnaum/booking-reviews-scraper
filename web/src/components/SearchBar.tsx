'use client';

import { useState, useEffect, useCallback, type KeyboardEvent } from 'react';
import { useSearchStore } from '@/hooks/useSearchStore';
import type { GeocodeResult } from '@/types';

export default function SearchBar() {
  const locationQuery = useSearchStore((s) => s.locationQuery);
  const [query, setQuery] = useState(locationQuery ?? '');
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializeLocationSearch = useSearchStore(
    (s) => s.initializeLocationSearch,
  );

  useEffect(() => {
    setQuery(locationQuery ?? '');
  }, [locationQuery]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setIsSearching(true);
    setError(null);

    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Search failed');
        return;
      }
      const data: GeocodeResult = await res.json();
      await initializeLocationSearch(data, q);
    } catch {
      setError('Network error');
    } finally {
      setIsSearching(false);
    }
  }, [initializeLocationSearch, query]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition focus-within:border-[#ff6b5f]/40 focus-within:bg-black/30">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search a city to begin..."
          className="w-full bg-transparent px-4 py-3 pl-11 text-sm font-medium text-white outline-none"
        />
        <svg
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone-500"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </div>
      <button
        onClick={handleSearch}
        disabled={isSearching || !query.trim()}
        className="rounded-2xl border border-[#ff8d81]/40 bg-[linear-gradient(135deg,#ff6b5f,#ff8e64)] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(255,107,95,0.28)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:border-white/[0.05] disabled:bg-white/[0.06] disabled:text-stone-500 disabled:shadow-none"
      >
        {isSearching ? 'Searching...' : 'Search'}
      </button>
      {error && (
        <span className="text-xs text-rose-300">{error}</span>
      )}
    </div>
  );
}
