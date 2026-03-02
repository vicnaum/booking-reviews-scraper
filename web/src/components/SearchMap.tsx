'use client';

import { useEffect, useRef, useCallback } from 'react';
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

function MapEvents() {
  const setViewport = useSearchStore((s) => s.setViewport);
  const triggerQuickSearch = useSearchStore((s) => s.triggerQuickSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMoveEnd = useCallback(
    (map: LeafletMap) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      const bbox = getBboxFromMap(map);
      const zoom = map.getZoom();
      // Update viewport immediately
      setViewport(bbox, zoom);

      // Debounced quick-search when zoomed in enough
      if (zoom >= MIN_SEARCH_ZOOM) {
        debounceRef.current = setTimeout(() => {
          triggerQuickSearch();
        }, QUICK_SEARCH_DEBOUNCE_MS);
      }
    },
    [setViewport, triggerQuickSearch],
  );

  // moveend fires after both pans and zooms — no need for separate zoomend
  useMapEvents({
    moveend: (e) => handleMoveEnd(e.target),
  });

  return null;
}

function FlyToLocation() {
  const map = useMap();
  const mapCenter = useSearchStore((s) => s.mapCenter);
  const prevCenter = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (
      mapCenter &&
      (!prevCenter.current ||
        prevCenter.current.lat !== mapCenter.lat ||
        prevCenter.current.lng !== mapCenter.lng)
    ) {
      prevCenter.current = mapCenter;
      map.flyTo([mapCenter.lat, mapCenter.lng], 13, { duration: 1.5 });
    }
  }, [map, mapCenter]);

  return null;
}

export default function SearchMap() {
  const results = useSearchStore((s) => s.results);
  const selectedId = useSearchStore((s) => s.selectedId);
  const selectResult = useSearchStore((s) => s.selectResult);
  const isLoading = useSearchStore((s) => s.isLoading);
  const zoom = useSearchStore((s) => s.zoom);

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
      <MapEvents />
      <FlyToLocation />
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
    </MapContainer>
  );
}
