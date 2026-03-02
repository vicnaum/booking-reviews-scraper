'use client';

import { create } from 'zustand';
import type { BoundingBox, Platform, SearchResult, QuickSearchRequest } from '@/types';
import type { PriceDisplay } from '@/lib/format';

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
  jobProgress: number;
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
  setActiveJob: (jobId: string | null, progress?: number) => void;
  triggerQuickSearch: () => Promise<void>;
}

// Abort controller for cancelling in-flight searches
let currentAbortController: AbortController | null = null;

export const useSearchStore = create<SearchStore>((set, get) => ({
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
  jobProgress: 0,
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
    // Trigger re-search with new platform
    get().triggerQuickSearch();
  },

  setFilter: (key, value) => {
    set((state) => ({ ...state, [key]: value }));
  },

  setViewport: (bbox, zoom) =>
    set({ viewportBbox: bbox, zoom }),

  setMapCenter: (center) =>
    set({ mapCenter: center }),

  setResults: (results) =>
    set({ results, isLoading: false }),

  setIsLoading: (loading) =>
    set({ isLoading: loading }),

  selectResult: (id) =>
    set({ selectedId: id }),

  setUserBbox: (bbox) =>
    set({ userBbox: bbox }),

  setActiveJob: (jobId, progress = 0) =>
    set({ activeJobId: jobId, jobProgress: progress }),

  triggerQuickSearch: async () => {
    const state = get();
    const bbox = state.userBbox ?? state.viewportBbox;

    if (!bbox || state.zoom < 12) return;

    // Cancel any in-flight search
    if (currentAbortController) {
      currentAbortController.abort();
    }
    const abortController = new AbortController();
    currentAbortController = abortController;

    set({ isLoading: true, searchError: null });

    try {
      const body: QuickSearchRequest = {
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
        ...(state.platform === 'airbnb' ? state.airbnbFilters : {}),
        ...(state.platform === 'booking' ? state.bookingFilters : {}),
      };

      const res = await fetch('/api/quick-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      // If this search was aborted, don't update state
      if (abortController.signal.aborted) return;

      if (!res.ok) {
        const data = await res.json();
        set({ isLoading: false, searchError: data.error || 'Search failed' });
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
}));
