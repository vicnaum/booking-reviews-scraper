import type {
  Prisma,
  ReviewJob,
  ReviewJobListing,
  ReviewJobListingAnalysis,
} from '@prisma/client';
import { resolveArtifactCachePolicy } from '@cli/artifact-cache';
import {
  computeAffordability,
  type AffordabilityBudget,
  type AffordabilityResult,
  type ComparableStayAvailability,
  type ComparableStayPrice,
} from '@cli/triage-rubric';
import {
  getStaySnapshotReadModel,
  type StayRequestFingerprint,
  type StaySnapshotReadModel,
} from '@cli/stay-snapshot';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function linkedRoomIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const blockId =
      parsed.searchParams.get('matching_block_id')
      ?? parsed.searchParams.get('highlighted_blocks');
    return blockId?.match(/^(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function resolveStaySnapshotTtlMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return resolveArtifactCachePolicy(env).ttlMs.details;
}

export function buildReviewJobStayRequest(input: {
  job: Pick<ReviewJob, 'checkin' | 'checkout' | 'adults'>;
  listing: Pick<ReviewJobListing, 'platform' | 'listingId' | 'url'>;
}): StayRequestFingerprint {
  return {
    platform: input.listing.platform,
    listingId: input.listing.listingId,
    checkIn: input.job.checkin ?? null,
    checkOut: input.job.checkout ?? null,
    adults: input.job.adults ?? null,
    linkedRoomId:
      input.listing.platform === 'booking'
        ? linkedRoomIdFromUrl(input.listing.url)
        : null,
  };
}

export function getStoredBriefBudget(
  triage: unknown,
): AffordabilityBudget | null {
  const triageRecord = asRecord(triage);
  const requirementSet = asRecord(triageRecord?.requirementSet);
  const parsedBudget = asRecord(requirementSet?.parsedBudget);
  const maximumAmount = Number(parsedBudget?.maximumAmount);
  const currency =
    typeof parsedBudget?.currency === 'string'
      ? parsedBudget.currency.trim().toUpperCase()
      : '';
  if (
    parsedBudget?.basis !== 'stay'
    || parsedBudget?.source !== 'brief'
    || !Number.isFinite(maximumAmount)
    || maximumAmount <= 0
    || !/^[A-Z]{3}$/.test(currency)
  ) {
    return null;
  }
  return {
    amount: maximumAmount,
    currency,
    basis: 'stay',
    source: 'brief',
  };
}

export function getReviewJobAffordabilityBudget(input: {
  job: Pick<
    ReviewJob,
    'analysisBudgetAmount' | 'analysisBudgetCurrency'
  >;
  triage: unknown;
}): AffordabilityBudget | null {
  if (
    input.job.analysisBudgetAmount != null
    && input.job.analysisBudgetCurrency
  ) {
    return {
      amount: input.job.analysisBudgetAmount,
      currency: input.job.analysisBudgetCurrency,
      basis: 'stay',
      source: 'explicit',
    };
  }
  return getStoredBriefBudget(input.triage);
}

export function getReviewJobStaySnapshotReadModel(input: {
  job: Pick<
    ReviewJob,
    'checkin' | 'checkout' | 'adults'
  >;
  listing: Pick<
    ReviewJobListing,
    | 'platform'
    | 'listingId'
    | 'url'
    | 'staySnapshot'
    | 'priceRefreshAttempt'
  >;
  analysis?: Pick<ReviewJobListingAnalysis, 'details'> | null;
  ttlMs?: number;
  now?: Date | number;
}): StaySnapshotReadModel {
  const details = asRecord(input.analysis?.details);
  return getStaySnapshotReadModel({
    snapshot:
      input.listing.staySnapshot
      ?? details?.staySnapshot
      ?? null,
    fallbackRequest: buildReviewJobStayRequest(input),
    refreshAttempt: input.listing.priceRefreshAttempt,
    ttlMs: input.ttlMs ?? resolveStaySnapshotTtlMs(),
    now: input.now,
  });
}

export function getComparableStaySnapshotPrice(
  snapshot: StaySnapshotReadModel,
): ComparableStayPrice | null {
  return snapshot.priceForStay
    ? {
        ...snapshot.priceForStay,
        freshness: snapshot.freshness.price,
      }
    : null;
}

export function getComparableStaySnapshotAvailability(
  snapshot: StaySnapshotReadModel,
): ComparableStayAvailability {
  return {
    ...snapshot.availability,
    freshness: snapshot.freshness.availability,
  };
}

export function computeReviewJobSnapshotAffordability(input: {
  job: Pick<
    ReviewJob,
    'analysisBudgetAmount' | 'analysisBudgetCurrency'
  >;
  triage: Prisma.JsonValue | Record<string, unknown> | null | undefined;
  snapshot: StaySnapshotReadModel;
  now?: Date;
}): AffordabilityResult {
  return computeAffordability({
    budget: getReviewJobAffordabilityBudget({
      job: input.job,
      triage: input.triage,
    }),
    price: getComparableStaySnapshotPrice(input.snapshot),
    availability: getComparableStaySnapshotAvailability(input.snapshot),
    now: input.now,
  });
}
