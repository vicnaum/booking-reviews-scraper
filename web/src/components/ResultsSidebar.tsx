'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useSearchStore } from '@/hooks/useSearchStore';
import type { ExportSearchRequest } from '@/types';
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
  const activeJobId = useSearchStore((s) => s.activeJobId);
  const completedJobId = useSearchStore((s) => s.completedJobId);
  const jobProgress = useSearchStore((s) => s.jobProgress);

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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

  const handleExport = useCallback(async () => {
    if (!completedJobId) return;

    setIsExporting(true);
    setExportError(null);

    try {
      const body: ExportSearchRequest = { jobId: completedJobId };
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to export URLs');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const contentDisposition = res.headers.get('content-disposition');
      const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
      link.href = url;
      link.download = filenameMatch?.[1] || 'stayreviewr-urls.txt';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : 'Failed to export URLs',
      );
    } finally {
      setIsExporting(false);
    }
  }, [completedJobId]);

  return (
    <aside className="hidden w-[360px] flex-shrink-0 flex-col border-r border-white/10 bg-[linear-gradient(180deg,rgba(20,16,13,0.94),rgba(14,12,10,0.92))] md:flex">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-stone-100">
            Results
            {results.length > 0 && (
              <span className="ml-1 text-stone-500">({results.length})</span>
            )}
          </span>
          {isLoading && (
            <div className="h-3 w-3 animate-spin rounded-full border border-stone-600 border-t-stone-200" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {completedJobId && results.length > 0 && !activeJobId && (
            <button
              onClick={() => {
                void handleExport();
              }}
              disabled={isExporting}
              className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-stone-200 transition-colors hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExporting ? 'Exporting…' : 'Export URLs'}
            </button>
          )}
          {lastSearchMs != null && !isLoading && (
            <span className="text-xs font-medium text-stone-500">
              {(lastSearchMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      </div>

      {activeJobId && (
        <div className="border-b border-white/10 px-5 py-4">
          <div className="flex items-center justify-between text-xs font-medium text-stone-400">
            <span>Full search job running</span>
            <span>{Math.round(jobProgress * 100)}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#3bcf93,#88e2bc)] transition-all"
              style={{ width: `${Math.max(4, Math.round(jobProgress * 100))}%` }}
            />
          </div>
        </div>
      )}

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {searchError && (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-950/40 p-4 text-xs text-rose-200">
            {searchError}
          </div>
        )}

        {exportError && (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-950/40 p-4 text-xs text-rose-200">
            {exportError}
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
            <div className="mb-3 text-3xl">
              {platform === 'airbnb' ? '🏠' : '🏨'}
            </div>
            <p className="max-w-[18rem] text-sm leading-6 text-stone-500">
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
