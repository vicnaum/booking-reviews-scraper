'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Circle,
  MapContainer,
  Marker,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L, { type LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  BoundingBox,
  CircleFilter,
  MapPoint,
  PriceDisplayMode,
  ReviewJobListing,
} from '@/types';
import { getPriceDisplayInfo } from '@/lib/format';
import MapListingTooltip from './MapListingTooltip';

const poiIcon = L.divIcon({
  className: '',
  html: `<div style="
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: #fb923c;
    border: 3px solid #f97316;
    box-shadow: 0 0 0 4px rgba(249,115,22,0.22), 0 10px 22px rgba(0,0,0,0.28);
  "></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function createPriceIcon(
  price: string,
  platform: ReviewJobListing['platform'],
  isSelected: boolean,
) {
  const borderColor = platform === 'airbnb' ? '#ff5a5f' : '#003580';
  const scale = isSelected ? 1.1 : 1;

  return L.divIcon({
    className: '',
    html: `<div style="
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%) scale(${scale});
      background: ${isSelected ? borderColor : '#fff'};
      color: ${isSelected ? '#fff' : '#222'};
      border: 2px solid ${borderColor};
      border-radius: 20px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      transition: transform 0.15s, background 0.15s;
      cursor: pointer;
      line-height: 1.4;
    ">${price}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function toRectangleBounds(
  bbox: BoundingBox,
): [[number, number], [number, number]] {
  return [
    [bbox.swLat, bbox.swLng],
    [bbox.neLat, bbox.neLng],
  ];
}

function getCenterFromBbox(bbox: BoundingBox): [number, number] {
  return [(bbox.neLat + bbox.swLat) / 2, (bbox.neLng + bbox.swLng) / 2];
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

function haversineDistanceMeters(a: MapPoint, b: MapPoint): number {
  const earthRadiusMeters = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function JobViewport({
  searchAreaMode,
  mapBounds,
  boundingBox,
  mapCenter,
  mapZoom,
  selectedPoint,
}: {
  searchAreaMode: 'window' | 'rectangle' | 'circle';
  mapBounds: BoundingBox | null;
  boundingBox: BoundingBox | null;
  mapCenter: MapPoint | null;
  mapZoom: number | null;
  selectedPoint: MapPoint | null;
}) {
  const map = useMap();
  const hasRestoredViewportRef = useRef(false);
  const lastSelectedPointKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedPoint) {
      const pointKey = `${selectedPoint.lat}:${selectedPoint.lng}`;
      if (lastSelectedPointKeyRef.current !== pointKey) {
        lastSelectedPointKeyRef.current = pointKey;
        map.panTo([selectedPoint.lat, selectedPoint.lng], { animate: true });
      }
      return;
    }

    lastSelectedPointKeyRef.current = null;

    if (hasRestoredViewportRef.current) {
      return;
    }

    hasRestoredViewportRef.current = true;

    if ((searchAreaMode === 'rectangle' || searchAreaMode === 'circle') && boundingBox) {
      const bounds: LatLngBoundsExpression = toRectangleBounds(boundingBox);
      map.fitBounds(bounds, { padding: [24, 24], animate: false });
      return;
    }

    if (mapCenter && mapZoom != null) {
      map.setView([mapCenter.lat, mapCenter.lng], mapZoom, {
        animate: false,
      });
      return;
    }

    const target = mapBounds ?? boundingBox;
    if (target) {
      const bounds: LatLngBoundsExpression = toRectangleBounds(target);
      map.fitBounds(bounds, { padding: [24, 24], animate: false });
    }
  }, [boundingBox, map, mapBounds, mapCenter, mapZoom, searchAreaMode, selectedPoint]);

  return null;
}

function JobPoiDistanceOverlay({
  poi,
}: {
  poi: MapPoint | null;
}) {
  const [mouseDistance, setMouseDistance] = useState<{
    x: number;
    y: number;
    meters: number;
  } | null>(null);

  useMapEvents({
    mousemove: (event) => {
      if (!poi) {
        setMouseDistance(null);
        return;
      }

      setMouseDistance({
        x: event.originalEvent.offsetX,
        y: event.originalEvent.offsetY,
        meters: haversineDistanceMeters(poi, {
          lat: event.latlng.lat,
          lng: event.latlng.lng,
        }),
      });
    },
    mouseout: () => {
      setMouseDistance(null);
    },
  });

  if (!poi || !mouseDistance) {
    return null;
  }

  return (
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
  );
}

interface JobMapProps {
  results: ReviewJobListing[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  searchAreaMode: 'window' | 'rectangle' | 'circle';
  boundingBox: BoundingBox | null;
  mapBounds: BoundingBox | null;
  circle: CircleFilter | null;
  poi: MapPoint | null;
  mapCenter: MapPoint | null;
  mapZoom: number | null;
  priceDisplay: PriceDisplayMode;
  checkin?: string | null;
  checkout?: string | null;
}

export default function JobMap({
  results,
  selectedId,
  onSelect,
  searchAreaMode,
  boundingBox,
  mapBounds,
  circle,
  poi,
  mapCenter,
  mapZoom,
  priceDisplay,
  checkin,
  checkout,
}: JobMapProps) {
  const fallbackCenter =
    mapCenter
      ? [mapCenter.lat, mapCenter.lng] as [number, number]
      : boundingBox
        ? getCenterFromBbox(boundingBox)
        : [51.505, -0.09] as [number, number];
  const fallbackZoom = mapZoom ?? 13;
  const selectedResult =
    selectedId != null
      ? results.find((result) => `${result.platform}:${result.id}` === selectedId) ?? null
      : null;

  return (
    <MapContainer
      center={fallbackCenter}
      zoom={fallbackZoom}
      className="h-full w-full"
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      <JobViewport
        searchAreaMode={searchAreaMode}
        mapBounds={mapBounds}
        boundingBox={boundingBox}
        mapCenter={mapCenter}
        mapZoom={mapZoom}
        selectedPoint={selectedResult?.coordinates ?? null}
      />
      <JobPoiDistanceOverlay poi={poi} />

      {boundingBox && !circle && (
        <Rectangle
          bounds={toRectangleBounds(boundingBox)}
          pathOptions={{ color: '#f4b56a', weight: 2, fillOpacity: 0.06 }}
        />
      )}

      {circle && (
        <Circle
          center={[circle.center.lat, circle.center.lng]}
          radius={circle.radiusMeters}
          pathOptions={{ color: '#4da3ff', weight: 2, fillOpacity: 0.08 }}
        />
      )}

      {poi && (
        <Marker
          position={[poi.lat, poi.lng]}
          icon={poiIcon}
          zIndexOffset={1000}
        >
          <Tooltip direction="top" offset={[0, -10]} permanent={false}>
            Point of interest
          </Tooltip>
        </Marker>
      )}

      {results.map((result) => {
        if (!result.coordinates) {
          return null;
        }

        const priceLabel = getPriceDisplayInfo(result, priceDisplay, {
          checkin,
          checkout,
        }).marker;

        return (
          <Marker
            key={`${result.platform}:${result.id}`}
            position={[result.coordinates.lat, result.coordinates.lng]}
            icon={createPriceIcon(
              priceLabel,
              result.platform,
              `${result.platform}:${result.id}` === selectedId,
            )}
            zIndexOffset={`${result.platform}:${result.id}` === selectedId ? 200 : 0}
            eventHandlers={{
              click: () => onSelect(`${result.platform}:${result.id}`),
            }}
          >
            <Tooltip
              direction="auto"
              offset={[0, -10]}
              className="stayreviewr-map-tooltip"
            >
              <MapListingTooltip
                result={result}
                poiDistanceLabel={
                  poi && result.poiDistanceMeters != null
                    ? `${formatDistance(result.poiDistanceMeters)} from POI`
                    : null
                }
              />
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
