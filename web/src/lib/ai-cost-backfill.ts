import { buildAiCostBreakdown } from './aiCosts.js';

export interface AiCostFields {
  aiReviewsCostUsd: number;
  aiPhotosCostUsd: number;
  triageCostUsd: number;
  totalAiCostUsd: number;
}

export interface AiCostBackfillEntry {
  manifestKey: string;
  platform: 'airbnb' | 'booking';
  listingId: string;
  costs: AiCostFields;
}

export interface AiCostBackfillPlan {
  entries: AiCostBackfillEntry[];
  costs: AiCostFields;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readPhaseCost(entry: Record<string, unknown>, phase: string): number {
  const phaseValue = asRecord(entry[phase]);
  const cost = phaseValue?.cost;
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : 0;
}

function toCostFields(input: {
  aiReviewsCostUsd: number;
  aiPhotosCostUsd: number;
  triageCostUsd: number;
}): AiCostFields {
  const costs = buildAiCostBreakdown(input);
  return {
    aiReviewsCostUsd: costs.aiReviewsUsd,
    aiPhotosCostUsd: costs.aiPhotosUsd,
    triageCostUsd: costs.triageUsd,
    totalAiCostUsd: costs.totalUsd,
  };
}

export function hasZeroAiCosts(costs: AiCostFields): boolean {
  return (
    costs.aiReviewsCostUsd === 0
    && costs.aiPhotosCostUsd === 0
    && costs.triageCostUsd === 0
    && costs.totalAiCostUsd === 0
  );
}

export function buildAiCostBackfillPlan(manifestValue: unknown): AiCostBackfillPlan {
  const manifest = asRecord(manifestValue);
  const listings = asRecord(manifest?.listings);
  if (!manifest || !listings) {
    throw new Error('Manifest must contain a listings object');
  }

  const entries: AiCostBackfillEntry[] = [];
  let aiReviewsCostUsd = 0;
  let aiPhotosCostUsd = 0;
  let triageCostUsd = 0;

  for (const [manifestKey, value] of Object.entries(listings)) {
    const entry = asRecord(value);
    const platform = entry?.platform;
    const listingId = entry?.id;
    if (
      !entry
      || (platform !== 'airbnb' && platform !== 'booking')
      || typeof listingId !== 'string'
      || listingId.length === 0
    ) {
      continue;
    }

    const costs = toCostFields({
      aiReviewsCostUsd: readPhaseCost(entry, 'aiReviews'),
      aiPhotosCostUsd: readPhaseCost(entry, 'aiPhotos'),
      triageCostUsd: readPhaseCost(entry, 'triage'),
    });
    if (hasZeroAiCosts(costs)) {
      continue;
    }

    entries.push({
      manifestKey,
      platform,
      listingId,
      costs,
    });
    aiReviewsCostUsd += costs.aiReviewsCostUsd;
    aiPhotosCostUsd += costs.aiPhotosCostUsd;
    triageCostUsd += costs.triageCostUsd;
  }

  return {
    entries,
    costs: toCostFields({
      aiReviewsCostUsd,
      aiPhotosCostUsd,
      triageCostUsd,
    }),
  };
}
