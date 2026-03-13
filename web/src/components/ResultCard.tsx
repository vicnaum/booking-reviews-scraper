'use client';

import { forwardRef } from 'react';
import type { SearchResult } from '@/types';
import { getPriceDisplayInfo, formatRating } from '@/lib/format';
import { useSearchStore } from '@/hooks/useSearchStore';

interface ResultCardProps {
  result: SearchResult;
  isSelected: boolean;
  onClick: () => void;
}

const ResultCard = forwardRef<HTMLDivElement, ResultCardProps>(
  function ResultCard({ result, isSelected, onClick }, ref) {
    const priceDisplay = useSearchStore((s) => s.priceDisplay);
    const checkin = useSearchStore((s) => s.checkin);
    const checkout = useSearchStore((s) => s.checkout);
    const hoverBorder =
      result.platform === 'airbnb'
        ? 'hover:border-red-500/50'
        : 'hover:border-blue-700/50';
    const selectedBorder =
      result.platform === 'airbnb' ? 'border-red-500' : 'border-blue-600';

    const priceInfo = getPriceDisplayInfo(result, priceDisplay, {
      checkin,
      checkout,
    });

    return (
      <div
        ref={ref}
        onClick={onClick}
        className={`cursor-pointer rounded-[22px] border p-3.5 transition-all ${
          isSelected
            ? `${selectedBorder} bg-white/[0.08] shadow-[0_14px_34px_rgba(0,0,0,0.18)]`
            : `border-white/[0.08] bg-white/[0.03] ${hoverBorder} hover:bg-white/[0.06]`
        }`}
      >
        <div className="flex gap-3">
          {result.photoUrl ? (
            <img
              src={result.photoUrl}
              alt={result.name}
              className="h-24 w-24 flex-shrink-0 rounded-2xl object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-2xl bg-black/30 text-xs text-stone-600">
              No photo
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="min-w-0 truncate text-sm font-semibold text-stone-100">
                {result.name}
              </h3>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-xs text-stone-300 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                aria-label={`Open ${result.name} in a new tab`}
                title="Open listing"
              >
                ↗
              </a>
            </div>

            <div className="mt-1.5 flex items-center gap-2 text-xs text-stone-400">
              {formatRating(result) && (
                <span className="font-semibold text-[#f4c06b]">
                  {formatRating(result)}
                </span>
              )}
              {result.reviewCount > 0 && (
                <span>({result.reviewCount})</span>
              )}
              {result.propertyType && (
                <span className="truncate">{result.propertyType}</span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
              {result.bedrooms != null && <span>{result.bedrooms}bd</span>}
              {result.beds != null && <span>{result.beds}bed</span>}
              {result.bathrooms != null && <span>{result.bathrooms}ba</span>}
              {result.maxGuests != null && <span>{result.maxGuests}g</span>}
              {result.superhost && (
                <span className="rounded-full bg-[#ff6b5f]/15 px-2 py-0.5 text-[#ffb4ad]">
                  Superhost
                </span>
              )}
            </div>

            <div className="mt-3 text-sm font-semibold text-white">
              {priceInfo.primary}
              {priceInfo.secondary && (
                <span className="ml-1 text-xs font-medium text-stone-500">
                  ({priceInfo.secondary})
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
