'use client';

import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import type { SearchResult, Platform } from '@/types';
import { getPriceDisplayInfo } from '@/lib/format';
import { useSearchStore } from '@/hooks/useSearchStore';
import MapListingTooltip from './MapListingTooltip';

function createPriceIcon(price: string, platform: Platform, isSelected: boolean) {
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

interface PriceMarkerProps {
  result: SearchResult;
  isSelected: boolean;
  onClick: (id: string) => void;
}

export default function PriceMarker({ result, isSelected, onClick }: PriceMarkerProps) {
  const priceDisplay = useSearchStore((s) => s.priceDisplay);
  const checkin = useSearchStore((s) => s.checkin);
  const checkout = useSearchStore((s) => s.checkout);

  if (!result.coordinates) return null;

  const icon = createPriceIcon(
    getPriceDisplayInfo(result, priceDisplay, { checkin, checkout }).marker,
    result.platform,
    isSelected,
  );

  return (
    <Marker
      position={[result.coordinates.lat, result.coordinates.lng]}
      icon={icon}
      zIndexOffset={isSelected ? 200 : 0}
      eventHandlers={{
        click: () => onClick(result.id),
      }}
    >
      <Tooltip
        direction="auto"
        offset={[0, -10]}
        className="stayreviewr-map-tooltip"
      >
        <MapListingTooltip result={result} />
      </Tooltip>
    </Marker>
  );
}
