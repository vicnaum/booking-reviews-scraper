import { createHash } from 'node:crypto';
import { TRIAGE_RUBRIC_VERSION } from './triage-comparability.js';
import type {
  StayAvailabilityStatus,
  StayDateRange,
  StaySnapshotFreshness,
} from './stay-snapshot.js';

export { TRIAGE_RUBRIC_VERSION } from './triage-comparability.js';
export const REQUIREMENT_SCHEMA_VERSION = '1';
export const MIN_RANKED_COVERAGE = 0.5;

export type RequirementType =
  | 'deal_breaker'
  | 'must_have'
  | 'priority'
  | 'nice_to_have';

export type RequirementStatus = 'met' | 'partial' | 'unmet' | 'unknown';
export type RequirementConfidence = 'high' | 'medium' | 'low';
export type TriageTier =
  | 'top_pick'
  | 'shortlist'
  | 'consider'
  | 'unlikely'
  | 'no_go';
export type TriageRankingStatus = 'ranked' | 'insufficient_evidence';

export interface CanonicalRequirementInput {
  label: string;
  type: RequirementType;
  rank?: number | null;
  sourceText?: string | null;
  criteria?: string[];
  order?: number;
}

export interface CanonicalRequirement {
  id: string;
  label: string;
  type: RequirementType;
  rank: number | null;
  weight: number;
  sourceText: string;
  criteria: string[];
  order: number;
}

export interface ParsedAnalysisBudget {
  minimumAmount?: number | null;
  maximumAmount: number;
  currency: string;
  basis: 'stay';
  source: 'brief';
}

export interface CanonicalRequirementSet {
  id: string;
  schemaVersion: typeof REQUIREMENT_SCHEMA_VERSION;
  parserVersion: string;
  brief: string | null;
  definitions: CanonicalRequirement[];
  parsedBudget: ParsedAnalysisBudget | null;
}

export interface RequirementEvidence {
  layer: 'details' | 'reviews' | 'photos';
  polarity: 'supports' | 'contradicts';
  text: string;
  frequency?: string | null;
  years?: number[];
}

export interface RequirementAssessmentInput {
  requirementId: string;
  status: RequirementStatus;
  confidence: RequirementConfidence;
  note: string;
  evidence?: RequirementEvidence[];
}

export interface ScoredRequirementAssessment
  extends RequirementAssessmentInput {
  requirement: string;
  label: string;
  type: RequirementType;
  rank: number | null;
  weight: number;
  order: number;
  effective: number;
}

export interface DeterministicTriageScore {
  scoreSource: 'deterministic_rubric';
  rubricVersion: typeof TRIAGE_RUBRIC_VERSION;
  requirementSetId: string;
  rawFitScore: number;
  fitScore: number;
  tier: TriageTier;
  capReasons: string[];
  coverage: number;
  rankingStatus: TriageRankingStatus;
  rankingReason: string | null;
  requirements: ScoredRequirementAssessment[];
}

export interface AffordabilityBudget {
  amount: number | string;
  currency: string;
  basis: 'stay';
  source: 'explicit' | 'brief';
}

export interface ComparableStayPrice {
  amount: number | string;
  currency: string;
  basis: 'stay' | 'night' | 'unknown';
  source: string;
  capturedAt?: string | null;
  freshness: 'fresh' | 'stale' | 'unknown';
  rateType: 'public' | 'member' | 'unknown';
  mandatoryChargesResolved: boolean;
}

export interface ComparableStayAvailability {
  status: StayAvailabilityStatus;
  capturedAt?: string | null;
  freshness: StaySnapshotFreshness;
  reasonCode: string;
  availableRange?: StayDateRange;
}

export type AffordabilityUnknownReasonCode =
  | 'no_budget_given'
  | 'invalid_budget'
  | 'price_missing'
  | 'invalid_price'
  | 'price_stale'
  | 'price_freshness_unknown'
  | 'currency_mismatch'
  | 'stay_basis_unresolved'
  | 'mandatory_charges_unresolved'
  | 'rate_not_public'
  | 'stay_unavailable'
  | 'stay_partially_available'
  | 'availability_unknown'
  | 'availability_stale'
  | 'availability_freshness_unknown';

export interface AffordabilityResult {
  status: 'within' | 'over' | 'unknown';
  reasonCode: AffordabilityUnknownReasonCode | null;
  reason: string | null;
  budgetAmount: number | null;
  priceAmount: number | null;
  currency: string | null;
  budgetCurrency: string | null;
  priceCurrency: string | null;
  basis: 'stay';
  priceBasis: ComparableStayPrice['basis'] | null;
  overByAmount: number | null;
  overByPercent: number | null;
  budgetSource: AffordabilityBudget['source'] | null;
  priceSource: string | null;
  priceCapturedAt: string | null;
  freshness: ComparableStayPrice['freshness'] | null;
  rateType: ComparableStayPrice['rateType'] | null;
  mandatoryChargesResolved: boolean | null;
  comparablePrice: ComparableStayPrice | null;
  availabilityStatus: StayAvailabilityStatus | null;
  availabilityCapturedAt: string | null;
  availabilityFreshness: StaySnapshotFreshness | null;
  comparableAvailability: ComparableStayAvailability | null;
}

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

const DEFAULT_REQUIREMENT_INPUTS: CanonicalRequirementInput[] = [
  {
    label: 'Clean and well maintained',
    type: 'priority',
    sourceText: 'Clean and well maintained',
    criteria: ['clean rooms', 'well-maintained fixtures and furnishings'],
  },
  {
    label: 'Comfortable sleep',
    type: 'priority',
    sourceText: 'Comfortable sleep',
    criteria: ['comfortable bed', 'sleep environment without material disruption'],
  },
  {
    label: 'Accurate and functional listing',
    type: 'priority',
    sourceText: 'Accurate and functional listing',
    criteria: ['listing matches reality', 'advertised essentials work'],
  },
  {
    label: 'Convenient location',
    type: 'nice_to_have',
    sourceText: 'Convenient location',
    criteria: ['convenient access for a general traveler'],
  },
];

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function cleanCriteria(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const criterion = cleanText(value);
    const key = criterion.toLocaleLowerCase('en-US');
    if (!criterion || seen.has(key)) continue;
    seen.add(key);
    result.push(criterion);
  }
  return result;
}

function requirementSlug(label: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'requirement';
}

function normalizedCurrency(value: unknown): string {
  return cleanText(value).toLocaleUpperCase('en-US');
}

function normalizeParsedBudget(
  value: ParsedAnalysisBudget | null | undefined,
): ParsedAnalysisBudget | null {
  if (!value) return null;
  const maximumAmount = Number(value.maximumAmount);
  const minimumAmount =
    value.minimumAmount == null ? null : Number(value.minimumAmount);
  const currency = normalizedCurrency(value.currency);
  if (
    !Number.isFinite(maximumAmount)
    || maximumAmount <= 0
    || (minimumAmount != null
      && (!Number.isFinite(minimumAmount)
        || minimumAmount < 0
        || minimumAmount > maximumAmount))
    || !/^[A-Z]{3}$/.test(currency)
  ) {
    return null;
  }
  return {
    ...(minimumAmount == null ? {} : { minimumAmount }),
    maximumAmount,
    currency,
    basis: 'stay',
    source: 'brief',
  };
}

export function resolveRequirementWeight(
  type: RequirementType,
  rank?: number | null,
): number {
  switch (type) {
    case 'deal_breaker':
      return 4;
    case 'must_have':
      return 3;
    case 'priority':
      return rank === 1 ? 3 : 2;
    case 'nice_to_have':
      return 1;
  }
}

export function buildCanonicalRequirementSet(input: {
  brief?: string | null;
  parserVersion: string;
  definitions?: CanonicalRequirementInput[] | null;
  parsedBudget?: ParsedAnalysisBudget | null;
}): CanonicalRequirementSet {
  const parserVersion = cleanText(input.parserVersion);
  if (!parserVersion) {
    throw new Error('Requirement parserVersion is required.');
  }

  const supplied =
    Array.isArray(input.definitions) && input.definitions.length > 0
      ? input.definitions
      : DEFAULT_REQUIREMENT_INPUTS;
  const ordered = supplied
    .map((definition, index) => ({ definition, index }))
    .sort((a, b) => {
      const orderA = Number.isFinite(a.definition.order)
        ? Number(a.definition.order)
        : a.index + 1;
      const orderB = Number.isFinite(b.definition.order)
        ? Number(b.definition.order)
        : b.index + 1;
      return orderA - orderB || a.index - b.index;
    });

  const definitions = ordered.map(({ definition }, index) => {
    const label = cleanText(definition.label);
    if (!label) {
      throw new Error(`Requirement ${index + 1} is missing a label.`);
    }
    if (!REQUIREMENT_TYPES.has(definition.type)) {
      throw new Error(`Requirement ${index + 1} has an invalid type.`);
    }
    const rawRank = definition.rank;
    const rank =
      rawRank != null && Number.isInteger(rawRank) && rawRank > 0
        ? rawRank
        : null;
    return {
      id: `req-${String(index + 1).padStart(2, '0')}-${requirementSlug(label)}`,
      label,
      type: definition.type,
      rank,
      weight: resolveRequirementWeight(definition.type, rank),
      sourceText: cleanText(definition.sourceText) || label,
      criteria: cleanCriteria(definition.criteria),
      order: index + 1,
    } satisfies CanonicalRequirement;
  });

  const hashPayload = {
    schemaVersion: REQUIREMENT_SCHEMA_VERSION,
    parserVersion,
    definitions,
  };
  const definitionHash = createHash('sha256')
    .update(JSON.stringify(hashPayload))
    .digest('hex')
    .slice(0, 20);

  return {
    id: `reqset_${definitionHash}`,
    schemaVersion: REQUIREMENT_SCHEMA_VERSION,
    parserVersion,
    brief: cleanText(input.brief) || null,
    definitions,
    parsedBudget: normalizeParsedBudget(input.parsedBudget),
  };
}

export function getDefaultRequirementInputs(): CanonicalRequirementInput[] {
  return DEFAULT_REQUIREMENT_INPUTS.map((definition) => ({
    ...definition,
    criteria: [...(definition.criteria ?? [])],
  }));
}

export function requirementStatusValue(status: RequirementStatus): number {
  switch (status) {
    case 'met':
      return 1;
    case 'partial':
    case 'unknown':
      return 0.5;
    case 'unmet':
      return 0;
  }
}

export function requirementConfidenceFactor(
  confidence: RequirementConfidence,
): number {
  switch (confidence) {
    case 'high':
      return 1;
    case 'medium':
      return 0.75;
    case 'low':
      return 0.5;
  }
}

export function effectiveRequirementValue(
  status: RequirementStatus,
  confidence: RequirementConfidence,
): number {
  if (status === 'unknown') return 0.5;
  return (
    0.5
    + requirementConfidenceFactor(confidence)
      * (requirementStatusValue(status) - 0.5)
  );
}

export function tierForFitScore(score: number): TriageTier {
  if (score >= 80) return 'top_pick';
  if (score >= 65) return 'shortlist';
  if (score >= 45) return 'consider';
  if (score >= 25) return 'unlikely';
  return 'no_go';
}

function normalizedAssessment(
  definition: CanonicalRequirement,
  assessment: RequirementAssessmentInput | undefined,
): ScoredRequirementAssessment {
  if (!assessment) {
    return {
      requirementId: definition.id,
      requirement: definition.label,
      label: definition.label,
      type: definition.type,
      rank: definition.rank,
      weight: definition.weight,
      order: definition.order,
      status: 'unknown',
      confidence: 'low',
      note: 'The classifier did not return an outcome for this requirement.',
      evidence: [],
      effective: 0.5,
    };
  }
  if (!REQUIREMENT_STATUSES.has(assessment.status)) {
    throw new Error(`Invalid status for ${definition.id}: ${assessment.status}`);
  }
  if (!REQUIREMENT_CONFIDENCES.has(assessment.confidence)) {
    throw new Error(
      `Invalid confidence for ${definition.id}: ${assessment.confidence}`,
    );
  }
  return {
    requirementId: definition.id,
    requirement: definition.label,
    label: definition.label,
    type: definition.type,
    rank: definition.rank,
    weight: definition.weight,
    order: definition.order,
    status: assessment.status,
    confidence: assessment.confidence,
    note: cleanText(assessment.note),
    evidence: Array.isArray(assessment.evidence)
      ? assessment.evidence.map((item) => ({
          ...item,
          text: cleanText(item.text),
          years: Array.isArray(item.years)
            ? item.years.filter((year) => Number.isInteger(year))
            : undefined,
        }))
      : [],
    effective: effectiveRequirementValue(
      assessment.status,
      assessment.confidence,
    ),
  };
}

export function scoreTriageAssessments(
  requirementSet: CanonicalRequirementSet,
  assessments: RequirementAssessmentInput[],
): DeterministicTriageScore {
  if (requirementSet.definitions.length === 0) {
    throw new Error('Cannot score an empty requirement set.');
  }

  const definitionsById = new Map(
    requirementSet.definitions.map((definition) => [definition.id, definition]),
  );
  const assessmentsById = new Map<string, RequirementAssessmentInput>();
  for (const assessment of assessments) {
    if (!definitionsById.has(assessment.requirementId)) {
      throw new Error(
        `Classifier returned unknown requirement ID: ${assessment.requirementId}`,
      );
    }
    if (assessmentsById.has(assessment.requirementId)) {
      throw new Error(
        `Classifier returned duplicate requirement ID: ${assessment.requirementId}`,
      );
    }
    assessmentsById.set(assessment.requirementId, assessment);
  }

  const requirements = requirementSet.definitions.map((definition) =>
    normalizedAssessment(definition, assessmentsById.get(definition.id)));
  const totalWeight = requirements.reduce(
    (sum, requirement) => sum + requirement.weight,
    0,
  );
  const knownWeight = requirements.reduce(
    (sum, requirement) =>
      sum + (requirement.status === 'unknown' ? 0 : requirement.weight),
    0,
  );
  const weightedEffectiveEighths = requirements.reduce(
    (sum, requirement) =>
      sum + requirement.weight * Math.round(requirement.effective * 8),
    0,
  );

  const rawFitScore = Number(
    divideRoundHalfUp(
      BigInt(100 * weightedEffectiveEighths),
      BigInt(8 * totalWeight),
    ),
  );
  const coverage = Number((knownWeight / totalWeight).toFixed(4));
  const caps: Array<{ maximum: number; reason: string }> = [];
  const addCap = (maximum: number, reason: string) => {
    caps.push({ maximum, reason });
  };

  const majorUnmetHigh = requirements.filter(
    (requirement) =>
      requirement.weight >= 3
      && requirement.status === 'unmet'
      && requirement.confidence === 'high',
  );

  for (const requirement of requirements) {
    const key = requirement.requirementId;
    const isCritical = requirement.weight >= 4;
    const isMajor = requirement.weight >= 3;

    if (
      isCritical
      && requirement.status === 'unmet'
      && requirement.confidence === 'high'
    ) {
      addCap(24, `weight_gte_4_unmet_high:${key}`);
    }
    if (
      isMajor
      && requirement.status === 'unmet'
      && requirement.confidence === 'high'
    ) {
      addCap(44, `weight_gte_3_unmet_high:${key}`);
    }
    if (
      isCritical
      && requirement.status === 'unmet'
      && requirement.confidence === 'medium'
    ) {
      addCap(44, `weight_gte_4_unmet_medium:${key}`);
    }
    if (
      isCritical
      && (
        (requirement.status === 'unmet'
          && requirement.confidence === 'low')
        || requirement.status === 'partial'
        || requirement.status === 'unknown'
      )
    ) {
      addCap(64, `weight_gte_4_uncertain_or_unmet_low:${key}`);
    }
    if (
      isMajor
      && (
        (requirement.status === 'unmet'
          && requirement.confidence !== 'high')
        || requirement.status === 'unknown'
      )
    ) {
      addCap(64, `weight_gte_3_unknown_or_unmet_non_high:${key}`);
    }
    if (
      isMajor
      && requirement.status === 'met'
      && requirement.confidence === 'low'
    ) {
      addCap(79, `weight_gte_3_met_low:${key}`);
    }
    if (isMajor && requirement.status === 'partial') {
      addCap(79, `weight_gte_3_partial:${key}`);
    }
  }

  if (majorUnmetHigh.length >= 2) {
    addCap(
      24,
      `multiple_weight_gte_3_unmet_high:${majorUnmetHigh
        .map((requirement) => requirement.requirementId)
        .join(',')}`,
    );
  }

  const maximum = caps.reduce(
    (lowest, cap) => Math.min(lowest, cap.maximum),
    100,
  );
  const fitScore = Math.min(rawFitScore, maximum);
  const rankingStatus: TriageRankingStatus =
    knownWeight / totalWeight < MIN_RANKED_COVERAGE
      ? 'insufficient_evidence'
      : 'ranked';

  return {
    scoreSource: 'deterministic_rubric',
    rubricVersion: TRIAGE_RUBRIC_VERSION,
    requirementSetId: requirementSet.id,
    rawFitScore,
    fitScore,
    tier: tierForFitScore(fitScore),
    capReasons: caps.map((cap) => cap.reason),
    coverage,
    rankingStatus,
    rankingReason:
      rankingStatus === 'insufficient_evidence'
        ? `Insufficient evidence: ${Math.round(
            coverage * 100,
          )}% of requirement weight has a known outcome.`
        : null,
    requirements,
  };
}

function currencyMinorDigits(currency: string): number {
  if (['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
    'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'].includes(currency)) {
    return 0;
  }
  if (['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'].includes(currency)) {
    return 3;
  }
  return 2;
}

function decimalToMinorUnits(
  value: number | string,
  digits: number,
): bigint | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    text = value.toFixed(Math.max(digits + 1, 6));
  } else {
    text = value.trim();
  }
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = match[1];
  const fraction = match[2] ?? '';
  const kept = fraction.slice(0, digits).padEnd(digits, '0');
  let minor = BigInt(whole) * (10n ** BigInt(digits));
  if (kept) minor += BigInt(kept);
  if ((fraction[digits] ?? '0') >= '5') minor += 1n;
  return minor;
}

function minorUnitsToNumber(value: bigint, digits: number): number {
  return Number(value) / (10 ** digits);
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function staleAgeLabel(
  capturedAt: string | null | undefined,
  now: Date,
): string {
  if (!capturedAt) return 'capture age unavailable';
  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedMs)) return 'capture age unavailable';
  const ageMs = Math.max(0, now.getTime() - capturedMs);
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} old`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} old`;
}

export function computeAffordability(input: {
  budget?: AffordabilityBudget | null;
  price?: ComparableStayPrice | null;
  availability?: ComparableStayAvailability | null;
  now?: Date;
}): AffordabilityResult {
  const budget = input.budget ?? null;
  const price = input.price ?? null;
  const availability = input.availability ?? null;
  const now = input.now ?? new Date();
  const budgetCurrencySnapshot = budget
    ? normalizedCurrency(budget.currency) || null
    : null;
  const priceCurrencySnapshot = price
    ? normalizedCurrency(price.currency) || null
    : null;
  const comparablePrice: ComparableStayPrice | null = price
    ? {
        amount: price.amount,
        currency: price.currency,
        basis: price.basis,
        source: price.source,
        capturedAt: price.capturedAt ?? null,
        freshness: price.freshness,
        rateType: price.rateType,
        mandatoryChargesResolved: price.mandatoryChargesResolved,
      }
    : null;
  const comparableAvailability: ComparableStayAvailability | null =
    availability
      ? {
          status: availability.status,
          capturedAt: availability.capturedAt ?? null,
          freshness: availability.freshness,
          reasonCode: availability.reasonCode,
          ...(availability.availableRange
            ? { availableRange: availability.availableRange }
            : {}),
        }
      : null;

  const unknown = (
    reasonCode: AffordabilityUnknownReasonCode,
    reason: string,
    values: Partial<AffordabilityResult> = {},
  ): AffordabilityResult => ({
    status: 'unknown',
    reasonCode,
    reason,
    budgetAmount: null,
    priceAmount: null,
    currency: null,
    budgetCurrency: budgetCurrencySnapshot,
    priceCurrency: priceCurrencySnapshot,
    basis: 'stay',
    priceBasis: price?.basis ?? null,
    overByAmount: null,
    overByPercent: null,
    budgetSource: budget?.source ?? null,
    priceSource: price?.source ?? null,
    priceCapturedAt: price?.capturedAt ?? null,
    freshness: price?.freshness ?? null,
    rateType: price?.rateType ?? null,
    mandatoryChargesResolved: price?.mandatoryChargesResolved ?? null,
    comparablePrice,
    availabilityStatus: availability?.status ?? null,
    availabilityCapturedAt: availability?.capturedAt ?? null,
    availabilityFreshness: availability?.freshness ?? null,
    comparableAvailability,
    ...values,
  });

  if (!budget) {
    return unknown(
      'no_budget_given',
      'No analysis budget was given.',
    );
  }

  const budgetCurrency = normalizedCurrency(budget.currency);
  const budgetDigits = currencyMinorDigits(budgetCurrency);
  const budgetMinor = decimalToMinorUnits(budget.amount, budgetDigits);
  if (
    budget.basis !== 'stay'
    || !/^[A-Z]{3}$/.test(budgetCurrency)
    || budgetMinor == null
    || budgetMinor <= 0n
  ) {
    return unknown(
      'invalid_budget',
      'The analysis budget is invalid or is not a full-stay amount.',
    );
  }
  const budgetAmount = minorUnitsToNumber(budgetMinor, budgetDigits);

  if (availability) {
    const availabilityValues = {
      budgetAmount,
      currency: budgetCurrency,
    };
    if (availability.freshness === 'stale') {
      return unknown(
        'availability_stale',
        `Availability is stale (${staleAgeLabel(availability.capturedAt, now)}).`,
        availabilityValues,
      );
    }
    if (availability.freshness !== 'fresh') {
      return unknown(
        'availability_freshness_unknown',
        'Availability freshness is unknown.',
        availabilityValues,
      );
    }
    if (availability.status === 'no') {
      return unknown(
        'stay_unavailable',
        'The property is unavailable for the recorded dates and guest count.',
        availabilityValues,
      );
    }
    if (availability.status === 'partial') {
      return unknown(
        'stay_partially_available',
        availability.availableRange
          ? (
              `The requested stay is unavailable; the provider offered `
              + `${availability.availableRange.checkIn} to `
              + `${availability.availableRange.checkOut}.`
            )
          : 'The provider offered only conditional or alternate availability.',
        availabilityValues,
      );
    }
    if (availability.status !== 'yes') {
      return unknown(
        'availability_unknown',
        'Availability could not be confirmed for the recorded dates and guest count.',
        availabilityValues,
      );
    }
  }

  if (!price) {
    return unknown(
      'price_missing',
      'Price is missing for the selected stay.',
      { budgetAmount, currency: budgetCurrency },
    );
  }

  const priceCurrency = normalizedCurrency(price.currency);
  const priceDigits = currencyMinorDigits(priceCurrency);
  const priceMinor = decimalToMinorUnits(price.amount, priceDigits);
  if (
    !/^[A-Z]{3}$/.test(priceCurrency)
    || priceMinor == null
    || priceMinor < 0n
  ) {
    return unknown(
      'invalid_price',
      'The selected-stay price is invalid.',
      { budgetAmount, currency: budgetCurrency },
    );
  }
  const priceAmount = minorUnitsToNumber(priceMinor, priceDigits);
  const knownValues = {
    budgetAmount,
    priceAmount,
    currency: budgetCurrency,
    budgetCurrency,
    priceCurrency,
  };

  if (priceCurrency !== budgetCurrency) {
    return unknown(
      'currency_mismatch',
      `Price currency ${priceCurrency} does not match budget currency ${budgetCurrency}.`,
      knownValues,
    );
  }
  if (price.freshness === 'stale') {
    return unknown(
      'price_stale',
      `Price is stale (${staleAgeLabel(price.capturedAt, now)}).`,
      knownValues,
    );
  }
  if (price.freshness !== 'fresh') {
    const age = price.capturedAt
      ? ` (${staleAgeLabel(price.capturedAt, now)})`
      : '';
    return unknown(
      'price_freshness_unknown',
      `Price freshness is unknown${age}.`,
      knownValues,
    );
  }
  if (price.basis !== 'stay') {
    return unknown(
      'stay_basis_unresolved',
      'Price is not a comparable total for the full stay.',
      knownValues,
    );
  }
  if (!price.mandatoryChargesResolved) {
    return unknown(
      'mandatory_charges_unresolved',
      'Mandatory charges are unresolved in this price.',
      knownValues,
    );
  }
  if (price.rateType !== 'public') {
    return unknown(
      'rate_not_public',
      'The available price is not a public rate.',
      knownValues,
    );
  }

  if (priceMinor <= budgetMinor) {
    return {
      status: 'within',
      reasonCode: null,
      reason: null,
      budgetAmount,
      priceAmount,
      currency: budgetCurrency,
      budgetCurrency,
      priceCurrency,
      basis: 'stay',
      priceBasis: price.basis,
      overByAmount: 0,
      overByPercent: 0,
      budgetSource: budget.source,
      priceSource: price.source,
      priceCapturedAt: price.capturedAt ?? null,
      freshness: price.freshness,
      rateType: price.rateType,
      mandatoryChargesResolved: price.mandatoryChargesResolved,
      comparablePrice,
      availabilityStatus: availability?.status ?? null,
      availabilityCapturedAt: availability?.capturedAt ?? null,
      availabilityFreshness: availability?.freshness ?? null,
      comparableAvailability,
    };
  }

  const overMinor = priceMinor - budgetMinor;
  const percentHundredths = divideRoundHalfUp(
    overMinor * 10_000n,
    budgetMinor,
  );
  return {
    status: 'over',
    reasonCode: null,
    reason: null,
    budgetAmount,
    priceAmount,
    currency: budgetCurrency,
    budgetCurrency,
    priceCurrency,
    basis: 'stay',
    priceBasis: price.basis,
    overByAmount: minorUnitsToNumber(overMinor, budgetDigits),
    overByPercent: Number(percentHundredths) / 100,
    budgetSource: budget.source,
    priceSource: price.source,
    priceCapturedAt: price.capturedAt ?? null,
    freshness: price.freshness,
    rateType: price.rateType,
    mandatoryChargesResolved: price.mandatoryChargesResolved,
    comparablePrice,
    availabilityStatus: availability?.status ?? null,
    availabilityCapturedAt: availability?.capturedAt ?? null,
    availabilityFreshness: availability?.freshness ?? null,
    comparableAvailability,
  };
}

function asStoredRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseStoredComparablePrice(
  value: unknown,
): ComparableStayPrice | null | undefined {
  if (value === null) return null;
  const record = asStoredRecord(value);
  if (!record) return undefined;

  const amount = record.amount;
  const currency = record.currency;
  const basis = record.basis;
  const source = record.source;
  const capturedAt = record.capturedAt;
  const freshness = record.freshness;
  const rateType = record.rateType;
  const mandatoryChargesResolved = record.mandatoryChargesResolved;
  if (
    (typeof amount !== 'number' && typeof amount !== 'string')
    || typeof currency !== 'string'
    || (basis !== 'stay' && basis !== 'night' && basis !== 'unknown')
    || typeof source !== 'string'
    || (capturedAt !== null && capturedAt !== undefined
      && typeof capturedAt !== 'string')
    || (freshness !== 'fresh' && freshness !== 'stale'
      && freshness !== 'unknown')
    || (rateType !== 'public' && rateType !== 'member'
      && rateType !== 'unknown')
    || typeof mandatoryChargesResolved !== 'boolean'
  ) {
    return undefined;
  }

  return {
    amount,
    currency,
    basis,
    source,
    capturedAt:
      typeof capturedAt === 'string' ? capturedAt : null,
    freshness,
    rateType,
    mandatoryChargesResolved,
  };
}

function parseStoredComparableAvailability(
  value: unknown,
): ComparableStayAvailability | null | undefined {
  if (value === null) return null;
  const record = asStoredRecord(value);
  if (!record) return undefined;
  const status = record.status;
  const capturedAt = record.capturedAt;
  const freshness = record.freshness;
  const reasonCode = record.reasonCode;
  const availableRange = asStoredRecord(record.availableRange);
  if (
    (status !== 'yes' && status !== 'no'
      && status !== 'partial' && status !== 'unknown')
    || (capturedAt !== null && capturedAt !== undefined
      && typeof capturedAt !== 'string')
    || (freshness !== 'fresh' && freshness !== 'stale'
      && freshness !== 'unknown')
    || typeof reasonCode !== 'string'
  ) {
    return undefined;
  }

  const parsedRange =
    availableRange
    && typeof availableRange.checkIn === 'string'
    && typeof availableRange.checkOut === 'string'
      ? {
          checkIn: availableRange.checkIn,
          checkOut: availableRange.checkOut,
        }
      : undefined;
  return {
    status,
    capturedAt: typeof capturedAt === 'string' ? capturedAt : null,
    freshness,
    reasonCode,
    ...(parsedRange ? { availableRange: parsedRange } : {}),
  };
}

/**
 * Recalculate only the affordability dimension from a persisted rubric result.
 * Returns null for pre-snapshot records so callers preserve old JSON rather than
 * guessing at price inputs.
 */
export function recomputeStoredAffordability(input: {
  affordability: unknown;
  budget?: AffordabilityBudget | null;
  now?: Date;
}): AffordabilityResult | null {
  const stored = asStoredRecord(input.affordability);
  if (
    !stored
    || !Object.prototype.hasOwnProperty.call(stored, 'comparablePrice')
  ) {
    return null;
  }
  const price = parseStoredComparablePrice(stored.comparablePrice);
  if (price === undefined) return null;
  const availability = Object.prototype.hasOwnProperty.call(
    stored,
    'comparableAvailability',
  )
    ? parseStoredComparableAvailability(stored.comparableAvailability)
    : null;
  if (availability === undefined) return null;
  return computeAffordability({
    budget: input.budget ?? null,
    price,
    availability,
    now: input.now,
  });
}
