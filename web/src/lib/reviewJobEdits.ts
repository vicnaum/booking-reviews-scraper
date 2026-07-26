import type { PhaseStatus } from '../types.js';

export interface QualityBriefEditEffect {
  storedPrompt: string | null;
  qualityBriefChanged: boolean;
  regradeRequired: boolean;
}

export function normalizeQualityBriefForComparison(
  value: string | null | undefined,
): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

export function getQualityBriefEditEffect(input: {
  currentPrompt: string | null | undefined;
  nextPrompt: string | null | undefined;
  analysisStatus: PhaseStatus;
  regradeRequired: boolean;
}): QualityBriefEditEffect {
  const storedPrompt = input.nextPrompt?.trim() || null;
  const qualityBriefChanged =
    normalizeQualityBriefForComparison(input.currentPrompt)
    !== normalizeQualityBriefForComparison(storedPrompt);
  const hasPersistedVerdicts =
    input.analysisStatus === 'completed'
    || input.analysisStatus === 'partial';

  return {
    storedPrompt,
    qualityBriefChanged,
    regradeRequired:
      input.regradeRequired
      || (qualityBriefChanged && hasPersistedVerdicts),
  };
}

export function regradeRequiredAfterAnalysis(
  current: boolean,
  status: 'completed' | 'partial' | 'failed',
): boolean {
  return status === 'completed' ? false : current;
}
