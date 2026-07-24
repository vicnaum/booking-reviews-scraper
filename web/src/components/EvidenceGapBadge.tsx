import React from 'react';
import type { TriageEvidenceGap } from '@/types';

const GAP_ORDER: TriageEvidenceGap[] = ['details', 'reviews', 'photos'];

interface EvidenceGapBadgeProps {
  gaps: readonly TriageEvidenceGap[] | null | undefined;
  className?: string;
}

export function formatEvidenceGapLabel(
  gaps: readonly TriageEvidenceGap[] | null | undefined,
): string | null {
  const provided = new Set(gaps ?? []);
  const normalized = GAP_ORDER.filter((gap) => provided.has(gap));

  if (normalized.length === 0) {
    return null;
  }

  return `Graded without ${normalized.join(' + ')}`;
}

export default function EvidenceGapBadge({
  gaps,
  className = '',
}: EvidenceGapBadgeProps) {
  const label = formatEvidenceGapLabel(gaps);
  if (!label) {
    return null;
  }

  return (
    <span
      className={`${className} inline-flex rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100`.trim()}
      title={`${label}. Treat this verdict as partial.`}
    >
      {label}
    </span>
  );
}
