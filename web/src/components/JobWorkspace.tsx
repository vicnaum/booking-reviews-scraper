'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import type {
  PriceDisplayMode,
  ReviewJobResponse,
} from '@/types';
import { resolveComparablePrice } from '@/lib/pricing';
import { formatUsdCost, hasAiCosts } from '@/lib/aiCosts';
import {
  getBookingEligibilityRank,
  getListingResultsSnapshot,
} from '@/lib/results';
import {
  fetchReviewJobResponse,
  getStoredReviewJobPriceDisplay,
} from '@/lib/reviewJobClient';
import { useReviewJobPolling } from '@/hooks/useReviewJobPolling';
import {
  normalizeQualityBriefForComparison,
} from '@/lib/reviewJobEdits';
import AiBudgetNotice from './AiBudgetNotice';
import EvidenceGapBadge from './EvidenceGapBadge';
import ResultCard from './ResultCard';
import StaySnapshotStatus from './StaySnapshotStatus';
import PriceRefreshControls from './PriceRefreshControls';

const JobMap = dynamic(() => import('./JobMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-neutral-900 text-neutral-600">
      Loading map...
    </div>
  ),
});

function statusLabel(
  status: ReviewJobResponse['job']['status'],
  currentPhase: string,
  analysisStatus: ReviewJobResponse['job']['analysisStatus'],
  reportReady: boolean,
) {
  if (status === 'pending') return 'Pending';
  if (status === 'running') {
    return currentPhase === 'analysis' ? 'Analyzing' : 'Searching';
  }
  if (status === 'completed' && reportReady) return 'Results ready';
  if (status === 'completed' && analysisStatus === 'completed') return 'Analyzed';
  if (status === 'completed' && analysisStatus === 'partial') return 'Partial results';
  if (status === 'completed') return 'Ready';
  if (status === 'failed') return 'Failed';
  return 'Cancelled';
}

function statusClassName(status: ReviewJobResponse['job']['status']) {
  if (status === 'completed') {
    return 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100';
  }
  if (status === 'running' || status === 'pending') {
    return 'border-amber-300/20 bg-amber-300/10 text-amber-100';
  }
  return 'border-rose-300/20 bg-rose-300/10 text-rose-100';
}

function phaseStatusLabel(status: ReviewJobResponse['job']['analysisStatus']) {
  if (status === 'pending') return 'Not started';
  if (status === 'running') return 'Running';
  if (status === 'completed') return 'Completed';
  if (status === 'partial') return 'Partial';
  if (status === 'failed') return 'Failed';
  return 'Skipped';
}

function getEventDetailLine(
  event: ReviewJobResponse['events'][number],
): string | null {
  const payload =
    event.payload && typeof event.payload === 'object'
      ? event.payload
      : null;

  if (!payload || payload.kind !== 'review-pages') {
    return null;
  }

  const currentPage =
    typeof payload.currentPage === 'number' ? payload.currentPage : null;
  const totalPages =
    typeof payload.totalPages === 'number' ? payload.totalPages : null;
  const totalReviewsSoFar =
    typeof payload.totalReviewsSoFar === 'number' ? payload.totalReviewsSoFar : null;

  const parts: string[] = [];
  if (currentPage != null) {
    parts.push(
      totalPages != null
        ? `Page ${currentPage}/${totalPages}`
        : `Page ${currentPage}`,
    );
  }
  if (totalReviewsSoFar != null) {
    parts.push(`${totalReviewsSoFar} reviews captured`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

function getSelectedAnalysisSummary(result: ReviewJobResponse['listings'][number] | null) {
  const triage = result ? getListingResultsSnapshot(result).triage : null;
  if (!triage) {
    return null;
  }

  return {
    tier: triage.tier,
    fitScore: triage.fitScore,
    scoreSource: triage.scoreSource,
    rankingStatus: triage.rankingStatus,
    coverage: triage.coverage,
    affordability: triage.affordability,
    summary: triage.summary,
    highlights: triage.highlights,
    concerns: triage.concerns,
    dealBreakers: triage.dealBreakers,
    evidenceGaps: triage.evidenceGaps,
  };
}

function listingKey(listing: Pick<ReviewJobResponse['listings'][number], 'id' | 'platform'>) {
  return `${listing.platform}:${listing.id}`;
}

interface JobWorkspaceProps {
  initialData: ReviewJobResponse;
}

function analysisBudgetPayload(amountText: string, currencyText: string) {
  if (!amountText.trim()) {
    return {
      analysisBudgetAmount: null,
      analysisBudgetCurrency: null,
    };
  }
  const amount = Number(amountText);
  const currency = currencyText.trim().toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Analysis budget must be a positive full-stay amount.');
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error('Budget currency must be a three-letter code.');
  }
  return {
    analysisBudgetAmount: amount,
    analysisBudgetCurrency: currency,
  };
}

export default function JobWorkspace({ initialData }: JobWorkspaceProps) {
  const initialPrompt = initialData.job.prompt ?? '';
  const initialBudgetAmount =
    initialData.job.analysisBudgetAmount?.toString() ?? '';
  const initialBudgetCurrency =
    initialData.job.analysisBudgetCurrency
    ?? initialData.job.currency
    ?? 'USD';
  const [data, setData] = useState(initialData);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [priceDisplay, setPriceDisplay] = useState<PriceDisplayMode>(
    getStoredReviewJobPriceDisplay(initialData.job),
  );
  const [prompt, setPrompt] = useState(initialPrompt);
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt);
  const [budgetAmount, setBudgetAmount] = useState(initialBudgetAmount);
  const [savedBudgetAmount, setSavedBudgetAmount] = useState(
    initialBudgetAmount,
  );
  const [budgetCurrency, setBudgetCurrency] = useState(
    initialBudgetCurrency,
  );
  const [savedBudgetCurrency, setSavedBudgetCurrency] = useState(
    initialBudgetCurrency,
  );
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [isSavingSelection, setIsSavingSelection] = useState(false);
  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);
  const [isUpdatingSharing, setIsUpdatingSharing] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const applyJobUpdate = useCallback((nextData: ReviewJobResponse) => {
    const nextPrompt = nextData.job.prompt ?? '';
    const nextBudgetAmount =
      nextData.job.analysisBudgetAmount?.toString() ?? '';
    const nextBudgetCurrency =
      nextData.job.analysisBudgetCurrency
      ?? nextData.job.currency
      ?? 'USD';
    setData(nextData);
    setSavedPrompt(nextPrompt);
    setPrompt((currentPrompt) => (currentPrompt === savedPrompt ? nextPrompt : currentPrompt));
    setSavedBudgetAmount(nextBudgetAmount);
    setBudgetAmount((current) =>
      current === savedBudgetAmount ? nextBudgetAmount : current);
    setSavedBudgetCurrency(nextBudgetCurrency);
    setBudgetCurrency((current) =>
      current === savedBudgetCurrency ? nextBudgetCurrency : current);
  }, [savedBudgetAmount, savedBudgetCurrency, savedPrompt]);

  const refreshJob = useCallback(async () => {
    const nextData = await fetchReviewJobResponse(data.job.id);
    applyJobUpdate(nextData);
  }, [applyJobUpdate, data.job.id]);

  useReviewJobPolling(data.job, refreshJob, applyJobUpdate);

  const sortedResults = useMemo(() => {
    const nextResults = data.listings.filter((result) => !result.hidden);
    nextResults.sort((a, b) => {
      const eligibilityA = getBookingEligibilityRank(a);
      const eligibilityB = getBookingEligibilityRank(b);
      if (eligibilityA !== eligibilityB) {
        return eligibilityA - eligibilityB;
      }
      const aAmount = resolveComparablePrice(a, priceDisplay, {
        checkin: data.job.checkin,
        checkout: data.job.checkout,
      })?.amount;
      const bAmount = resolveComparablePrice(b, priceDisplay, {
        checkin: data.job.checkin,
        checkout: data.job.checkout,
      })?.amount;

      if (aAmount == null && bAmount == null) return 0;
      if (aAmount == null) return 1;
      if (bAmount == null) return -1;
      return aAmount - bAmount;
    });

    return nextResults;
  }, [data.job.checkin, data.job.checkout, data.listings, priceDisplay]);

  const selectedResult = useMemo(
    () =>
      selectedId != null
        ? sortedResults.find((result) => listingKey(result) === selectedId) ?? null
        : null,
    [selectedId, sortedResults],
  );

  const selectedListings = useMemo(
    () => sortedResults.filter((result) => result.selected),
    [sortedResults],
  );

  const selectedCount = selectedListings.length;
  const viewerCanEdit = data.job.viewerCanEdit;
  const analysisQueued = data.job.analysisCurrentPhase === 'queued';
  const analysisLocked =
    !viewerCanEdit
    || isStartingAnalysis
    || data.job.analysisStatus === 'running'
    || analysisQueued
    || data.job.priceRefreshStatus === 'running'
    || data.job.priceRefreshCurrentPhase === 'queued';
  const isPromptDirty =
    prompt !== savedPrompt
    || budgetAmount !== savedBudgetAmount
    || budgetCurrency !== savedBudgetCurrency;
  const qualityBriefDirty =
    normalizeQualityBriefForComparison(prompt)
    !== normalizeQualityBriefForComparison(savedPrompt);
  const qualityRegradeNeeded =
    data.job.regradeRequired
    || (
      qualityBriefDirty
      && (
        data.job.analysisStatus === 'completed'
        || data.job.analysisStatus === 'partial'
      )
    );

  const persistSelection = useCallback(
    async (
      nextSelectedListings: Array<Pick<ReviewJobResponse['listings'][number], 'id' | 'platform'>>,
      successMessage: string,
    ) => {
      setIsSavingSelection(true);
      setSaveMessage(null);

      try {
        const res = await fetch(`/api/jobs/${data.job.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedListings: nextSelectedListings.map((listing) => ({
              id: listing.id,
              platform: listing.platform,
            })),
          }),
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error || 'Failed to update selection');
        }

        const nextData: ReviewJobResponse = await res.json();
        const nextPrompt = nextData.job.prompt ?? '';
        const nextBudgetAmount =
          nextData.job.analysisBudgetAmount?.toString() ?? '';
        const nextBudgetCurrency =
          nextData.job.analysisBudgetCurrency
          ?? nextData.job.currency
          ?? 'USD';
        setData(nextData);
        setSavedPrompt(nextPrompt);
        setPrompt(nextPrompt);
        setSavedBudgetAmount(nextBudgetAmount);
        setBudgetAmount(nextBudgetAmount);
        setSavedBudgetCurrency(nextBudgetCurrency);
        setBudgetCurrency(nextBudgetCurrency);
        setSaveMessage(successMessage);
      } catch (error) {
        setSaveMessage(error instanceof Error ? error.message : 'Failed to update selection');
      } finally {
        setIsSavingSelection(false);
      }
    },
    [data.job.id],
  );

  const savePrompt = useCallback(async () => {
    if (!viewerCanEdit) {
      return;
    }

    setIsSavingPrompt(true);
    setSaveMessage(null);

    try {
      const budget = analysisBudgetPayload(
        budgetAmount,
        budgetCurrency,
      );
      const res = await fetch(`/api/jobs/${data.job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...budget }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to save prompt');
      }

      const nextData: ReviewJobResponse = await res.json();
      const nextPrompt = nextData.job.prompt ?? '';
      const nextBudgetAmount =
        nextData.job.analysisBudgetAmount?.toString() ?? '';
      const nextBudgetCurrency =
        nextData.job.analysisBudgetCurrency
        ?? nextData.job.currency
        ?? 'USD';
      setData(nextData);
      setSavedPrompt(nextPrompt);
      setPrompt(nextPrompt);
      setSavedBudgetAmount(nextBudgetAmount);
      setBudgetAmount(nextBudgetAmount);
      setSavedBudgetCurrency(nextBudgetCurrency);
      setBudgetCurrency(nextBudgetCurrency);
      setSaveMessage(
        nextData.job.regradeRequired
          ? 'Saved · quality regrade needed'
          : 'Saved',
      );
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Failed to save prompt');
    } finally {
      setIsSavingPrompt(false);
    }
  }, [
    budgetAmount,
    budgetCurrency,
    data.job.id,
    prompt,
    viewerCanEdit,
  ]);

  const startAnalysis = useCallback(async () => {
    if (!viewerCanEdit) {
      return;
    }

    setIsStartingAnalysis(true);
    setSaveMessage(null);

    try {
      const budget = analysisBudgetPayload(
        budgetAmount,
        budgetCurrency,
      );
      const saveRes = await fetch(`/api/jobs/${data.job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...budget }),
      });

      if (!saveRes.ok) {
        const payload = await saveRes.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to save prompt');
      }

      const savedData: ReviewJobResponse = await saveRes.json();
      const triageOnly =
        savedData.job.regradeRequired
        && savedData.job.artifactArchiveAvailable;
      const analyzeRes = await fetch(`/api/jobs/${data.job.id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: triageOnly ? 'triage' : 'full',
        }),
      });

      if (!analyzeRes.ok) {
        const payload = await analyzeRes.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to start analysis');
      }

      await refreshJob();
      setSaveMessage(
        triageOnly ? 'Whole-job quality regrade queued' : 'Analysis queued',
      );
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Failed to start analysis');
    } finally {
      setIsStartingAnalysis(false);
    }
  }, [
    budgetAmount,
    budgetCurrency,
    data.job.id,
    prompt,
    refreshJob,
    viewerCanEdit,
  ]);

  const setPublicSharing = useCallback(async (nextValue: boolean) => {
    if (!viewerCanEdit) {
      return;
    }

    setIsUpdatingSharing(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/jobs/${data.job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: nextValue }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to update public sharing');
      }

      const nextData: ReviewJobResponse = await res.json();
      const nextPrompt = nextData.job.prompt ?? '';
      setData(nextData);
      setSavedPrompt(nextPrompt);
      setPrompt(nextPrompt);
      setSaveMessage(nextValue ? 'Public link enabled' : 'Public link disabled');
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : 'Failed to update public sharing',
      );
    } finally {
      setIsUpdatingSharing(false);
    }
  }, [data.job.id, viewerCanEdit]);

  const copyShareLink = useCallback(async (target: 'job' | 'results') => {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(
      target === 'results' ? `/jobs/${data.job.id}/results` : `/jobs/${data.job.id}`,
      window.location.origin,
    ).toString();

    try {
      await navigator.clipboard.writeText(url);
      setSaveMessage(target === 'results' ? 'Copied public results link' : 'Copied public job link');
    } catch {
      setSaveMessage('Failed to copy link');
    }
  }, [data.job.id]);

  const toggleListingSelection = useCallback(
    async (target: ReviewJobResponse['listings'][number]) => {
      const activeKeys = new Set(selectedListings.map((listing) => listingKey(listing)));
      const targetKey = listingKey(target);
      if (activeKeys.has(targetKey)) {
        activeKeys.delete(targetKey);
      } else {
        activeKeys.add(targetKey);
      }

      const nextSelectedListings = sortedResults.filter((listing) => activeKeys.has(listingKey(listing)));
      await persistSelection(
        nextSelectedListings,
        nextSelectedListings.length > 0
          ? `Selected ${nextSelectedListings.length} listing${nextSelectedListings.length === 1 ? '' : 's'} for analysis`
          : 'Selection cleared',
      );
    },
    [persistSelection, selectedListings, sortedResults],
  );

  const selectAllVisible = useCallback(async () => {
    await persistSelection(sortedResults, `Selected all ${sortedResults.length} listings for analysis`);
  }, [persistSelection, sortedResults]);

  const clearSelection = useCallback(async () => {
    await persistSelection([], 'Selection cleared');
  }, [persistSelection]);

  const resultCardContext = {
    priceDisplay,
    checkin: data.job.checkin,
    checkout: data.job.checkout,
    adults: data.job.adults,
    currency: data.job.currency,
  };
  const selectedAnalysisSummary = getSelectedAnalysisSummary(selectedResult);
  const canStartAnalysis =
    sortedResults.length > 0
    && (data.job.status === 'completed' || data.job.status === 'failed')
    && data.job.analysisStatus !== 'running'
    && !analysisQueued
    && data.job.priceRefreshStatus !== 'running'
    && data.job.priceRefreshCurrentPhase !== 'queued'
    && !isSavingSelection;
  const analysisButtonLabel =
    analysisQueued
      ? 'Analysis queued...'
      : qualityRegradeNeeded && data.job.artifactArchiveAvailable
        ? `Regrade quality (${sortedResults.length} listings)`
      : data.job.analysisStatus === 'completed' || data.job.analysisStatus === 'partial'
      ? selectedCount > 0
        ? `Re-run analysis (${selectedCount} selected)`
        : `Re-run analysis (${sortedResults.length} listings)`
      : data.job.analysisStatus === 'running'
        ? 'Analysis running...'
        : selectedCount > 0
          ? `Analyze selected (${selectedCount})`
          : `Analyze all (${sortedResults.length})`;

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(255,107,95,0.18),transparent_48%)]" />

      <header className="relative z-10 px-4 pt-4 md:px-5">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 rounded-[28px] border border-white/10 bg-black/[0.28] px-4 py-4 shadow-[0_24px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                Review Job
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                {data.job.location || 'Saved search'}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-stone-400">
                Persistent workspace for the selected search area. This page only shows
                saved listings from the full search job.
              </p>
            </div>

            <div className="flex flex-col items-start gap-2 lg:items-end">
              <span
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  data.job.regradeRequired
                    ? 'border-amber-300/20 bg-amber-300/10 text-amber-100'
                    : statusClassName(data.job.status)
                }`}
              >
                {data.job.regradeRequired
                  ? 'Regrade needed'
                  : statusLabel(
                      data.job.status,
                      data.job.currentPhase,
                      data.job.analysisStatus,
                      data.job.reportReady,
                    )}
              </span>
              <span className="text-xs text-stone-500">Job ID: {data.job.id}</span>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Search Context</p>
                  <p className="mt-1 text-xs text-stone-500">
                    {data.job.checkin || 'Flexible dates'} → {data.job.checkout || 'open'} · {data.job.adults} guests · {data.job.currency}
                  </p>
                </div>
                <div className="flex rounded-xl border border-white/10 bg-black/20 p-1">
                  {(['total', 'perNight'] as PriceDisplayMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setPriceDisplay(mode)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        priceDisplay === mode
                          ? 'bg-white text-neutral-950 shadow-sm'
                          : 'text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      {mode === 'perNight' ? 'Per night' : 'Total'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-400">
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                  Area mode: {data.job.searchAreaMode}
                </span>
                {data.job.poi && (
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                    POI saved
                  </span>
                )}
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                  {data.job.totalResults} listings
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                  {data.job.pagesScanned} pages scanned
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                  Analysis:{' '}
                  {data.job.regradeRequired
                    ? 'Regrade needed'
                    : phaseStatusLabel(data.job.analysisStatus)}
                </span>
                {hasAiCosts(data.job.costs) && (
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                    AI cost: {formatUsdCost(data.job.costs.totalUsd)}
                  </span>
                )}
                {data.job.aiCostBudgetUsd != null && (
                  <span
                    className={`rounded-full border px-3 py-1.5 ${
                      data.job.aiCostBudgetExceeded
                        ? 'border-amber-300/25 bg-amber-300/10 text-amber-100'
                        : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    AI budget: {formatUsdCost(data.job.aiCostBudgetUsd)}
                  </span>
                )}
              </div>
              {(data.job.status === 'pending' || data.job.status === 'running') && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs font-medium text-stone-400">
                    <span>{data.job.currentPhase}</span>
                    <span>{Math.round(data.job.progress * 100)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#3bcf93,#88e2bc)] transition-all"
                      style={{ width: `${Math.max(4, Math.round(data.job.progress * 100))}%` }}
                    />
                  </div>
                </div>
              )}
              {(data.job.analysisStatus === 'pending' || data.job.analysisStatus === 'running') && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs font-medium text-stone-400">
                    <span>{data.job.analysisCurrentPhase || 'analysis'}</span>
                    <span>{Math.round(data.job.analysisProgress * 100)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#ff8b6e,#ffd18a)] transition-all"
                      style={{ width: `${Math.max(4, Math.round(data.job.analysisProgress * 100))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Analysis Brief</p>
                  <p className="mt-1 text-xs text-stone-500">
                    Saved quality preferences and the separate full-stay budget feed analysis.
                  </p>
                </div>
                <button
                  onClick={() => {
                    void savePrompt();
                  }}
                    disabled={isSavingPrompt || analysisLocked}
                    className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                  {isSavingPrompt ? 'Saving…' : 'Save setup'}
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={5}
                placeholder="Describe what matters for this stay: work setup, quietness, walkability to POI, kitchen needs, deal-breakers, budget tradeoffs..."
                className="mt-3 w-full rounded-2xl border border-white/10 bg-black/[0.18] px-4 py-3 text-sm text-white outline-none transition placeholder:text-stone-500 focus:border-[#ff6b5f]/35 focus:bg-black/30"
                disabled={analysisLocked || isSavingPrompt || isStartingAnalysis}
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                <label className="text-xs text-stone-400">
                  Full-stay analysis budget
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={budgetAmount}
                    onChange={(event) => setBudgetAmount(event.target.value)}
                    placeholder="Optional, e.g. 4500"
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/[0.18] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-stone-600 focus:border-[#ff6b5f]/35"
                    disabled={analysisLocked || isSavingPrompt || isStartingAnalysis}
                  />
                </label>
                <label className="text-xs text-stone-400">
                  Currency
                  <input
                    type="text"
                    maxLength={3}
                    value={budgetCurrency}
                    onChange={(event) =>
                      setBudgetCurrency(event.target.value.toUpperCase())}
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/[0.18] px-3 py-2.5 text-sm uppercase text-white outline-none transition focus:border-[#ff6b5f]/35"
                    disabled={analysisLocked || isSavingPrompt || isStartingAnalysis}
                  />
                </label>
              </div>
              <p className="mt-2 text-xs leading-5 text-stone-500">
                Price never changes the quality tier. It appears separately as within budget,
                over by a percentage, or unknown with a reason.
              </p>
              {qualityRegradeNeeded && (
                <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.08] px-3 py-2.5 text-xs leading-5 text-amber-100/80">
                  The saved verdicts reflect the previous quality brief.
                  Their paid evidence remains available, but a whole-job
                  triage regrade is required before peer comparison.
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-stone-500">
                  {saveMessage
                    ?? (
                      analysisLocked
                        ? (viewerCanEdit
                          ? 'Brief, budget, and selection are locked while analysis is queued or running.'
                          : 'Shared view is read-only. Ask the owner to edit the setup or run analysis.')
                        : isPromptDirty
                        ? 'Unsaved analysis setup changes'
                        : selectedCount > 0
                        ? `Only the ${selectedCount} selected listing${selectedCount === 1 ? '' : 's'} will be analyzed.`
                        : `No shortlist yet, so analysis will run on all ${sortedResults.length} listings.`
                    )}
                </span>
                <div className="flex items-center gap-2">
                  {data.job.artifactArchiveAvailable && (
                    <a
                      href={`/api/jobs/${data.job.id}/artifacts`}
                      className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/[0.1]"
                    >
                      Download artifacts
                    </a>
                  )}
                  {data.job.reportReady && (
                    <Link
                      href={`/jobs/${data.job.id}/results`}
                      className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-300/15"
                    >
                      Open results
                    </Link>
                  )}
                  {viewerCanEdit && (
                    <button
                      onClick={() => {
                        void startAnalysis();
                      }}
                      disabled={!canStartAnalysis || isStartingAnalysis}
                      className="rounded-2xl border border-white/10 bg-[#ff6b5f]/12 px-4 py-2 text-xs font-semibold text-[#ffcabf] transition hover:bg-[#ff6b5f]/18 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.03] disabled:text-stone-500"
                    >
                      {isStartingAnalysis ? 'Queueing…' : analysisButtonLabel}
                    </button>
                  )}
                </div>
              </div>
              {hasAiCosts(data.job.costs) && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-400">
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-stone-200">
                    Total AI spend {formatUsdCost(data.job.costs.totalUsd)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    Reviews {formatUsdCost(data.job.costs.aiReviewsUsd)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    Photos {formatUsdCost(data.job.costs.aiPhotosUsd)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    Triage {formatUsdCost(data.job.costs.triageUsd)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <AiBudgetNotice job={data.job} />
          <PriceRefreshControls
            job={data.job}
            selectedListings={selectedListings}
            onQueued={refreshJob}
          />

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Sharing</p>
                <p className="mt-1 text-xs text-stone-500">
                  Public sharing exposes this job and its results without the owner cookie,
                  but keeps editing and analysis owner-only.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    data.job.isPublic
                      ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100'
                      : 'border-white/10 bg-white/[0.04] text-stone-400'
                  }`}
                >
                  {data.job.isPublic ? 'Public link enabled' : 'Private'}
                </span>
                {viewerCanEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      void setPublicSharing(!data.job.isPublic);
                    }}
                    disabled={isUpdatingSharing}
                    className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isUpdatingSharing
                      ? 'Updating…'
                      : data.job.isPublic
                        ? 'Disable public link'
                        : 'Enable public link'}
                  </button>
                )}
                {data.job.isPublic && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void copyShareLink('job');
                      }}
                      className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/[0.1]"
                    >
                      Copy job link
                    </button>
                    {data.job.reportReady && (
                      <button
                        type="button"
                        onClick={() => {
                          void copyShareLink('results');
                        }}
                        className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/[0.1]"
                      >
                        Copy results link
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex flex-1 px-4 pb-4 pt-3 md:px-5">
        <div className="mx-auto grid h-[calc(100vh-16rem)] w-full max-w-[1680px] min-h-[34rem] grid-cols-[360px_minmax(0,1fr)_320px] gap-0 overflow-hidden rounded-[30px] border border-white/10 bg-black/[0.24] shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-[linear-gradient(180deg,rgba(20,16,13,0.94),rgba(14,12,10,0.92))] p-3">
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="text-sm font-semibold text-stone-100">
                Listings
                <span className="ml-1 text-stone-500">({sortedResults.length})</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-500">
                  {selectedCount > 0 ? `${selectedCount} selected` : (data.job.status === 'completed' ? 'Saved set' : 'Updating')}
                </span>
                {viewerCanEdit && sortedResults.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      void selectAllVisible();
                    }}
                    disabled={analysisLocked || isSavingSelection || selectedCount === sortedResults.length}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-stone-300 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Select all
                  </button>
                )}
                {viewerCanEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      void clearSelection();
                    }}
                    disabled={analysisLocked || isSavingSelection || selectedCount === 0}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-stone-300 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {sortedResults.map((result) => (
                <ResultCard
                  key={`${result.platform}:${result.id}`}
                  result={result}
                  isSelected={selectedId === listingKey(result)}
                  onClick={() => setSelectedId(selectedId === listingKey(result) ? null : listingKey(result))}
                  selectionControl={viewerCanEdit ? {
                    active: result.selected,
                    label: result.selected ? 'Selected for analysis' : 'Select for analysis',
                    onToggle: () => {
                      void toggleListingSelection(result);
                    },
                    disabled: analysisLocked || isSavingSelection,
                  } : undefined}
                  context={resultCardContext}
                />
              ))}
            </div>
          </aside>

          <main className="relative flex min-h-0 items-center justify-center overflow-hidden bg-black/[0.08] p-3 md:p-5">
            <div
              className="relative aspect-square max-w-full overflow-hidden rounded-[26px] border border-white/10 bg-black/[0.18]"
              style={{ width: 'min(100%, calc(100vh - 16rem))' }}
            >
              <JobMap
                results={sortedResults}
                selectedId={selectedId}
                onSelect={setSelectedId}
                searchAreaMode={data.job.searchAreaMode}
                boundingBox={data.job.boundingBox}
                mapBounds={data.job.mapBounds}
                circle={data.job.circle}
                poi={data.job.poi}
                mapCenter={data.job.mapCenter}
                mapZoom={data.job.mapZoom}
                priceDisplay={priceDisplay}
                checkin={data.job.checkin}
                checkout={data.job.checkout}
              />
            </div>
          </main>

          <aside className="min-h-0 overflow-y-auto border-l border-white/10 bg-[linear-gradient(180deg,rgba(18,15,13,0.94),rgba(12,10,9,0.92))] p-4">
            {selectedResult && (
              <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm font-semibold text-white">
                  {selectedResult.name}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {selectedResult.platform} listing
                  {selectedResult.poiDistanceMeters != null && (
                    <> · {Math.round(selectedResult.poiDistanceMeters)}m from POI</>
                  )}
                </p>
                <div className="mt-3">
                  <StaySnapshotStatus
                    snapshot={selectedResult.staySnapshot}
                    compact
                  />
                </div>

                {selectedAnalysisSummary ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {selectedAnalysisSummary.rankingStatus === 'insufficient_evidence' ? (
                        <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 font-semibold uppercase tracking-[0.14em] text-amber-100">
                          Insufficient evidence
                        </span>
                      ) : selectedAnalysisSummary.tier && (
                        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 font-semibold uppercase tracking-[0.14em] text-emerald-100">
                          {selectedAnalysisSummary.tier.replace(/_/g, ' ')}
                        </span>
                      )}
                      {selectedAnalysisSummary.scoreSource === 'model_legacy' && (
                        <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2.5 py-1 font-semibold text-violet-100">
                          Legacy AI score
                        </span>
                      )}
                      {selectedAnalysisSummary.scoreSource === 'deterministic_rubric' && (
                        <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2.5 py-1 font-semibold text-sky-100">
                          {Math.round((selectedAnalysisSummary.coverage ?? 0) * 100)}% coverage
                        </span>
                      )}
                      <EvidenceGapBadge gaps={selectedAnalysisSummary.evidenceGaps} />
                      {selectedAnalysisSummary.fitScore != null && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-medium text-stone-300">
                          Fit {selectedAnalysisSummary.fitScore}
                        </span>
                      )}
                      {selectedAnalysisSummary.affordability?.status === 'within' && (
                        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 font-semibold text-emerald-100">
                          Within budget
                        </span>
                      )}
                      {selectedAnalysisSummary.affordability?.status === 'over' && (
                        <span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-2.5 py-1 font-semibold text-orange-100">
                          {Math.round(selectedAnalysisSummary.affordability.overByPercent ?? 0)}% over budget
                        </span>
                      )}
                      {selectedAnalysisSummary.affordability?.status === 'unknown' && (
                        <span
                          className="rounded-full border border-stone-300/20 bg-stone-300/10 px-2.5 py-1 font-semibold text-stone-200"
                          title={selectedAnalysisSummary.affordability.reason ?? undefined}
                        >
                          Budget unknown · {selectedAnalysisSummary.affordability.reason ?? 'Reason unavailable.'}
                        </span>
                      )}
                    </div>
                    {selectedAnalysisSummary.summary && (
                      <p className="text-sm leading-6 text-stone-200">
                        {selectedAnalysisSummary.summary}
                      </p>
                    )}
                    {selectedAnalysisSummary.highlights.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                          Highlights
                        </p>
                        <ul className="mt-2 space-y-2 text-sm text-stone-300">
                          {selectedAnalysisSummary.highlights.slice(0, 3).map((item) => (
                            <li key={item}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedAnalysisSummary.concerns.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                          Concerns
                        </p>
                        <ul className="mt-2 space-y-2 text-sm text-stone-300">
                          {selectedAnalysisSummary.concerns.slice(0, 3).map((item) => (
                            <li key={item}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedAnalysisSummary.dealBreakers.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-300/70">
                          Deal-breakers
                        </p>
                        <ul className="mt-2 space-y-2 text-sm text-rose-100">
                          {selectedAnalysisSummary.dealBreakers.slice(0, 3).map((item) => (
                            <li key={item}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedResult.analysis && hasAiCosts(selectedResult.analysis.costs) && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                          AI cost
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-300">
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            Total {formatUsdCost(selectedResult.analysis.costs.totalUsd)}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            Reviews {formatUsdCost(selectedResult.analysis.costs.aiReviewsUsd)}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            Photos {formatUsdCost(selectedResult.analysis.costs.aiPhotosUsd)}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            Triage {formatUsdCost(selectedResult.analysis.costs.triageUsd)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-stone-500">
                    {selectedResult.analysis
                      ? `Analysis phase: ${selectedResult.analysis.currentPhase} (${selectedResult.analysis.status})`
                      : 'Analysis has not run for this listing yet.'}
                  </div>
                )}
              </div>
            )}

            <div className="mb-3">
              <p className="text-sm font-semibold text-white">Job timeline</p>
              <p className="mt-1 text-xs text-stone-500">
                Search and analysis events persist here, so the job can be reopened later.
              </p>
            </div>
            <div className="space-y-3">
              {data.events.length > 0 ? (
                data.events.map((event) => {
                  const detailLine = getEventDetailLine(event);
                  return (
                    <div
                      key={event.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                          {event.phase}
                        </span>
                        <span className="text-[11px] text-stone-500">
                          {new Date(event.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-stone-100">{event.message}</p>
                      {detailLine && (
                        <p className="mt-1 text-xs text-stone-500">
                          {detailLine}
                        </p>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                  No events yet.
                </div>
              )}

              {selectedResult && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-sm font-semibold text-white">Selected listing</p>
                  <p className="mt-2 text-sm text-stone-300">{selectedResult.name}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    {selectedResult.platform} · {selectedResult.reviewCount} reviews
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
