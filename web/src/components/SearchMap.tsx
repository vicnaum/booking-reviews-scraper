'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng, Map as LeafletMap } from 'leaflet';
import { useSearchStore } from '@/hooks/useSearchStore';
import PriceMarker from './PriceMarker';
import type { BoundingBox, CircleFilter, MapPoint } from '@/types';

const QUICK_SEARCH_DEBOUNCE_MS = 1000;
const MIN_SEARCH_ZOOM = 12;
const MIN_RECTANGLE_SIZE = 0.0005;
const MIN_CIRCLE_RADIUS_METERS = 50;

function getBboxFromMap(map: LeafletMap): BoundingBox {
  const bounds = map.getBounds();
  return {
    neLat: bounds.getNorthEast().lat,
    neLng: bounds.getNorthEast().lng,
    swLat: bounds.getSouthWest().lat,
    swLng: bounds.getSouthWest().lng,
  };
}

function createBboxFromPoints(a: LatLng, b: LatLng): BoundingBox {
  return {
    neLat: Math.max(a.lat, b.lat),
    neLng: Math.max(a.lng, b.lng),
    swLat: Math.min(a.lat, b.lat),
    swLng: Math.min(a.lng, b.lng),
  };
}

function isMeaningfulBbox(bbox: BoundingBox): boolean {
  return (
    Math.abs(bbox.neLat - bbox.swLat) >= MIN_RECTANGLE_SIZE &&
    Math.abs(bbox.neLng - bbox.swLng) >= MIN_RECTANGLE_SIZE
  );
}

function toRectangleBounds(
  bbox: BoundingBox,
): [[number, number], [number, number]] {
  return [
    [bbox.swLat, bbox.swLng],
    [bbox.neLat, bbox.neLng],
  ];
}

function haversineDistanceMeters(a: MapPoint, b: MapPoint): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const value =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(value));
}

function createCircleBbox(center: MapPoint, radiusMeters: number): BoundingBox {
  const latDelta = radiusMeters / 111320;
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const lngDelta =
    radiusMeters / (111320 * Math.max(Math.abs(cosLat), 0.000001));

  return {
    neLat: center.lat + latDelta,
    neLng: center.lng + lngDelta,
    swLat: center.lat - latDelta,
    swLng: center.lng - lngDelta,
  };
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

function MapEvents({
  skipNextAutoSearchRef,
}: {
  skipNextAutoSearchRef: MutableRefObject<boolean>;
}) {
  const setViewport = useSearchStore((s) => s.setViewport);
  const triggerQuickSearch = useSearchStore((s) => s.triggerQuickSearch);
  const hasInitializedSearch = useSearchStore((s) => s.hasInitializedSearch);
  const autoUpdate = useSearchStore((s) => s.autoUpdate);
  const drawMode = useSearchStore((s) => s.drawMode);
  const userBbox = useSearchStore((s) => s.userBbox);
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
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      const bbox = getBboxFromMap(map);
      const zoom = map.getZoom();
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

      if (drawMode) {
        return;
      }

      if (userBbox) {
        setPendingViewportSearch(false);
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
          void triggerQuickSearch();
        }, QUICK_SEARCH_DEBOUNCE_MS);
        return;
      }

      setPendingViewportSearch(true);
    },
    [
      autoUpdate,
      drawMode,
      hasInitializedSearch,
      pendingProgrammaticSearch,
      setPendingProgrammaticSearch,
      setPendingViewportSearch,
      setUseLocationSearch,
      setViewport,
      skipNextAutoSearchRef,
      triggerQuickSearch,
      userBbox,
      useLocationSearch,
    ],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  useMapEvents({
    moveend: (event) => handleMoveEnd(event.target),
  });

  return null;
}

function DrawingTools({
  skipNextAutoSearchRef,
}: {
  skipNextAutoSearchRef: MutableRefObject<boolean>;
}) {
  const map = useMap();
  const drawMode = useSearchStore((s) => s.drawMode);
  const autoUpdate = useSearchStore((s) => s.autoUpdate);
  const hasInitializedSearch = useSearchStore((s) => s.hasInitializedSearch);
  const userBbox = useSearchStore((s) => s.userBbox);
  const circleFilter = useSearchStore((s) => s.circleFilter);
  const poi = useSearchStore((s) => s.poi);
  const setDrawMode = useSearchStore((s) => s.setDrawMode);
  const setUserBbox = useSearchStore((s) => s.setUserBbox);
  const setCircleFilter = useSearchStore((s) => s.setCircleFilter);
  const setPoi = useSearchStore((s) => s.setPoi);
  const setUseLocationSearch = useSearchStore((s) => s.setUseLocationSearch);
  const setPendingViewportSearch = useSearchStore(
    (s) => s.setPendingViewportSearch,
  );
  const triggerQuickSearch = useSearchStore((s) => s.triggerQuickSearch);

  const [draftBbox, setDraftBbox] = useState<BoundingBox | null>(null);
  const [draftCircle, setDraftCircle] = useState<CircleFilter | null>(null);
  const [mouseDistance, setMouseDistance] = useState<{
    x: number;
    y: number;
    meters: number;
  } | null>(null);

  const startPointRef = useRef<LatLng | null>(null);
  const isDrawingRef = useRef(false);

  useEffect(() => {
    const container = map.getContainer();
    if (drawMode) {
      if (map.dragging.enabled()) {
        map.dragging.disable();
      }
      container.style.cursor = 'crosshair';
      return;
    }

    if (!map.dragging.enabled()) {
      map.dragging.enable();
    }
    container.style.cursor = '';
    startPointRef.current = null;
    isDrawingRef.current = false;
    setDraftBbox(null);
    setDraftCircle(null);

    return () => {
      container.style.cursor = '';
    };
  }, [drawMode, map]);

  useEffect(() => {
    if (!poi) {
      setMouseDistance(null);
    }
  }, [poi]);

  const finalizeAreaSearch = useCallback(
    (bbox: BoundingBox) => {
      if (!hasInitializedSearch) {
        return;
      }

      if (autoUpdate) {
        setPendingViewportSearch(false);
        skipNextAutoSearchRef.current = false;
        void triggerQuickSearch({ force: true, bbox });
        return;
      }

      setPendingViewportSearch(true);
    },
    [
      autoUpdate,
      hasInitializedSearch,
      setPendingViewportSearch,
      skipNextAutoSearchRef,
      triggerQuickSearch,
    ],
  );

  useMapEvents({
    mousedown: (event) => {
      if (drawMode !== 'rectangle' && drawMode !== 'circle') {
        return;
      }

      isDrawingRef.current = true;
      startPointRef.current = event.latlng;

      if (drawMode === 'rectangle') {
        setDraftBbox(createBboxFromPoints(event.latlng, event.latlng));
        setDraftCircle(null);
        return;
      }

      setDraftCircle({
        center: { lat: event.latlng.lat, lng: event.latlng.lng },
        radiusMeters: 0,
      });
      setDraftBbox(null);
    },
    mousemove: (event) => {
      if (poi) {
        setMouseDistance({
          x: event.containerPoint.x,
          y: event.containerPoint.y,
          meters: haversineDistanceMeters(poi, {
            lat: event.latlng.lat,
            lng: event.latlng.lng,
          }),
        });
      }

      if (!isDrawingRef.current || !startPointRef.current) {
        return;
      }

      if (drawMode === 'rectangle') {
        setDraftBbox(createBboxFromPoints(startPointRef.current, event.latlng));
        return;
      }

      if (drawMode === 'circle') {
        setDraftCircle({
          center: {
            lat: startPointRef.current.lat,
            lng: startPointRef.current.lng,
          },
          radiusMeters: haversineDistanceMeters(
            {
              lat: startPointRef.current.lat,
              lng: startPointRef.current.lng,
            },
            { lat: event.latlng.lat, lng: event.latlng.lng },
          ),
        });
      }
    },
    mouseup: (event) => {
      if (!isDrawingRef.current || !startPointRef.current) {
        return;
      }

      const startPoint = startPointRef.current;
      startPointRef.current = null;
      isDrawingRef.current = false;

      if (drawMode === 'rectangle') {
        const nextBbox = createBboxFromPoints(startPoint, event.latlng);
        setDraftBbox(null);

        if (!isMeaningfulBbox(nextBbox)) {
          return;
        }

        setUseLocationSearch(false);
        setCircleFilter(null);
        setUserBbox(nextBbox);
        finalizeAreaSearch(nextBbox);
        return;
      }

      if (drawMode === 'circle') {
        const nextCircle: CircleFilter = {
          center: { lat: startPoint.lat, lng: startPoint.lng },
          radiusMeters: haversineDistanceMeters(
            { lat: startPoint.lat, lng: startPoint.lng },
            { lat: event.latlng.lat, lng: event.latlng.lng },
          ),
        };
        setDraftCircle(null);

        if (nextCircle.radiusMeters < MIN_CIRCLE_RADIUS_METERS) {
          return;
        }

        const nextBbox = createCircleBbox(
          nextCircle.center,
          nextCircle.radiusMeters,
        );
        setUseLocationSearch(false);
        setCircleFilter(nextCircle);
        setUserBbox(nextBbox);
        finalizeAreaSearch(nextBbox);
      }
    },
    click: (event) => {
      if (drawMode !== 'poi') {
        return;
      }

      setPoi({ lat: event.latlng.lat, lng: event.latlng.lng });
      setDrawMode(null);
    },
    mouseout: () => {
      setMouseDistance(null);
    },
  });

  return (
    <>
      {userBbox && !circleFilter && (
        <Rectangle
          bounds={toRectangleBounds(userBbox)}
          pathOptions={{
            color: '#34d399',
            weight: 2,
            fillOpacity: 0.08,
          }}
        />
      )}
      {draftBbox && (
        <Rectangle
          bounds={toRectangleBounds(draftBbox)}
          pathOptions={{
            color: '#f59e0b',
            weight: 2,
            dashArray: '6 4',
            fillOpacity: 0.05,
          }}
        />
      )}
      {circleFilter && (
        <Circle
          center={[circleFilter.center.lat, circleFilter.center.lng]}
          radius={circleFilter.radiusMeters}
          pathOptions={{
            color: '#38bdf8',
            weight: 2,
            fillOpacity: 0.08,
          }}
        />
      )}
      {draftCircle && (
        <Circle
          center={[draftCircle.center.lat, draftCircle.center.lng]}
          radius={draftCircle.radiusMeters}
          pathOptions={{
            color: '#f59e0b',
            weight: 2,
            dashArray: '6 4',
            fillOpacity: 0.05,
          }}
        />
      )}
      {poi && (
        <CircleMarker
          center={[poi.lat, poi.lng]}
          radius={8}
          pathOptions={{
            color: '#f97316',
            fillColor: '#fb923c',
            fillOpacity: 1,
            weight: 3,
          }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            Point of interest
          </Tooltip>
        </CircleMarker>
      )}
      {poi && mouseDistance && (
        <div
          className="pointer-events-none absolute z-[1000]"
          style={{
            left: `${mouseDistance.x + 18}px`,
            top: `${mouseDistance.y + 18}px`,
          }}
        >
          <div className="rounded-full bg-neutral-900/95 px-3 py-1.5 text-xs text-neutral-100 shadow-lg backdrop-blur-sm">
            {formatDistance(mouseDistance.meters)} from POI
          </div>
        </div>
      )}
    </>
  );
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
  const drawMode = useSearchStore((s) => s.drawMode);
  const userBbox = useSearchStore((s) => s.userBbox);
  const circleFilter = useSearchStore((s) => s.circleFilter);
  const poi = useSearchStore((s) => s.poi);
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
      <DrawingTools skipNextAutoSearchRef={skipNextAutoSearchRef} />
      <FlyToLocation skipNextAutoSearchRef={skipNextAutoSearchRef} />
      {results
        .filter((result) => result.coordinates)
        .map((result) => (
          <PriceMarker
            key={result.id}
            result={result}
            isSelected={result.id === selectedId}
            onClick={selectResult}
          />
        ))}
      {isLoading && (
        <div className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2">
          <div className="rounded-full bg-neutral-900/90 px-4 py-1.5 text-xs text-neutral-300 shadow-lg backdrop-blur-sm">
            Searching...
          </div>
        </div>
      )}
      {zoom < MIN_SEARCH_ZOOM && results.length === 0 && !isLoading && (
        <div className="absolute bottom-8 left-1/2 z-[1000] -translate-x-1/2">
          <div className="rounded-full bg-neutral-900/90 px-4 py-2 text-xs text-neutral-400 shadow-lg backdrop-blur-sm">
            Zoom in to search for listings
          </div>
        </div>
      )}
      {drawMode === 'rectangle' && (
        <div className="absolute left-1/2 top-14 z-[1000] -translate-x-1/2">
          <div className="rounded-full bg-amber-950/90 px-4 py-2 text-xs text-amber-100 shadow-lg backdrop-blur-sm">
            Drag on the map to draw a search rectangle.
          </div>
        </div>
      )}
      {drawMode === 'circle' && (
        <div className="absolute left-1/2 top-14 z-[1000] -translate-x-1/2">
          <div className="rounded-full bg-sky-950/90 px-4 py-2 text-xs text-sky-100 shadow-lg backdrop-blur-sm">
            Drag from a center point to draw a search circle.
          </div>
        </div>
      )}
      {drawMode === 'poi' && (
        <div className="absolute left-1/2 top-14 z-[1000] -translate-x-1/2">
          <div className="rounded-full bg-orange-950/90 px-4 py-2 text-xs text-orange-100 shadow-lg backdrop-blur-sm">
            Click once to place the point of interest.
          </div>
        </div>
      )}
      {userBbox && !circleFilter && drawMode !== 'rectangle' && (
        <div className="absolute bottom-8 left-4 z-[1000]">
          <div className="rounded-full bg-emerald-950/90 px-4 py-2 text-xs text-emerald-100 shadow-lg backdrop-blur-sm">
            Rectangle search area active
          </div>
        </div>
      )}
      {circleFilter && drawMode !== 'circle' && (
        <div className="absolute bottom-8 left-4 z-[1000]">
          <div className="rounded-full bg-sky-950/90 px-4 py-2 text-xs text-sky-100 shadow-lg backdrop-blur-sm">
            Circle search area active
          </div>
        </div>
      )}
      {poi && (
        <div className="absolute bottom-20 left-4 z-[1000]">
          <div className="rounded-full bg-orange-950/90 px-4 py-2 text-xs text-orange-100 shadow-lg backdrop-blur-sm">
            POI active
          </div>
        </div>
      )}
      {!autoUpdate && pendingViewportSearch && !isLoading && (
        <div className="absolute bottom-8 right-4 z-[1000]">
          <div className="rounded-full bg-amber-950/90 px-4 py-2 text-xs text-amber-200 shadow-lg backdrop-blur-sm">
            Map changed. Click Update to refresh results.
          </div>
        </div>
      )}
    </MapContainer>
  );
}
