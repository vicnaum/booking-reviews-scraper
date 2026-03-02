'use client';

import { useSearchStore } from '@/hooks/useSearchStore';
import type { Platform } from '@/types';

export default function PlatformToggle() {
  const platform = useSearchStore((s) => s.platform);
  const setPlatform = useSearchStore((s) => s.setPlatform);

  const options: { value: Platform; label: string; color: string }[] = [
    { value: 'airbnb', label: 'Airbnb', color: '#ff5a5f' },
    { value: 'booking', label: 'Booking', color: '#003580' },
  ];

  return (
    <div className="flex rounded-lg border border-neutral-700 overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setPlatform(opt.value)}
          className="px-3 py-1.5 text-xs font-medium transition-colors"
          style={{
            background: platform === opt.value ? opt.color : 'transparent',
            color: platform === opt.value ? '#fff' : '#999',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
