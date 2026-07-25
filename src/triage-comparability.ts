export const TRIAGE_RUBRIC_VERSION = '1';
export const TRIAGE_CLASSIFIER_VERSION = 'triage-classifier-v2';
export const LEGACY_TRIAGE_CLASSIFIER_VERSION = 'triage-classifier-v1';
export const ESTIMATED_TRIAGE_COST_USD_PER_LISTING = 0.006;

export type TriageClassifierVersion =
  | typeof LEGACY_TRIAGE_CLASSIFIER_VERSION
  | typeof TRIAGE_CLASSIFIER_VERSION;

export interface TriageComparabilityMetadata {
  rubricVersion?: unknown;
  requirementSetId?: unknown;
  classifierVersion?: unknown;
}

export interface TriageComparabilityDescriptor {
  key: string;
  rubricVersion: string;
  requirementSetId: string;
  classifierVersion: string;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : null;
}

/**
 * The only key used to decide whether two deterministic triage verdicts may
 * rank together. Model identity is deliberately excluded: it is audit
 * metadata, while requirement definitions, scoring policy, and classification
 * policy define comparability.
 */
export function getTriageComparabilityKey(
  metadata: TriageComparabilityMetadata,
): string | null {
  const rubricVersion = nonEmptyString(metadata.rubricVersion);
  const requirementSetId = nonEmptyString(metadata.requirementSetId);
  const classifierVersion = nonEmptyString(metadata.classifierVersion);
  if (!rubricVersion || !requirementSetId || !classifierVersion) {
    return null;
  }

  return JSON.stringify([
    rubricVersion,
    requirementSetId,
    classifierVersion,
  ]);
}

export function getCurrentTriageComparability(
  requirementSetId: string,
): TriageComparabilityDescriptor {
  const key = getTriageComparabilityKey({
    rubricVersion: TRIAGE_RUBRIC_VERSION,
    requirementSetId,
    classifierVersion: TRIAGE_CLASSIFIER_VERSION,
  });
  if (!key) {
    throw new Error('A current triage comparability key could not be built.');
  }

  return {
    key,
    rubricVersion: TRIAGE_RUBRIC_VERSION,
    requirementSetId,
    classifierVersion: TRIAGE_CLASSIFIER_VERSION,
  };
}

export function estimateTriageRegradeCostUsd(listingCount: number): number {
  if (!Number.isFinite(listingCount) || listingCount <= 0) {
    return 0;
  }
  return (
    Math.ceil(listingCount)
    * ESTIMATED_TRIAGE_COST_USD_PER_LISTING
  );
}
