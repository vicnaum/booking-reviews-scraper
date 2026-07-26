import {
  getCurrentTriageComparability,
  getTriageComparabilityKey,
} from './triage-comparability.js';
import type {
  RequirementConfidence,
  RequirementStatus,
  RequirementType,
} from './triage-rubric.js';
import type {
  StayAvailabilityStatus,
  StaySnapshotFreshness,
} from './stay-snapshot.js';

export const PRIORITIES_MATRIX_SCHEMA_VERSION = 1;

export type PrioritiesMatrixEvidenceGap =
  | 'details'
  | 'reviews'
  | 'photos';

export type PrioritiesMatrixRankingStatus =
  | 'ranked'
  | 'insufficient_evidence'
  | 'legacy'
  | 'stale_requirement_set'
  | 'stale_classifier_policy'
  | 'unscored';

export interface PrioritiesMatrixFrequency {
  raw: string | null;
  mentions: number | null;
  analyzedReviewCount: number | null;
  denominatorMeaning: 'ai_analyzed_reviews' | null;
  display: string | null;
}

export interface PrioritiesMatrixEvidence {
  layer: 'details' | 'reviews' | 'photos' | 'unknown';
  polarity: 'supports' | 'contradicts' | 'unknown';
  text: string;
  frequency: PrioritiesMatrixFrequency;
  years: number[];
}

export interface PrioritiesMatrixPriorityCell {
  requirementId: string;
  state: 'classified' | 'missing' | 'unavailable';
  unavailableReason: Exclude<
    PrioritiesMatrixRankingStatus,
    'ranked' | 'insufficient_evidence'
  > | 'requirement_missing' | null;
  status: RequirementStatus;
  confidence: RequirementConfidence | null;
  note: string | null;
  strongestEvidence: PrioritiesMatrixEvidence | null;
  evidence: PrioritiesMatrixEvidence[];
  evidenceGaps: PrioritiesMatrixEvidenceGap[];
}

export interface PrioritiesMatrixPriorityColumn {
  requirementId: string;
  label: string;
  type: RequirementType | null;
  rank: number | null;
  weight: number | null;
  order: number;
  sourceText: string | null;
  criteria: string[];
}

export interface PrioritiesMatrixReviewSample {
  totalScrapedReviewCount: number | null;
  eligibleReviewCount: number | null;
  analyzedReviewCount: number | null;
  capped: boolean | null;
  source: 'batch_manifest' | 'unknown';
}

export interface PrioritiesMatrixAvailability {
  status: StayAvailabilityStatus;
  freshness: StaySnapshotFreshness;
  eligibility: 'eligible' | 'excluded' | 'conditional' | 'unknown';
  reasonCode: string | null;
  reason: string | null;
  capturedAt: string | null;
  availableRange: {
    checkIn: string;
    checkOut: string;
  } | null;
}

export interface PrioritiesMatrixAffordability {
  status: 'within' | 'over' | 'unknown';
  reasonCode: string | null;
  reason: string | null;
  budgetAmount: number | null;
  priceAmount: number | null;
  currency: string | null;
  overByAmount: number | null;
  overByPercent: number | null;
}

export interface PrioritiesMatrixInputRow {
  id: string;
  platform: string;
  name: string;
  url: string;
  triage: unknown;
  availability?: Partial<PrioritiesMatrixAvailability> | null;
  affordability?: Partial<PrioritiesMatrixAffordability> | null;
  reviewSample?: Partial<PrioritiesMatrixReviewSample> | null;
}

export interface PrioritiesMatrixRow {
  id: string;
  platform: string;
  name: string;
  url: string;
  sourceOrder: number;
  rankingStatus: PrioritiesMatrixRankingStatus;
  coverage: number | null;
  reviewSample: PrioritiesMatrixReviewSample;
  availability: PrioritiesMatrixAvailability;
  affordability: PrioritiesMatrixAffordability;
  priorities: Record<string, PrioritiesMatrixPriorityCell>;
}

export interface PrioritiesMatrix {
  schemaVersion: typeof PRIORITIES_MATRIX_SCHEMA_VERSION;
  generatedAt: string;
  activeRequirementSetId: string | null;
  fixedAxes: ['availability', 'affordability'];
  columns: PrioritiesMatrixPriorityColumn[];
  rows: PrioritiesMatrixRow[];
}

export type PrioritiesMatrixSortDirection = 'risk' | 'fit';

interface ParsedTriageRequirement {
  requirementId: string;
  label: string;
  type: RequirementType | null;
  rank: number | null;
  weight: number | null;
  order: number;
  sourceText: string | null;
  criteria: string[];
  status: RequirementStatus;
  confidence: RequirementConfidence | null;
  note: string | null;
  evidence: PrioritiesMatrixEvidence[];
}

interface ParsedTriage {
  present: boolean;
  deterministic: boolean;
  requirementSetId: string | null;
  comparabilityKey: string | null;
  rankingStatus: 'ranked' | 'insufficient_evidence' | null;
  coverage: number | null;
  evidenceGaps: PrioritiesMatrixEvidenceGap[];
  definitions: PrioritiesMatrixPriorityColumn[];
  requirements: ParsedTriageRequirement[];
}

const EVIDENCE_GAP_ORDER: PrioritiesMatrixEvidenceGap[] = [
  'details',
  'reviews',
  'photos',
];

const REQUIREMENT_TYPES = new Set<RequirementType>([
  'deal_breaker',
  'must_have',
  'priority',
  'nice_to_have',
]);

const REQUIREMENT_STATUSES = new Set<RequirementStatus>([
  'met',
  'partial',
  'unmet',
  'unknown',
]);

const REQUIREMENT_CONFIDENCES = new Set<RequirementConfidence>([
  'high',
  'medium',
  'low',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return (
    typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
  )
    ? value
    : null;
}

function asRequirementType(value: unknown): RequirementType | null {
  return REQUIREMENT_TYPES.has(value as RequirementType)
    ? value as RequirementType
    : null;
}

function asRequirementStatus(value: unknown): RequirementStatus {
  return REQUIREMENT_STATUSES.has(value as RequirementStatus)
    ? value as RequirementStatus
    : 'unknown';
}

function asRequirementConfidence(
  value: unknown,
): RequirementConfidence | null {
  return REQUIREMENT_CONFIDENCES.has(value as RequirementConfidence)
    ? value as RequirementConfidence
    : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(asString)
    .filter((item): item is string => item != null);
}

function asYearArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is number =>
          typeof item === 'number'
          && Number.isInteger(item)
          && item >= 1900
          && item <= 3000,
      ),
    ),
  ].sort((left, right) => right - left);
}

export function parsePrioritiesMatrixFrequency(
  value: unknown,
): PrioritiesMatrixFrequency {
  const raw = asString(value);
  if (!raw) {
    return {
      raw: null,
      mentions: null,
      analyzedReviewCount: null,
      denominatorMeaning: null,
      display: null,
    };
  }

  const match = raw.match(
    /\b([\d,]+)\s*(?:\/|of|out\s+of)\s*([\d,]+)\b/i,
  );
  const mentions = match ? Number(match[1].replace(/,/g, '')) : null;
  const analyzedReviewCount = match
    ? Number(match[2].replace(/,/g, ''))
    : null;
  const hasValidRatio =
    mentions != null
    && analyzedReviewCount != null
    && Number.isInteger(mentions)
    && Number.isInteger(analyzedReviewCount)
    && mentions >= 0
    && analyzedReviewCount > 0
    && mentions <= analyzedReviewCount;

  if (!hasValidRatio) {
    return {
      raw,
      mentions: null,
      analyzedReviewCount: null,
      denominatorMeaning: null,
      display: raw,
    };
  }

  return {
    raw,
    mentions,
    analyzedReviewCount,
    denominatorMeaning: 'ai_analyzed_reviews',
    display:
      `${mentions.toLocaleString('en-US')} of `
      + `${analyzedReviewCount.toLocaleString('en-US')} AI-analyzed reviews`,
  };
}

function parseEvidence(value: unknown): PrioritiesMatrixEvidence | null {
  if (!isRecord(value)) return null;
  const text = asString(value.text);
  if (!text) return null;

  const layer =
    value.layer === 'details'
    || value.layer === 'reviews'
    || value.layer === 'photos'
      ? value.layer
      : 'unknown';
  const polarity =
    value.polarity === 'supports'
    || value.polarity === 'contradicts'
      ? value.polarity
      : 'unknown';

  return {
    layer,
    polarity,
    text,
    frequency: parsePrioritiesMatrixFrequency(value.frequency),
    years: asYearArray(value.years),
  };
}

function parseDefinition(
  value: unknown,
  fallbackOrder: number,
): PrioritiesMatrixPriorityColumn | null {
  if (!isRecord(value)) return null;
  const requirementId = asString(value.id) ?? asString(value.requirementId);
  if (!requirementId) return null;

  return {
    requirementId,
    label:
      asString(value.label)
      ?? asString(value.requirement)
      ?? requirementId,
    type: asRequirementType(value.type),
    rank: asNumber(value.rank),
    weight: asNumber(value.weight),
    order: asNumber(value.order) ?? fallbackOrder,
    sourceText: asString(value.sourceText),
    criteria: asStringArray(value.criteria),
  };
}

function parseRequirement(
  value: unknown,
  fallbackOrder: number,
): ParsedTriageRequirement | null {
  const definition = parseDefinition(value, fallbackOrder);
  if (!definition || !isRecord(value)) return null;
  const requirementId =
    asString(value.requirementId) ?? definition.requirementId;

  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .map(parseEvidence)
        .filter((item): item is PrioritiesMatrixEvidence => item != null)
    : [];

  return {
    ...definition,
    requirementId,
    status: asRequirementStatus(value.status),
    confidence: asRequirementConfidence(value.confidence),
    note: asString(value.note),
    evidence,
  };
}

function parseEvidenceGaps(value: unknown): PrioritiesMatrixEvidenceGap[] {
  if (!Array.isArray(value)) return [];
  const provided = new Set(value);
  return EVIDENCE_GAP_ORDER.filter((gap) => provided.has(gap));
}

function parseTriage(value: unknown): ParsedTriage {
  if (!isRecord(value)) {
    return {
      present: false,
      deterministic: false,
      requirementSetId: null,
      comparabilityKey: null,
      rankingStatus: null,
      coverage: null,
      evidenceGaps: [],
      definitions: [],
      requirements: [],
    };
  }

  const requirementSetId = asString(value.requirementSetId);
  const rubricVersion = asString(value.rubricVersion);
  const classifierVersion = asString(value.classifierVersion);
  const deterministic =
    value.scoreSource === 'deterministic_rubric'
    && requirementSetId != null
    && rubricVersion != null;
  const requirementSet = isRecord(value.requirementSet)
    ? value.requirementSet
    : null;
  const definitions = Array.isArray(requirementSet?.definitions)
    ? requirementSet.definitions
        .map(parseDefinition)
        .filter(
          (item): item is PrioritiesMatrixPriorityColumn => item != null,
        )
    : [];
  const requirements = Array.isArray(value.requirements)
    ? value.requirements
        .map(parseRequirement)
        .filter((item): item is ParsedTriageRequirement => item != null)
    : [];

  return {
    present: true,
    deterministic,
    requirementSetId: deterministic ? requirementSetId : null,
    comparabilityKey:
      deterministic
        ? getTriageComparabilityKey({
            rubricVersion,
            requirementSetId,
            classifierVersion,
          })
        : null,
    rankingStatus:
      value.rankingStatus === 'insufficient_evidence'
        ? 'insufficient_evidence'
        : value.rankingStatus === 'ranked'
          ? 'ranked'
          : null,
    coverage: asNumber(value.coverage),
    evidenceGaps: parseEvidenceGaps(value.evidenceGaps),
    definitions,
    requirements,
  };
}

function getActiveRequirementSetId(
  triages: ParsedTriage[],
): string | null {
  const counts = new Map<string, { count: number; firstIndex: number }>();
  triages.forEach((triage, index) => {
    if (!triage.deterministic || !triage.requirementSetId) return;
    const current = counts.get(triage.requirementSetId);
    counts.set(triage.requirementSetId, {
      count: (current?.count ?? 0) + 1,
      firstIndex: current?.firstIndex ?? index,
    });
  });

  return (
    [...counts.entries()]
      .sort(
        (left, right) =>
          right[1].count - left[1].count
          || left[1].firstIndex - right[1].firstIndex,
      )[0]?.[0]
    ?? null
  );
}

function getColumns(
  triages: ParsedTriage[],
  activeRequirementSetId: string | null,
): PrioritiesMatrixPriorityColumn[] {
  if (!activeRequirementSetId) return [];
  const activeComparison = getCurrentTriageComparability(
    activeRequirementSetId,
  );
  const candidates = triages
    .map((triage, index) => ({ triage, index }))
    .filter(
      ({ triage }) =>
        triage.deterministic
        && triage.requirementSetId === activeRequirementSetId,
    )
    .sort(
      (left, right) =>
        Number(right.triage.comparabilityKey === activeComparison.key)
        - Number(left.triage.comparabilityKey === activeComparison.key)
        || right.triage.definitions.length - left.triage.definitions.length
        || right.triage.requirements.length - left.triage.requirements.length
        || left.index - right.index,
    );
  const selected = candidates[0]?.triage;
  if (!selected) return [];

  const source =
    selected.definitions.length > 0
      ? selected.definitions
      : selected.requirements;
  const seen = new Set<string>();
  return source
    .filter((column) => {
      if (seen.has(column.requirementId)) return false;
      seen.add(column.requirementId);
      return true;
    })
    .map((column) => ({
      requirementId: column.requirementId,
      label: column.label,
      type: column.type,
      rank: column.rank,
      weight: column.weight,
      order: column.order,
      sourceText: column.sourceText,
      criteria: [...column.criteria],
    }))
    .sort(
      (left, right) =>
        left.order - right.order
        || left.requirementId.localeCompare(right.requirementId),
    );
}

function getRowRankingStatus(
  triage: ParsedTriage,
  activeRequirementSetId: string | null,
): PrioritiesMatrixRankingStatus {
  if (!triage.deterministic) {
    return triage.present ? 'legacy' : 'unscored';
  }
  if (
    activeRequirementSetId
    && triage.requirementSetId !== activeRequirementSetId
  ) {
    return 'stale_requirement_set';
  }
  if (
    activeRequirementSetId
    && triage.comparabilityKey
      !== getCurrentTriageComparability(activeRequirementSetId).key
  ) {
    return 'stale_classifier_policy';
  }
  if (
    triage.rankingStatus === 'insufficient_evidence'
    || (triage.coverage != null && triage.coverage < 0.5)
  ) {
    return 'insufficient_evidence';
  }
  return 'ranked';
}

function selectStrongestEvidence(
  status: RequirementStatus,
  evidence: PrioritiesMatrixEvidence[],
): PrioritiesMatrixEvidence | null {
  const preferredPolarity =
    status === 'met'
      ? 'supports'
      : status === 'unmet' || status === 'partial'
        ? 'contradicts'
        : null;
  return (
    (preferredPolarity
      ? evidence.find((item) => item.polarity === preferredPolarity)
      : null)
    ?? evidence[0]
    ?? null
  );
}

function unavailableCell(
  requirementId: string,
  reason: PrioritiesMatrixPriorityCell['unavailableReason'],
  evidenceGaps: PrioritiesMatrixEvidenceGap[],
): PrioritiesMatrixPriorityCell {
  return {
    requirementId,
    state: reason === 'requirement_missing' ? 'missing' : 'unavailable',
    unavailableReason: reason,
    status: 'unknown',
    confidence: null,
    note: null,
    strongestEvidence: null,
    evidence: [],
    evidenceGaps,
  };
}

function buildPriorityCells(input: {
  triage: ParsedTriage;
  columns: PrioritiesMatrixPriorityColumn[];
  rankingStatus: PrioritiesMatrixRankingStatus;
}): Record<string, PrioritiesMatrixPriorityCell> {
  const requirements = new Map(
    input.triage.requirements.map((requirement) => [
      requirement.requirementId,
      requirement,
    ]),
  );

  return Object.fromEntries(
    input.columns.map((column) => {
      if (
        input.rankingStatus !== 'ranked'
        && input.rankingStatus !== 'insufficient_evidence'
      ) {
        return [
          column.requirementId,
          unavailableCell(
            column.requirementId,
            input.rankingStatus,
            input.triage.evidenceGaps,
          ),
        ];
      }

      const requirement = requirements.get(column.requirementId);
      if (!requirement) {
        return [
          column.requirementId,
          unavailableCell(
            column.requirementId,
            'requirement_missing',
            input.triage.evidenceGaps,
          ),
        ];
      }

      return [
        column.requirementId,
        {
          requirementId: column.requirementId,
          state: 'classified',
          unavailableReason: null,
          status: requirement.status,
          confidence: requirement.confidence,
          note: requirement.note,
          strongestEvidence: selectStrongestEvidence(
            requirement.status,
            requirement.evidence,
          ),
          evidence: requirement.evidence,
          evidenceGaps: input.triage.evidenceGaps,
        },
      ];
    }),
  );
}

function normalizeReviewSample(
  value: PrioritiesMatrixInputRow['reviewSample'],
): PrioritiesMatrixReviewSample {
  const totalScrapedReviewCount = asNonNegativeInteger(
    value?.totalScrapedReviewCount,
  );
  const eligibleReviewCount = asNonNegativeInteger(
    value?.eligibleReviewCount,
  );
  const analyzedReviewCount = asNonNegativeInteger(
    value?.analyzedReviewCount,
  );
  const hasManifestSample =
    value?.source === 'batch_manifest'
    && (analyzedReviewCount != null || eligibleReviewCount != null);

  return {
    totalScrapedReviewCount,
    eligibleReviewCount,
    analyzedReviewCount,
    capped:
      typeof value?.capped === 'boolean'
        ? value.capped
        : analyzedReviewCount != null && eligibleReviewCount != null
          ? analyzedReviewCount < eligibleReviewCount
          : null,
    source: hasManifestSample ? 'batch_manifest' : 'unknown',
  };
}

function normalizeAvailability(
  value: PrioritiesMatrixInputRow['availability'],
): PrioritiesMatrixAvailability {
  const availableRange =
    isRecord(value?.availableRange)
    && asString(value.availableRange.checkIn)
    && asString(value.availableRange.checkOut)
      ? {
          checkIn: asString(value.availableRange.checkIn)!,
          checkOut: asString(value.availableRange.checkOut)!,
        }
      : null;

  return {
    status:
      value?.status === 'yes'
      || value?.status === 'no'
      || value?.status === 'partial'
      || value?.status === 'unknown'
        ? value.status
        : 'unknown',
    freshness:
      value?.freshness === 'fresh'
      || value?.freshness === 'stale'
      || value?.freshness === 'unknown'
        ? value.freshness
        : 'unknown',
    eligibility:
      value?.eligibility === 'eligible'
      || value?.eligibility === 'excluded'
      || value?.eligibility === 'conditional'
      || value?.eligibility === 'unknown'
        ? value.eligibility
        : 'unknown',
    reasonCode: asString(value?.reasonCode),
    reason: asString(value?.reason),
    capturedAt: asString(value?.capturedAt),
    availableRange,
  };
}

function normalizeAffordability(
  value: PrioritiesMatrixInputRow['affordability'],
): PrioritiesMatrixAffordability {
  return {
    status:
      value?.status === 'within'
      || value?.status === 'over'
      || value?.status === 'unknown'
        ? value.status
        : 'unknown',
    reasonCode: asString(value?.reasonCode),
    reason: asString(value?.reason),
    budgetAmount: asNumber(value?.budgetAmount),
    priceAmount: asNumber(value?.priceAmount),
    currency: asString(value?.currency),
    overByAmount: asNumber(value?.overByAmount),
    overByPercent: asNumber(value?.overByPercent),
  };
}

export function buildPrioritiesMatrix(
  rows: PrioritiesMatrixInputRow[],
  options: { generatedAt?: string } = {},
): PrioritiesMatrix {
  const triages = rows.map((row) => parseTriage(row.triage));
  const activeRequirementSetId = getActiveRequirementSetId(triages);
  const columns = getColumns(triages, activeRequirementSetId);

  return {
    schemaVersion: PRIORITIES_MATRIX_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    activeRequirementSetId,
    fixedAxes: ['availability', 'affordability'],
    columns,
    rows: rows.map((row, index) => {
      const triage = triages[index];
      const rankingStatus = getRowRankingStatus(
        triage,
        activeRequirementSetId,
      );
      return {
        id: row.id,
        platform: row.platform,
        name: row.name,
        url: row.url,
        sourceOrder: index,
        rankingStatus,
        coverage: triage.coverage,
        reviewSample: normalizeReviewSample(row.reviewSample),
        availability: normalizeAvailability(row.availability),
        affordability: normalizeAffordability(row.affordability),
        priorities: buildPriorityCells({
          triage,
          columns,
          rankingStatus,
        }),
      };
    }),
  };
}

export function getPrioritiesMatrixRankingGroup(
  status: PrioritiesMatrixRankingStatus,
): number {
  switch (status) {
    case 'ranked':
      return 0;
    case 'insufficient_evidence':
      return 1;
    case 'stale_classifier_policy':
      return 2;
    case 'legacy':
    case 'stale_requirement_set':
      return 3;
    case 'unscored':
      return 4;
  }
}

function priorityRiskRank(
  status: RequirementStatus,
): number {
  switch (status) {
    case 'unmet':
      return 0;
    case 'partial':
      return 1;
    case 'unknown':
      return 2;
    case 'met':
      return 3;
  }
}

function availabilityRiskRank(
  availability: PrioritiesMatrixAvailability,
): number {
  switch (availability.eligibility) {
    case 'excluded':
      return 0;
    case 'conditional':
      return 1;
    case 'unknown':
      return 2;
    case 'eligible':
      return 3;
  }
}

function affordabilityRiskRank(
  affordability: PrioritiesMatrixAffordability,
): number {
  switch (affordability.status) {
    case 'over':
      return 0;
    case 'unknown':
      return 1;
    case 'within':
      return 2;
  }
}

function compareNullableDescending(
  left: number | null,
  right: number | null,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

function frequencyRate(
  cell: PrioritiesMatrixPriorityCell | undefined,
): number | null {
  const frequency = cell?.strongestEvidence?.frequency;
  if (
    frequency?.mentions == null
    || frequency.analyzedReviewCount == null
    || frequency.analyzedReviewCount <= 0
  ) {
    return null;
  }
  return frequency.mentions / frequency.analyzedReviewCount;
}

export function sortPrioritiesMatrixRows(
  rows: PrioritiesMatrixRow[],
  sortKey: 'availability' | 'affordability' | string | null,
  direction: PrioritiesMatrixSortDirection = 'risk',
): PrioritiesMatrixRow[] {
  const factor = direction === 'risk' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const groupDifference =
      getPrioritiesMatrixRankingGroup(left.rankingStatus)
      - getPrioritiesMatrixRankingGroup(right.rankingStatus);
    if (groupDifference !== 0) return groupDifference;
    if (!sortKey) return left.sourceOrder - right.sourceOrder;

    if (sortKey === 'availability') {
      const difference =
        availabilityRiskRank(left.availability)
        - availabilityRiskRank(right.availability);
      if (difference !== 0) return difference * factor;
    } else if (sortKey === 'affordability') {
      const difference =
        affordabilityRiskRank(left.affordability)
        - affordabilityRiskRank(right.affordability);
      if (difference !== 0) return difference * factor;
      if (
        left.affordability.status === 'over'
        && right.affordability.status === 'over'
      ) {
        const overageDifference = compareNullableDescending(
          left.affordability.overByPercent,
          right.affordability.overByPercent,
        );
        if (overageDifference !== 0) return overageDifference * factor;
      }
    } else {
      const leftCell = left.priorities[sortKey];
      const rightCell = right.priorities[sortKey];
      const difference =
        priorityRiskRank(leftCell?.status ?? 'unknown')
        - priorityRiskRank(rightCell?.status ?? 'unknown');
      if (difference !== 0) return difference * factor;

      const frequencyDifference = compareNullableDescending(
        frequencyRate(leftCell),
        frequencyRate(rightCell),
      );
      if (frequencyDifference !== 0) return frequencyDifference * factor;
    }

    return left.sourceOrder - right.sourceOrder;
  });
}
