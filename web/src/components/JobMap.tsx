'use client';

import { useEffect } from 'react';
import {
  Circle,
  MapContainer,
  Marker,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
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
import { formatRating, getPriceDisplayInfo } from '@/lib/format';

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

function JobViewport({
  mapBounds,
  boundingBox,
  selectedPoint,
}: {
  mapBounds: BoundingBox | null;
  boundingBox: BoundingBox | null;
  selectedPoint: MapPoint | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (selectedPoint) {
      map.panTo([selectedPoint.lat, selectedPoint.lng], { animate: true });
      return;
    }

    const target = mapBounds ?? boundingBox;
    if (target) {
      const bounds: LatLngBoundsExpression = toRectangleBounds(target);
      map.fitBounds(bounds, { padding: [24, 24] });
    }
  }, [boundingBox, map, mapBounds, selectedPoint]);

  return null;
}

interface JobMapProps {
  results: ReviewJobListing[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
        mapBounds={mapBounds}
        boundingBox={boundingBox}
        selectedPoint={selectedResult?.coordinates ?? null}
      />

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
            <Tooltip direction="top" offset={[0, -10]}>
              <div style={{ maxWidth: 220 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{result.name}</div>
                {formatRating(result) && (
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {formatRating(result)}
                    {result.reviewCount > 0 && ` (${result.reviewCount})`}
                  </div>
                )}
              </div>
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
