'use client';

import type { SearchResult } from '@/types';
import { formatRating } from '@/lib/format';
import PlatformBadge from './PlatformBadge';
import ListingThumbnail from './ListingThumbnail';

interface MapListingTooltipProps {
  result: SearchResult;
  poiDistanceLabel?: string | null;
}

export default function MapListingTooltip({
  result,
  poiDistanceLabel = null,
}: MapListingTooltipProps) {
  const ratingLabel = formatRating(result);

  return (
    <div className="stayreviewr-map-tooltip__body">
      <ListingThumbnail
        photoUrl={result.photoUrl}
        alt={result.name}
        size="tooltip"
      />
      <div className="min-w-0">
        <div className="mb-2">
          <PlatformBadge platform={result.platform} />
        </div>
        <div className="stayreviewr-map-tooltip__title">
          {result.name}
        </div>
        <div className="stayreviewr-map-tooltip__meta">
          {ratingLabel && (
            <span className="font-semibold text-[#f4c06b]">
              {ratingLabel}
            </span>
          )}
          {result.reviewCount > 0 && (
            <span>({result.reviewCount})</span>
          )}
          {result.propertyType && (
            <span className="truncate">{result.propertyType}</span>
          )}
        </div>
        {poiDistanceLabel && (
          <div className="stayreviewr-map-tooltip__distance">
            {poiDistanceLabel}
          </div>
        )}
      </div>
    </div>
  );
}
