import assert from 'node:assert/strict';
import test from 'node:test';
import { useSearchStore } from './useSearchStore';
import type { BoundingBox, CircleFilter, MapPoint } from '@/types';

function resetStore() {
  useSearchStore.setState({
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
    priceDisplay: 'total',
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
  });
}

test.afterEach(() => {
  resetStore();
});

test('startFullSearch sends the live viewport to the review job API', async () => {
  const viewportBbox: BoundingBox = {
    neLat: 51.535,
    neLng: -0.05,
    swLat: 51.49,
    swLng: -0.14,
  };
  const staleCityBbox: BoundingBox = {
    neLat: 51.67,
    neLng: 0.15,
    swLat: 51.28,
    swLng: -0.51,
  };
  const staleCityCenter: MapPoint = { lat: 51.5072, lng: -0.1276 };
  const poi: MapPoint = { lat: 51.512, lng: -0.104 };

  let capturedBody: Record<string, unknown> | null = null;
  const originalFetch = global.fetch;

  global.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return {
      ok: true,
      json: async () => ({ jobId: 'job-123', status: 'pending' }),
    } as Response;
  }) as typeof fetch;

  try {
    resetStore();
    useSearchStore.setState({
      hasInitializedSearch: true,
      locationQuery: 'London',
      useLocationSearch: true,
      viewportBbox,
      zoom: 14,
      mapBounds: staleCityBbox,
      mapCenter: staleCityCenter,
      poi,
    });

    const jobId = await useSearchStore.getState().startFullSearch();

    assert.equal(jobId, 'job-123');
    assert.ok(capturedBody);
    assert.deepEqual(capturedBody.mapBounds, viewportBbox);
    assert.deepEqual(capturedBody.mapCenter, {
      lat: (viewportBbox.neLat + viewportBbox.swLat) / 2,
      lng: (viewportBbox.neLng + viewportBbox.swLng) / 2,
    });
    assert.equal(capturedBody.mapZoom, 14);
  } finally {
    global.fetch = originalFetch;
  }
});

test('startFullSearch preserves the viewport while searching a circle area', async () => {
  const viewportBbox: BoundingBox = {
    neLat: 51.538,
    neLng: -0.06,
    swLat: 51.486,
    swLng: -0.16,
  };
  const circle: CircleFilter = {
    center: { lat: 51.509, lng: -0.104 },
    radiusMeters: 1200,
  };
  const circleBbox: BoundingBox = {
    neLat: 51.52,
    neLng: -0.09,
    swLat: 51.498,
    swLng: -0.118,
  };

  let capturedBody: Record<string, unknown> | null = null;
  const originalFetch = global.fetch;

  global.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return {
      ok: true,
      json: async () => ({ jobId: 'job-456', status: 'pending' }),
    } as Response;
  }) as typeof fetch;

  try {
    resetStore();
    useSearchStore.setState({
      hasInitializedSearch: true,
      locationQuery: 'London',
      useLocationSearch: true,
      viewportBbox,
      userBbox: circleBbox,
      circleFilter: circle,
      fullSearchMode: 'circle',
      zoom: 15,
    });

    const jobId = await useSearchStore.getState().startFullSearch();

    assert.equal(jobId, 'job-456');
    assert.ok(capturedBody);
    assert.deepEqual(capturedBody.boundingBox, circleBbox);
    assert.deepEqual(capturedBody.mapBounds, viewportBbox);
    assert.deepEqual(capturedBody.circle, circle);
    assert.equal(capturedBody.searchAreaMode, 'circle');
  } finally {
    global.fetch = originalFetch;
  }
});
