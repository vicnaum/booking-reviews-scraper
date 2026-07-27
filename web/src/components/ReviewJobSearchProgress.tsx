import React from 'react';

export function getReviewJobSearchPhaseLabel(currentPhase: string): string {
  if (currentPhase === 'search:booking:bootstrap') {
    return 'Booking browser session';
  }
  if (currentPhase === 'search:booking') {
    return 'Booking area search';
  }
  if (currentPhase === 'search:booking:completed') {
    return 'Booking search complete';
  }
  if (currentPhase === 'search:booking:failed') {
    return 'Booking search ended with a warning';
  }
  if (currentPhase === 'search:airbnb') {
    return 'Airbnb area search';
  }
  if (currentPhase === 'search:airbnb:completed') {
    return 'Airbnb search complete';
  }
  if (currentPhase === 'search:airbnb:failed') {
    return 'Airbnb search ended with a warning';
  }
  return 'Combined Airbnb + Booking search';
}

function searchExpectation(
  currentPhase: string,
  listingCount: number,
): string {
  const saved = `${listingCount} listing${listingCount === 1 ? '' : 's'} saved so far.`;

  if (currentPhase === 'search:booking:bootstrap') {
    return `${saved} Starting Booking's browser session; the first Booking results can take a few minutes.`;
  }
  if (currentPhase.startsWith('search:booking')) {
    return `${saved} Booking is scanning the area and may take a few minutes.`;
  }
  if (currentPhase.startsWith('search:airbnb')) {
    return `${saved} New listings appear as Airbnb search pages and cells complete.`;
  }
  return 'Preparing the combined Airbnb + Booking search.';
}

export default function ReviewJobSearchProgress({
  currentPhase,
  progress,
  listingCount,
}: {
  currentPhase: string;
  progress: number;
  listingCount: number;
}) {
  const percentage = Math.max(0, Math.min(100, Math.round(progress * 100)));

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-xs font-medium text-stone-400">
        <span>{getReviewJobSearchPhaseLabel(currentPhase)}</span>
        <span>{percentage}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#3bcf93,#88e2bc)] transition-all"
          style={{ width: `${Math.max(4, percentage)}%` }}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-stone-500">
        {searchExpectation(currentPhase, listingCount)}
      </p>
    </div>
  );
}
