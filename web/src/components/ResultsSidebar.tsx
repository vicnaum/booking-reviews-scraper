'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useSearchStore } from '@/hooks/useSearchStore';
import ResultCard from './ResultCard';

export default function ResultsSidebar() {
  const results = useSearchStore((s) => s.results);
  const selectedId = useSearchStore((s) => s.selectedId);
  const selectResult = useSearchStore((s) => s.selectResult);
  const isLoading = useSearchStore((s) => s.isLoading);
  const searchError = useSearchStore((s) => s.searchError);
  const lastSearchMs = useSearchStore((s) => s.lastSearchMs);
  const platform = useSearchStore((s) => s.platform);
  const zoom = useSearchStore((s) => s.zoom);

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll to selected card when marker is clicked
  useEffect(() => {
    if (selectedId) {
      const el = cardRefs.current.get(selectedId);
      if (el && listRef.current) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedId]);

  const setCardRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) cardRefs.current.set(id, el);
      else cardRefs.current.delete(id);
    },
    [],
  );

  return (
    <aside className="hidden w-80 flex-shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 md:flex">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-300">
            Results
            {results.length > 0 && (
              <span className="ml-1 text-neutral-500">({results.length})</span>
            )}
          </span>
          {isLoading && (
            <div className="h-3 w-3 animate-spin rounded-full border border-neutral-600 border-t-neutral-300" />
          )}
        </div>
        {lastSearchMs != null && !isLoading && (
          <span className="text-xs text-neutral-600">
            {(lastSearchMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Results list */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-2">
        {searchError && (
          <div className="rounded-lg bg-red-950/50 p-3 text-xs text-red-400">
            {searchError}
          </div>
        )}

        {results.length > 0 ? (
          results.map((r) => (
            <ResultCard
              key={r.id}
              ref={setCardRef(r.id)}
              result={r}
              isSelected={r.id === selectedId}
              onClick={() => selectResult(r.id === selectedId ? null : r.id)}
            />
          ))
        ) : !isLoading && !searchError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-2xl mb-2">
              {platform === 'airbnb' ? '🏠' : '🏨'}
            </div>
            <p className="text-sm text-neutral-500">
              {zoom < 12
                ? 'Zoom in to search for listings'
                : 'No results in this area'}
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
