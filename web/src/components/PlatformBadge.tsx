'use client';

import type { Platform } from '@/types';

interface PlatformBadgeProps {
  platform: Platform;
}

export default function PlatformBadge({ platform }: PlatformBadgeProps) {
  const isAirbnb = platform === 'airbnb';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
        isAirbnb
          ? 'bg-[#ff6b5f]/16 text-[#ffb8b1]'
          : 'bg-[#2870ff]/16 text-[#b9d0ff]'
      }`}
    >
      {isAirbnb ? 'Airbnb' : 'Booking'}
    </span>
  );
}
