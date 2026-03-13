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
    <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.04] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setPlatform(opt.value)}
          className="rounded-xl px-4 py-2 text-sm font-semibold transition-all"
          style={{
            background:
              platform === opt.value
                ? `linear-gradient(135deg, ${opt.color}, ${opt.color}cc)`
                : 'transparent',
            color: platform === opt.value ? '#fff' : '#a8a29e',
            boxShadow:
              platform === opt.value
                ? '0 10px 22px rgba(0,0,0,0.25)'
                : 'none',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
