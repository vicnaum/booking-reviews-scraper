'use client';

import { forwardRef } from 'react';
import type { SearchResult } from '@/types';
import { formatPriceLabel, formatPrice, formatRating } from '@/lib/format';
import { useSearchStore } from '@/hooks/useSearchStore';

interface ResultCardProps {
  result: SearchResult;
  isSelected: boolean;
  onClick: () => void;
}

const ResultCard = forwardRef<HTMLDivElement, ResultCardProps>(
  function ResultCard({ result, isSelected, onClick }, ref) {
    const priceDisplay = useSearchStore((s) => s.priceDisplay);
    const borderColor = result.platform === 'airbnb' ? 'border-red-500/50' : 'border-blue-700/50';
    const selectedBorder = result.platform === 'airbnb' ? 'border-red-500' : 'border-blue-600';

    // Show the "other" price as secondary
    const altMode = priceDisplay === 'perNight' ? 'total' : 'perNight';
    const altLabel = priceDisplay === 'perNight' ? 'total' : '/night';
    const hasAlt =
      priceDisplay === 'perNight'
        ? result.totalPrice != null
        : result.price != null;

    return (
      <div
        ref={ref}
        onClick={onClick}
        className={`cursor-pointer rounded-lg border p-3 transition-colors ${
          isSelected
            ? `${selectedBorder} bg-neutral-800/80`
            : `border-neutral-800 bg-neutral-900 hover:${borderColor} hover:bg-neutral-800/50`
        }`}
      >
        <div className="flex gap-3">
          {/* Photo */}
          {result.photoUrl ? (
            <img
              src={result.photoUrl}
              alt={result.name}
              className="h-20 w-20 flex-shrink-0 rounded-md object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-md bg-neutral-800 text-neutral-600 text-xs">
              No photo
            </div>
          )}

          {/* Info */}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium text-neutral-200">
              {result.name}
            </h3>

            <div className="mt-1 flex items-center gap-2 text-xs text-neutral-400">
              {formatRating(result) && (
                <span className="text-yellow-400">{formatRating(result)}</span>
              )}
              {result.reviewCount > 0 && (
                <span>({result.reviewCount})</span>
              )}
              {result.propertyType && (
                <span className="truncate">{result.propertyType}</span>
              )}
            </div>

            <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
              {result.bedrooms != null && <span>{result.bedrooms}bd</span>}
              {result.bathrooms != null && <span>{result.bathrooms}ba</span>}
              {result.maxGuests != null && <span>{result.maxGuests}g</span>}
              {result.superhost && (
                <span className="text-pink-400">Superhost</span>
              )}
            </div>

            <div className="mt-1.5 text-sm font-semibold text-white">
              {formatPriceLabel(result, priceDisplay)}
              {hasAlt && (
                <span className="ml-1 text-xs font-normal text-neutral-500">
                  ({formatPrice(result, altMode)} {altLabel})
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

export default ResultCard;
