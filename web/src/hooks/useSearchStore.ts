'use client';

import { create } from 'zustand';
import type {
  BoundingBox,
  CircleFilter,
  CreateReviewJobRequest,
  CreateReviewJobResponse,
  FullSearchRequest,
  GeocodeResult,
  MapPoint,
  Platform,
  QuickSearchRequest,
  SearchJobStatus,
  SearchResult,
} from '@/types';
import type { PriceDisplay } from '@/lib/format';

const MIN_SEARCH_ZOOM = 12;

interface QuickSearchOptions {
  force?: boolean;
  bbox?: BoundingBox;
}

interface BuildSearchRequestOptions {
  circle?: CircleFilter | null;
}

interface SearchStore {
  // Platform & filters
  platform: Platform;
  locationQuery: string | null;
  useLocationSearch: boolean;
  checkin: string | null;
  checkout: string | null;
  adults: number;
  currency: string;
  priceMin: number | null;
  priceMax: number | null;
  minRating: number | null;
  minBedrooms: number | null;
  minBeds: number | null;
  propertyType: string | null;
  priceDisplay: PriceDisplay;
  airbnbFilters: { superhost?: boolean; instantBook?: boolean };
  bookingFilters: { stars?: number[]; freeCancellation?: boolean };

  // Map state
  viewportBbox: BoundingBox | null;
  userBbox: BoundingBox | null;
  circleFilter: CircleFilter | null;
  poi: MapPoint | null;
  drawMode: 'rectangle' | 'circle' | 'poi' | null;
  zoom: number;
  mapBounds: BoundingBox | null;
  mapCenter: MapPoint | null;
  mapFocusId: number;
  hasInitializedSearch: boolean;
  autoUpdate: boolean;
  fullSearchMode: 'window' | 'rectangle' | 'circle';
  pendingViewportSearch: boolean;
  pendingProgrammaticSearch: boolean;

  // Results
  results: SearchResult[];
  isLoading: boolean;
  searchError: string | null;
  lastSearchMs: number | null;
  activeJobId: string | null;
  completedJobId: string | null;
  jobStatus: SearchJobStatus | null;
  jobProgress: number;
  jobPagesScanned: number;
  jobResultCount: number;
  selectedId: string | null;

  // Actions
  setPlatform: (p: Platform) => void;
  setFilter: (key: string, value: unknown) => void;
  setUseLocationSearch: (enabled: boolean) => void;
  setDrawMode: (mode: 'rectangle' | 'circle' | 'poi' | null) => void;
  setViewport: (bbox: BoundingBox, zoom: number) => void;
  setMapCenter: (center: MapPoint) => void;
  setFullSearchMode: (mode: 'window' | 'rectangle' | 'circle') => void;
  setAutoUpdate: (enabled: boolean) => void;
  setPendingViewportSearch: (pending: boolean) => void;
  setPendingProgrammaticSearch: (pending: boolean) => void;
  setResults: (results: SearchResult[]) => void;
  setIsLoading: (loading: boolean) => void;
  selectResult: (id: string | null) => void;
  setUserBbox: (bbox: BoundingBox | null) => void;
  setCircleFilter: (circle: CircleFilter | null) => void;
  setPoi: (point: MapPoint | null) => void;
  initializeLocationSearch: (
    location: GeocodeResult,
    query: string,
  ) => Promise<void>;
  setActiveJob: (
    jobId: string | null,
    progress?: number,
    status?: SearchJobStatus | null,
  ) => void;
  triggerQuickSearch: (options?: QuickSearchOptions) => Promise<void>;
  startFullSearch: () => Promise<string | null>;
}

type SearchRequestState = Pick<
  SearchStore,
  | 'locationQuery'
  | 'useLocationSearch'
  | 'circleFilter'
  | 'checkin'
  | 'checkout'
  | 'adults'
  | 'currency'
  | 'priceDisplay'
  | 'priceMin'
  | 'priceMax'
  | 'minRating'
  | 'minBedrooms'
  | 'minBeds'
  | 'propertyType'
  | 'airbnbFilters'
  | 'bookingFilters'
>;

let currentAbortController: AbortController | null = null;

function buildSearchRequest(
  state: SearchRequestState,
  bbox: BoundingBox,
  options: BuildSearchRequestOptions = {},
): FullSearchRequest {
  return {
    platforms: ['airbnb', 'booking'],
    boundingBox: bbox,
    circle:
      options.circle !== undefined
        ? options.circle ?? undefined
        : state.circleFilter ?? undefined,
    location:
      state.useLocationSearch && state.locationQuery
        ? state.locationQuery
        : undefined,
    checkin: state.checkin ?? undefined,
    checkout: state.checkout ?? undefined,
    adults: state.adults,
    currency: state.currency,
    priceDisplay: state.priceDisplay,
    priceMin: state.priceMin ?? undefined,
    priceMax: state.priceMax ?? undefined,
    minRating: state.minRating ?? undefined,
    minBedrooms: state.minBedrooms ?? undefined,
    minBeds: state.minBeds ?? undefined,
    propertyType: state.propertyType ?? undefined,
    exhaustive: true,
  };
}

export const useSearchStore = create<SearchStore>((set, get) => {
  return {
    platform: 'airbnb',
    locationQuery: null,
    useLocationSearch: false,
    checkin: null,
    checkout: null,
    adults: 2,
    currency: 'USD',
    priceMin: null,
    priceMax: null,
    minRating: null,
    minBedrooms: null,
    minBeds: null,
    propertyType: null,
    priceDisplay: 'total' as PriceDisplay,
    airbnbFilters: {},
    bookingFilters: {},

    viewportBbox: null,
    userBbox: null,
    circleFilter: null,
    poi: null,
    drawMode: null,
    zoom: 3,
    mapBounds: null,
    mapCenter: null,
    mapFocusId: 0,
    hasInitializedSearch: false,
    autoUpdate: true,
    fullSearchMode: 'window',
    pendingViewportSearch: false,
    pendingProgrammaticSearch: false,

    results: [],
    isLoading: false,
    searchError: null,
    lastSearchMs: null,
    activeJobId: null,
    completedJobId: null,
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
        completedJobId: null,
        airbnbFilters: {},
        bookingFilters: {},
      });
      if (get().hasInitializedSearch) {
        void get().triggerQuickSearch({ force: true });
      }
    },

    setFilter: (key, value) => {
      set((state) => ({ ...state, [key]: value }));
    },

    setUseLocationSearch: (enabled) => set({ useLocationSearch: enabled }),

    setDrawMode: (mode) => set({ drawMode: mode }),

    setViewport: (bbox, zoom) => set({ viewportBbox: bbox, zoom }),

    setMapCenter: (center) => set({ mapCenter: center }),

    setFullSearchMode: (mode) => set({ fullSearchMode: mode }),

    setAutoUpdate: (enabled) => {
      set({ autoUpdate: enabled });
      if (enabled && get().pendingViewportSearch) {
        void get().triggerQuickSearch({ force: true });
      }
    },

    setPendingViewportSearch: (pending) =>
      set({ pendingViewportSearch: pending }),

    setPendingProgrammaticSearch: (pending) =>
      set({ pendingProgrammaticSearch: pending }),

    setResults: (results) => set({ results, isLoading: false }),

    setIsLoading: (loading) => set({ isLoading: loading }),

    selectResult: (id) => set({ selectedId: id }),

    setUserBbox: (bbox) =>
      set({
        userBbox: bbox,
        drawMode: bbox ? null : get().drawMode,
      }),

    setCircleFilter: (circle) => set({ circleFilter: circle }),

    setPoi: (point) =>
      set({
        poi: point,
        drawMode: point ? null : get().drawMode,
      }),

    initializeLocationSearch: async (location, query) => {
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }

      set({
        hasInitializedSearch: true,
        locationQuery: query,
        useLocationSearch: true,
        mapBounds: location.boundingBox,
        mapCenter: location.center,
        mapFocusId: get().mapFocusId + 1,
        viewportBbox: null,
        userBbox: null,
        circleFilter: null,
        poi: null,
        drawMode: null,
        fullSearchMode: 'window',
        results: [],
        selectedId: null,
        completedJobId: null,
        searchError: null,
        pendingViewportSearch: false,
        pendingProgrammaticSearch: true,
      });
    },

    setActiveJob: (jobId, progress = 0, status = null) =>
      set({
        activeJobId: jobId,
        completedJobId: null,
        jobProgress: progress,
        jobStatus: status,
      }),

    triggerQuickSearch: async (options = {}) => {
      const state = get();
      const bbox = options.bbox ?? state.userBbox ?? state.viewportBbox;

      if (
        state.activeJobId ||
        !bbox ||
        (!options.force &&
          !options.bbox &&
          !state.userBbox &&
          state.zoom < MIN_SEARCH_ZOOM)
      ) {
        return;
      }

      if (currentAbortController) {
        currentAbortController.abort();
      }

      const abortController = new AbortController();
      currentAbortController = abortController;

      set({
        isLoading: true,
        searchError: null,
        completedJobId: null,
        pendingViewportSearch: false,
      });

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
            completedJobId: null,
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
          completedJobId: null,
          searchError: null,
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;

        set({
          isLoading: false,
          completedJobId: null,
          searchError: err instanceof Error ? err.message : 'Search failed',
        });
      }
    },

    startFullSearch: async () => {
      const state = get();
      const rectangleBbox =
        state.userBbox && !state.circleFilter ? state.userBbox : null;
      const circleBbox =
        state.userBbox && state.circleFilter ? state.userBbox : null;
      const bbox =
        state.fullSearchMode === 'window'
          ? state.viewportBbox
          : state.fullSearchMode === 'rectangle'
            ? rectangleBbox
            : circleBbox;
      const circle =
        state.fullSearchMode === 'circle' ? state.circleFilter : null;

      if (
        !state.hasInitializedSearch ||
        !bbox ||
        (state.fullSearchMode === 'window' && state.zoom < MIN_SEARCH_ZOOM) ||
        state.activeJobId
      ) {
        return null;
      }

      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }

      set({
        isLoading: false,
        searchError: null,
        activeJobId: null,
        completedJobId: null,
        jobStatus: 'pending',
        jobProgress: 0,
        jobPagesScanned: 0,
        jobResultCount: 0,
      });

      try {
        const body: CreateReviewJobRequest = {
          ...buildSearchRequest(state, bbox, { circle }),
          mapBounds: state.mapBounds ?? undefined,
          mapCenter: state.mapCenter ?? undefined,
          mapZoom: state.zoom,
          searchAreaMode: state.fullSearchMode,
          poi: state.poi ?? undefined,
        };

        const res = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json();
          set({
            isLoading: false,
            completedJobId: null,
            jobStatus: 'failed',
            searchError: data.error || 'Failed to start full search',
          });
          return null;
        }

        const data: CreateReviewJobResponse = await res.json();
        set({
          activeJobId: data.jobId,
          completedJobId: null,
          jobStatus: data.status,
          jobProgress: 0,
          jobPagesScanned: 0,
          jobResultCount: 0,
          isLoading: false,
          searchError: null,
        });
        return data.jobId;
      } catch (err: unknown) {
        set({
          activeJobId: null,
          completedJobId: null,
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
        return null;
      }
    },
  };
});
