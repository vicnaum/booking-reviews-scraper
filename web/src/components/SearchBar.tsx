'use client';

import { useState, useCallback, type KeyboardEvent } from 'react';
import { useSearchStore } from '@/hooks/useSearchStore';
import type { GeocodeResult } from '@/types';

export default function SearchBar() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setMapCenter = useSearchStore((s) => s.setMapCenter);

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
      setMapCenter(data.center);
    } catch {
      setError('Network error');
    } finally {
      setIsSearching(false);
    }
  }, [query, setMapCenter]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search location..."
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 pl-10 text-sm text-white placeholder-neutral-500 outline-none transition focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
        />
        <svg
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
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
        className="rounded-lg bg-neutral-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isSearching ? 'Searching...' : 'Go'}
      </button>
      {error && (
        <span className="text-xs text-red-400">{error}</span>
      )}
    </div>
  );
}
