'use client';

import { useEffect, useRef, useCallback, type MutableRefObject } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap } from 'leaflet';
import { useSearchStore } from '@/hooks/useSearchStore';
import PriceMarker from './PriceMarker';
import type { BoundingBox } from '@/types';

function getBboxFromMap(map: LeafletMap): BoundingBox {
  const bounds = map.getBounds();
  return {
    neLat: bounds.getNorthEast().lat,
    neLng: bounds.getNorthEast().lng,
    swLat: bounds.getSouthWest().lat,
    swLng: bounds.getSouthWest().lng,
  };
}

const QUICK_SEARCH_DEBOUNCE_MS = 1000;
const MIN_SEARCH_ZOOM = 12;

function MapEvents({
  skipNextAutoSearchRef,
}: {
  skipNextAutoSearchRef: MutableRefObject<boolean>;
}) {
  const setViewport = useSearchStore((s) => s.setViewport);
  const triggerQuickSearch = useSearchStore((s) => s.triggerQuickSearch);
  const hasInitializedSearch = useSearchStore((s) => s.hasInitializedSearch);
  const autoUpdate = useSearchStore((s) => s.autoUpdate);
  const useLocationSearch = useSearchStore((s) => s.useLocationSearch);
  const setUseLocationSearch = useSearchStore((s) => s.setUseLocationSearch);
  const setPendingViewportSearch = useSearchStore(
    (s) => s.setPendingViewportSearch,
  );
  const pendingProgrammaticSearch = useSearchStore(
    (s) => s.pendingProgrammaticSearch,
  );
  const setPendingProgrammaticSearch = useSearchStore(
    (s) => s.setPendingProgrammaticSearch,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMoveEnd = useCallback(
    (map: LeafletMap) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      const bbox = getBboxFromMap(map);
      const zoom = map.getZoom();
      // Update viewport immediately
      setViewport(bbox, zoom);

      if (skipNextAutoSearchRef.current) {
        skipNextAutoSearchRef.current = false;
        if (pendingProgrammaticSearch) {
          setPendingProgrammaticSearch(false);
          void triggerQuickSearch({ force: true, bbox });
          return;
        }
        setPendingViewportSearch(false);
        return;
      }

      if (!hasInitializedSearch) {
        return;
      }

      if (useLocationSearch) {
        setUseLocationSearch(false);
      }

      if (zoom < MIN_SEARCH_ZOOM) {
        setPendingViewportSearch(false);
        return;
      }

      if (autoUpdate) {
        setPendingViewportSearch(false);
        debounceRef.current = setTimeout(() => {
          triggerQuickSearch();
        }, QUICK_SEARCH_DEBOUNCE_MS);
        return;
      }

      setPendingViewportSearch(true);
    },
    [
      autoUpdate,
      hasInitializedSearch,
      pendingProgrammaticSearch,
      setPendingProgrammaticSearch,
      setPendingViewportSearch,
      setUseLocationSearch,
      setViewport,
      skipNextAutoSearchRef,
      triggerQuickSearch,
      useLocationSearch,
    ],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // moveend fires after both pans and zooms — no need for separate zoomend
  useMapEvents({
    moveend: (e) => handleMoveEnd(e.target),
  });

  return null;
}

function FlyToLocation({
  skipNextAutoSearchRef,
}: {
  skipNextAutoSearchRef: MutableRefObject<boolean>;
}) {
  const map = useMap();
  const mapCenter = useSearchStore((s) => s.mapCenter);
  const mapFocusId = useSearchStore((s) => s.mapFocusId);
  const previousFocusId = useRef(0);

  useEffect(() => {
    if (!mapCenter || mapFocusId === previousFocusId.current) {
      return;
    }

    previousFocusId.current = mapFocusId;
    skipNextAutoSearchRef.current = true;
    map.flyTo([mapCenter.lat, mapCenter.lng], 13, { duration: 1.1 });
  }, [map, mapCenter, mapFocusId, skipNextAutoSearchRef]);

  return null;
}

export default function SearchMap() {
  const results = useSearchStore((s) => s.results);
  const selectedId = useSearchStore((s) => s.selectedId);
  const selectResult = useSearchStore((s) => s.selectResult);
  const isLoading = useSearchStore((s) => s.isLoading);
  const zoom = useSearchStore((s) => s.zoom);
  const autoUpdate = useSearchStore((s) => s.autoUpdate);
  const pendingViewportSearch = useSearchStore((s) => s.pendingViewportSearch);
  const skipNextAutoSearchRef = useRef(false);

  return (
    <MapContainer
      center={[44.4, 12.5]}
      zoom={5}
      className="h-full w-full"
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <MapEvents skipNextAutoSearchRef={skipNextAutoSearchRef} />
      <FlyToLocation skipNextAutoSearchRef={skipNextAutoSearchRef} />
      {results
        .filter((r) => r.coordinates)
        .map((r) => (
          <PriceMarker
            key={r.id}
            result={r}
            isSelected={r.id === selectedId}
            onClick={selectResult}
          />
        ))}
      {/* Loading indicator overlay */}
      {isLoading && (
        <div className="absolute top-3 left-1/2 z-[1000] -translate-x-1/2">
          <div className="rounded-full bg-neutral-900/90 px-4 py-1.5 text-xs text-neutral-300 shadow-lg backdrop-blur-sm">
            Searching...
          </div>
        </div>
      )}
      {/* Zoom hint */}
      {zoom < MIN_SEARCH_ZOOM && results.length === 0 && !isLoading && (
        <div className="absolute bottom-8 left-1/2 z-[1000] -translate-x-1/2">
          <div className="rounded-full bg-neutral-900/90 px-4 py-2 text-xs text-neutral-400 shadow-lg backdrop-blur-sm">
            Zoom in to search for listings
          </div>
        </div>
      )}
      {!autoUpdate && pendingViewportSearch && !isLoading && (
        <div className="absolute bottom-8 right-4 z-[1000]">
          <div className="rounded-full bg-amber-950/90 px-4 py-2 text-xs text-amber-200 shadow-lg backdrop-blur-sm">
            Map moved. Click Update to refresh results.
          </div>
        </div>
      )}
    </MapContainer>
  );
}
