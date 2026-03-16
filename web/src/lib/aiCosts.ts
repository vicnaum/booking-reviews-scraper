import type { AiCostBreakdown } from '../types.js';

function sanitizeCost(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(4));
}

export function buildAiCostBreakdown(input: {
  aiReviewsCostUsd?: number | null;
  aiPhotosCostUsd?: number | null;
  triageCostUsd?: number | null;
  totalAiCostUsd?: number | null;
}): AiCostBreakdown {
  const aiReviewsUsd = sanitizeCost(input.aiReviewsCostUsd);
  const aiPhotosUsd = sanitizeCost(input.aiPhotosCostUsd);
  const triageUsd = sanitizeCost(input.triageCostUsd);
  const summedTotal = sanitizeCost(aiReviewsUsd + aiPhotosUsd + triageUsd);
  const totalUsd = sanitizeCost(input.totalAiCostUsd ?? summedTotal);

  return {
    aiReviewsUsd,
    aiPhotosUsd,
    triageUsd,
    totalUsd,
  };
}

export function formatUsdCost(amount: number | null | undefined): string {
  const safeAmount = sanitizeCost(amount);

  if (safeAmount === 0) {
    return '$0.00';
  }

  if (safeAmount >= 100) {
    return `$${safeAmount.toFixed(0)}`;
  }

  if (safeAmount >= 1) {
    return `$${safeAmount.toFixed(2)}`;
  }

  return `$${safeAmount.toFixed(4)}`;
}

export function hasAiCosts(costs: AiCostBreakdown | null | undefined): boolean {
  return !!costs && costs.totalUsd > 0;
}
