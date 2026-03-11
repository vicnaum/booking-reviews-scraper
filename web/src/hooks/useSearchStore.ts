'use client';

import { create } from 'zustand';
import type {
  BoundingBox,
  FullSearchRequest,
  Platform,
  QuickSearchRequest,
  SearchJobStatus,
  SearchJobResponse,
  SearchResult,
  StartSearchResponse,
} from '@/types';
import type { PriceDisplay } from '@/lib/format';

const MIN_SEARCH_ZOOM = 12;
const JOB_POLL_INTERVAL_MS = 2000;

interface SearchStore {
  // Platform & filters
  platform: Platform;
  checkin: string | null;
  checkout: string | null;
  adults: number;
  currency: string;
  priceMin: number | null;
  priceMax: number | null;
  minRating: number | null;
  propertyType: string | null;
  priceDisplay: PriceDisplay;
  airbnbFilters: { superhost?: boolean; instantBook?: boolean };
  bookingFilters: { stars?: number[]; freeCancellation?: boolean };

  // Map state
  viewportBbox: BoundingBox | null;
  userBbox: BoundingBox | null;
  zoom: number;
  mapCenter: { lat: number; lng: number } | null;

  // Results
  results: SearchResult[];
  isLoading: boolean;
  searchError: string | null;
  lastSearchMs: number | null;
  activeJobId: string | null;
  jobStatus: SearchJobStatus | null;
  jobProgress: number;
  jobPagesScanned: number;
  jobResultCount: number;
  selectedId: string | null;

  // Actions
  setPlatform: (p: Platform) => void;
  setFilter: (key: string, value: unknown) => void;
  setViewport: (bbox: BoundingBox, zoom: number) => void;
  setMapCenter: (center: { lat: number; lng: number }) => void;
  setResults: (results: SearchResult[]) => void;
  setIsLoading: (loading: boolean) => void;
  selectResult: (id: string | null) => void;
  setUserBbox: (bbox: BoundingBox | null) => void;
  setActiveJob: (
    jobId: string | null,
    progress?: number,
    status?: SearchJobStatus | null,
  ) => void;
  triggerQuickSearch: () => Promise<void>;
  startFullSearch: () => Promise<void>;
}

type SearchRequestState = Pick<
  SearchStore,
  | 'platform'
  | 'checkin'
  | 'checkout'
  | 'adults'
  | 'currency'
  | 'priceMin'
  | 'priceMax'
  | 'minRating'
  | 'propertyType'
  | 'airbnbFilters'
  | 'bookingFilters'
>;

let currentAbortController: AbortController | null = null;
let currentJobPollTimeout: ReturnType<typeof setTimeout> | null = null;

function clearJobPolling() {
  if (currentJobPollTimeout) {
    clearTimeout(currentJobPollTimeout);
    currentJobPollTimeout = null;
  }
}

function buildSearchRequest(
  state: SearchRequestState,
  bbox: BoundingBox,
): FullSearchRequest {
  return {
    platform: state.platform,
    boundingBox: bbox,
    checkin: state.checkin ?? undefined,
    checkout: state.checkout ?? undefined,
    adults: state.adults,
    currency: state.currency,
    priceMin: state.priceMin ?? undefined,
    priceMax: state.priceMax ?? undefined,
    minRating: state.minRating ?? undefined,
    propertyType: state.propertyType ?? undefined,
    exhaustive: true,
    ...(state.platform === 'airbnb' ? state.airbnbFilters : {}),
    ...(state.platform === 'booking' ? state.bookingFilters : {}),
  };
}

export const useSearchStore = create<SearchStore>((set, get) => {
  const pollJob = async (jobId: string): Promise<void> => {
    try {
      const res = await fetch(`/api/search/${jobId}`, { cache: 'no-store' });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to load job status');
      }

      const data: SearchJobResponse = await res.json();

      if (data.job.status === 'completed') {
        clearJobPolling();
        set({
          activeJobId: null,
          jobStatus: data.job.status,
          jobProgress: 1,
          jobPagesScanned: data.job.pagesScanned,
          jobResultCount: data.job.totalResults,
          isLoading: false,
          searchError: null,
          results: data.results,
          lastSearchMs: data.job.durationMs,
        });
        return;
      }

      if (data.job.status === 'failed' || data.job.status === 'cancelled') {
        clearJobPolling();
        set({
          activeJobId: null,
          jobStatus: data.job.status,
          jobProgress: 0,
          jobPagesScanned: data.job.pagesScanned,
          jobResultCount: data.job.totalResults,
          isLoading: false,
          searchError: data.job.errorMessage || 'Full search failed',
        });
        return;
      }

      set({
        activeJobId: data.job.id,
        jobStatus: data.job.status,
        jobProgress: data.job.progress,
        jobPagesScanned: data.job.pagesScanned,
        jobResultCount: data.job.totalResults,
        isLoading: false,
        searchError: null,
      });

      clearJobPolling();
      currentJobPollTimeout = setTimeout(() => {
        void pollJob(jobId);
      }, JOB_POLL_INTERVAL_MS);
    } catch (err: unknown) {
      clearJobPolling();
      set({
        activeJobId: null,
        jobStatus: 'failed',
        jobProgress: 0,
        jobPagesScanned: 0,
        jobResultCount: 0,
        isLoading: false,
        searchError:
          err instanceof Error ? err.message : 'Failed to poll full search job',
      });
    }
  };

  return {
    platform: 'airbnb',
    checkin: null,
    checkout: null,
    adults: 2,
    currency: 'USD',
    priceMin: null,
    priceMax: null,
    minRating: null,
    propertyType: null,
    priceDisplay: 'perNight' as PriceDisplay,
    airbnbFilters: {},
    bookingFilters: {},

    viewportBbox: null,
    userBbox: null,
    zoom: 3,
    mapCenter: null,

    results: [],
    isLoading: false,
    searchError: null,
    lastSearchMs: null,
    activeJobId: null,
    jobStatus: null,
    jobProgress: 0,
    jobPagesScanned: 0,
    jobResultCount: 0,
    selectedId: null,

    setPlatform: (p) => {
      set({
        platform: p,
        results: [],
        selectedId: null,
        searchError: null,
        airbnbFilters: {},
        bookingFilters: {},
      });
      void get().triggerQuickSearch();
    },

    setFilter: (key, value) => {
      set((state) => ({ ...state, [key]: value }));
    },

    setViewport: (bbox, zoom) => set({ viewportBbox: bbox, zoom }),

    setMapCenter: (center) => set({ mapCenter: center }),

    setResults: (results) => set({ results, isLoading: false }),

    setIsLoading: (loading) => set({ isLoading: loading }),

    selectResult: (id) => set({ selectedId: id }),

    setUserBbox: (bbox) => set({ userBbox: bbox }),

    setActiveJob: (jobId, progress = 0, status = null) =>
      set({ activeJobId: jobId, jobProgress: progress, jobStatus: status }),

    triggerQuickSearch: async () => {
      const state = get();
      const bbox = state.userBbox ?? state.viewportBbox;

      if (state.activeJobId || !bbox || state.zoom < MIN_SEARCH_ZOOM) {
        return;
      }

      if (currentAbortController) {
        currentAbortController.abort();
      }

      const abortController = new AbortController();
      currentAbortController = abortController;

      set({ isLoading: true, searchError: null });

      try {
        const body: QuickSearchRequest = buildSearchRequest(state, bbox);

        const res = await fetch('/api/quick-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abortController.signal,
        });

        if (abortController.signal.aborted) return;

        if (!res.ok) {
          const data = await res.json();
          set({
            isLoading: false,
            jobStatus: null,
            searchError: data.error || 'Search failed',
          });
          return;
        }

        const data = await res.json();
        set({
          results: data.results,
          isLoading: false,
          lastSearchMs: data.durationMs,
          searchError: null,
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;

        set({
          isLoading: false,
          searchError: err instanceof Error ? err.message : 'Search failed',
        });
      }
    },

    startFullSearch: async () => {
      const state = get();
      const bbox = state.userBbox ?? state.viewportBbox;

      if (!bbox || state.zoom < MIN_SEARCH_ZOOM || state.activeJobId) {
        return;
      }

      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }

      clearJobPolling();
      set({
        isLoading: false,
        searchError: null,
        activeJobId: null,
        jobStatus: 'pending',
        jobProgress: 0,
        jobPagesScanned: 0,
        jobResultCount: 0,
      });

      try {
        const body = buildSearchRequest(state, bbox);

        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json();
          set({
            isLoading: false,
            jobStatus: 'failed',
            searchError: data.error || 'Failed to start full search',
          });
          return;
        }

        const data: StartSearchResponse = await res.json();
        set({
          activeJobId: data.jobId,
          jobStatus: data.status,
          jobProgress: 0,
          jobPagesScanned: 0,
          jobResultCount: 0,
          isLoading: false,
          searchError: null,
        });

        void pollJob(data.jobId);
      } catch (err: unknown) {
        clearJobPolling();
        set({
          activeJobId: null,
          jobStatus: 'failed',
          jobProgress: 0,
          jobPagesScanned: 0,
          jobResultCount: 0,
          isLoading: false,
          searchError:
            err instanceof Error
              ? err.message
              : 'Failed to start full search',
        });
      }
    },
  };
});
