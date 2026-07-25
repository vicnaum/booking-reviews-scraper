// src/triage.ts
//
// AI-powered listing triage — grade listings against guest requirements
// Consolidates listing details + AI review analysis + AI photo analysis
// into a single graded assessment per listing

import * as fs from 'fs';
import * as path from 'path';
import { parseModelConfig, getProviderApiKey, PROVIDER_KEY_NAMES, type LLMProvider, type UsageSummary } from './analyze.js';
import {
  buildCanonicalRequirementSet,
  computeAffordability,
  scoreTriageAssessments,
  type AffordabilityBudget,
  type CanonicalRequirementInput,
  type CanonicalRequirementSet,
  type ComparableStayPrice,
  type ParsedAnalysisBudget,
  type RequirementAssessmentInput,
} from './triage-rubric.js';

// --- Types ---

export interface TriageOptions {
  listingFile: string;       // Path to listing JSON
  aiReviewsFile?: string;    // Path to ai-reviews JSON
  aiPhotosFile?: string;     // Path to ai-photos JSON
  model?: string;            // Default: gemini-3-flash-preview:high
  priorities?: string;       // Guest requirements (free text)
  requirementSet?: CanonicalRequirementSet;
  temperature?: number;      // Classification temperature. Default: 0
  budget?: AffordabilityBudget;
  price?: ComparableStayPrice;
  priceFreshness?: ComparableStayPrice['freshness'];
}

export const TRIAGE_EVIDENCE_GAP_ORDER = [
  'details',
  'reviews',
  'photos',
] as const;

export type TriageEvidenceGap = typeof TRIAGE_EVIDENCE_GAP_ORDER[number];

export function normalizeTriageEvidenceGaps(
  values: Iterable<unknown>,
): TriageEvidenceGap[] {
  const provided = new Set(values);
  return TRIAGE_EVIDENCE_GAP_ORDER.filter((gap) => provided.has(gap));
}

export interface TriageResult {
  data: any;                 // Parsed triage JSON
  model: string;
  provider: LLMProvider;
  requirementSet: CanonicalRequirementSet;
  evidenceGaps: TriageEvidenceGap[];
  tokensUsed?: number;
  usage?: UsageSummary;
}

// --- Constants ---

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 5000;
export const TRIAGE_REQUIREMENT_PARSER_VERSION = 'triage-requirements-v1';

// Pricing per 1M tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  default:                          { input: 0.15, output: 0.60 },
  'gemini-3-flash-preview':        { input: 0.50, output: 3.00 },
  'gemini-2.5-flash-preview-05-20':{ input: 0.15, output: 3.50 },
  'gemini-2.0-flash':              { input: 0.10, output: 0.40 },
};

// --- System prompt ---

const REQUIREMENT_PARSE_SYSTEM_PROMPT = `Convert one guest brief into a canonical, reusable set of quality requirements for comparing many properties.

## Separation of concerns
- Quality requirements describe evidence-backed property fit only.
- Extract price/budget language into the separate budget object. Never emit budget, price, value for money, price freshness, or availability as a quality requirement.

## Requirement types
- deal_breaker: an explicit cannot-accept condition ("will not", "cannot", "must not") or an objective safety/accessibility constraint.
- must_have: explicit "must", "need", "require", or an objective occupancy/accessibility need.
- priority: a strong or ranked preference that is not stated as non-negotiable.
- nice_to_have: a preference or bonus.

## Canonicalization
- Preserve explicit ranks. Use rank=1 for "#1", "first", or "by far" priority language.
- Split compound text only when parts can be evaluated independently.
- Keep synonyms and closely related evidence signals together as criteria.
- If a ranked umbrella is split, copy its type and rank to every child.
- Quiet environment, bed comfort, blackout conditions, workspace, and walkability are independently evaluable.
- Keep sourceText grounded in the guest brief.
- Do not create IDs or weights. Code owns them.
- If the brief has only budget language, return an empty definitions array; code will apply the versioned default quality set.

## Budget
- Use the upper bound of a range as maximumAmount and retain minimumAmount when supplied.
- Normalize currency to an ISO 4217 code when the brief makes it clear.
- Do not inflate the maximum for "slightly over is acceptable"; overage is shown separately.`;

const TRIAGE_SYSTEM_PROMPT = `You are a property evidence classifier helping a specific guest compare rentals. The user message supplies a frozen canonical requirement set. Classify exactly those requirement IDs; never parse, merge, split, rename, reorder, reweight, or add requirements.

You have three data sources for each listing:

1. **Listing Details** (most reliable) — factual data from the platform: beds, amenities, pricing, description, ratings
2. **Review Analysis** (reliable) — AI-condensed summary of guest reviews with themes, quotes, scores
3. **Photo Analysis** (supplementary) — AI analysis of listing photos for room conditions and layout

## Data Reliability Hierarchy
- Listing details and reviews are your primary sources. Trust them.
- Photo analysis is supplementary. Photos can be outdated, selectively chosen, or misleading.
- **Absence in photos does NOT mean absence in reality.** Only flag what's clearly visible as a concern.
- Never assign no_go tier based on photo evidence alone — only from listing details or reviews.
- The user message names any missing evidence layers. Never infer facts from a missing layer.
- Mark requirements that depend only on missing evidence as unknown, and state the limitation in the tier reason and summary.

## Requirement Evaluation Rules
1. Return one outcome for every supplied requirement ID.
2. For each requirement, determine status:
   - **met**: Clear evidence it's satisfied
   - **partial**: Partially satisfied or with caveats
   - **unmet**: Clear evidence it's NOT satisfied
   - **unknown**: Insufficient data to determine
3. Be conservative: prefer "unknown" over "unmet" when data is insufficient. Never assume the worst.
4. Confidence describes evidence strength, not how important the requirement is.
5. Include the strongest supporting and contradicting evidence. Use exact, concise evidence text from the supplied artifacts when possible.
6. Frequency and years are evidence metadata only; omit them when unavailable.

## Verdict boundary
- Do not output fitScore, tier, weights, requirement types, caps, or requirement definitions.
- Code computes the quality score and tier deterministically after your classifications.
- Price/value prose and diagnostic dimension scores never affect that verdict.

## Output Guidelines
- **bedSetup**: Describe the actual sleeping arrangement concisely
- **highlights**: Top 3-5 genuinely standout features relevant to this guest
- **concerns**: Top 3-5 notable issues relevant to this guest
- **dealBreakers**: Confirmed evidence that makes a weight-3-or-higher requirement fail.
- **summary**: 2-3 sentences — would you recommend this to this specific guest? Why or why not?
- **price.valueAssessment**: Compare price to quality/location/amenities. "unknown" if no price data.`;

// --- JSON response schema for Gemini structured output ---

const REQUIREMENT_PARSE_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    definitions: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          label: { type: 'string' as const },
          type: {
            type: 'string' as const,
            enum: ['deal_breaker', 'must_have', 'priority', 'nice_to_have'],
          },
          rank: { type: 'number' as const, nullable: true },
          sourceText: { type: 'string' as const },
          criteria: {
            type: 'array' as const,
            items: { type: 'string' as const },
          },
          order: { type: 'number' as const },
        },
        required: [
          'label',
          'type',
          'rank',
          'sourceText',
          'criteria',
          'order',
        ] as const,
      },
    },
    budget: {
      type: 'object' as const,
      nullable: true,
      properties: {
        minimumAmount: { type: 'number' as const, nullable: true },
        maximumAmount: { type: 'number' as const },
        currency: { type: 'string' as const },
      },
      required: ['minimumAmount', 'maximumAmount', 'currency'] as const,
    },
  },
  required: ['definitions', 'budget'] as const,
};

const TRIAGE_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    requirements: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          requirementId: { type: 'string' as const },
          status: { type: 'string' as const, enum: ['met', 'partial', 'unmet', 'unknown'] },
          confidence: { type: 'string' as const, enum: ['high', 'medium', 'low'] },
          note: { type: 'string' as const },
          evidence: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                layer: {
                  type: 'string' as const,
                  enum: ['details', 'reviews', 'photos'],
                },
                polarity: {
                  type: 'string' as const,
                  enum: ['supports', 'contradicts'],
                },
                text: { type: 'string' as const },
                frequency: { type: 'string' as const, nullable: true },
                years: {
                  type: 'array' as const,
                  items: { type: 'number' as const },
                },
              },
              required: [
                'layer',
                'polarity',
                'text',
                'frequency',
                'years',
              ] as const,
            },
          },
        },
        required: [
          'requirementId',
          'status',
          'confidence',
          'note',
          'evidence',
        ] as const,
      },
    },
    scores: {
      type: 'object' as const,
      properties: {
        fit: { type: 'number' as const },
        location: { type: 'number' as const },
        sleepQuality: { type: 'number' as const },
        cleanliness: { type: 'number' as const },
        modernity: { type: 'number' as const },
        valueForMoney: { type: 'number' as const },
      },
      required: ['fit', 'location', 'sleepQuality', 'cleanliness', 'modernity', 'valueForMoney'] as const,
    },
    bedSetup: { type: 'string' as const },
    price: {
      type: 'object' as const,
      properties: {
        total: { type: 'string' as const },
        perNight: { type: 'string' as const },
        valueAssessment: { type: 'string' as const, enum: ['excellent', 'good', 'fair', 'poor', 'unknown'] },
      },
      required: ['total', 'perNight', 'valueAssessment'] as const,
    },
    highlights: { type: 'array' as const, items: { type: 'string' as const } },
    concerns: { type: 'array' as const, items: { type: 'string' as const } },
    dealBreakers: { type: 'array' as const, items: { type: 'string' as const } },
    summary: { type: 'string' as const },
  },
  required: ['requirements', 'scores', 'bedSetup', 'price', 'highlights', 'concerns', 'dealBreakers', 'summary'] as const,
};

// --- Helpers ---

function isDegenerate(text: string): boolean {
  if (text.length < 500) return false;
  const sample = text.slice(-200);
  const uniqueChars = new Set(sample).size;
  return uniqueChars < 8;
}

/**
 * Trim listing JSON to relevant fields for triage (remove photos URLs, coordinates, etc.)
 */
function trimListingData(listing: any): any {
  const trimmed: any = {};
  const keepFields = [
    'title', 'description', 'propertyType', 'bedrooms', 'beds', 'bathrooms',
    'amenities', 'pricing', 'checkIn', 'checkOut', 'sleepingArrangements',
    'host', 'rating', 'reviewCount', 'subRatings', 'capacity', 'highlights',
    'houseRules', 'cancellationPolicy', 'address', 'ratingText', 'stars',
    'rooms', 'url', 'id',
    'poi', 'poiDistanceMeters',
  ];

  for (const key of keepFields) {
    if (listing[key] !== undefined) {
      // For rooms, strip photos arrays
      if (key === 'rooms' && Array.isArray(listing[key])) {
        trimmed[key] = listing[key].map((r: any) => {
          const { photos, ...rest } = r;
          return rest;
        });
      } else {
        trimmed[key] = listing[key];
      }
    }
  }

  return trimmed;
}

// --- Gemini text call ---

interface CallResult {
  text: string;
  usageMetadata?: any;
  durationMs: number;
}

async function callGeminiTriage(
  ai: any,
  modelName: string,
  thinkingLevel: string | null,
  systemPrompt: string,
  userMessage: string,
  jsonSchema: any,
  label?: string,
  temperature = 0,
): Promise<CallResult> {
  const generateConfig: any = {
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 8192,
      temperature,
      responseMimeType: 'application/json',
      responseSchema: jsonSchema,
    },
  };

  if (thinkingLevel) {
    generateConfig.config.thinkingConfig = {
      thinkingBudget: thinkingLevel === 'none' ? 0
        : thinkingLevel === 'low' ? 1024
        : thinkingLevel === 'medium' ? 8192
        : thinkingLevel === 'high' ? 24576
        : undefined,
    };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      const result = await ai.models.generateContent(generateConfig);
      const durationMs = Date.now() - start;
      const text = result.text || '';
      const finishReason = result.candidates?.[0]?.finishReason;

      if (finishReason === 'MAX_TOKENS' || isDegenerate(text)) {
        throw new Error(`Degenerate output detected (finishReason=${finishReason}, ${text.length} chars). Retrying.`);
      }

      return { text, usageMetadata: result.usageMetadata, durationMs };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const status = err?.status || err?.code || '';
      const msg = err?.message || String(err);
      console.error(`  [${label || 'triage'}] attempt ${attempt}/${MAX_RETRIES} failed after ${(durationMs / 1000).toFixed(1)}s — ${status} ${msg}`);

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * attempt;
        console.error(`  Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw new Error(`Gemini API failed after ${MAX_RETRIES} attempts (${label || 'triage'}): ${msg}`);
      }
    }
  }

  throw new Error('Unreachable');
}

// --- Usage tracking ---

function usageSummary(
  usageMetadata: any,
  modelName: string,
): UsageSummary {
  const prompt = usageMetadata?.promptTokenCount || 0;
  const response = usageMetadata?.candidatesTokenCount || 0;
  const thinking = usageMetadata?.thoughtsTokenCount || 0;

  const pricing = PRICING[modelName] || PRICING.default;
  const inputCost = (prompt / 1_000_000) * pricing.input;
  const outputCost = (response / 1_000_000) * pricing.output;
  return {
    inputTokens: prompt,
    outputTokens: response,
    thinkingTokens: thinking || undefined,
    cost: +(inputCost + outputCost).toFixed(4),
  };
}

function mergeUsage(
  values: Array<UsageSummary | undefined>,
): UsageSummary {
  const present = values.filter(
    (value): value is UsageSummary => value != null,
  );
  const thinking = present.reduce(
    (sum, value) => sum + (value.thinkingTokens ?? 0),
    0,
  );
  return {
    inputTokens: present.reduce(
      (sum, value) => sum + value.inputTokens,
      0,
    ),
    outputTokens: present.reduce(
      (sum, value) => sum + value.outputTokens,
      0,
    ),
    thinkingTokens: thinking || undefined,
    cost: +present.reduce((sum, value) => sum + value.cost, 0).toFixed(4),
  };
}

function formatUsageSummary(
  usage: UsageSummary,
  modelName: string,
  durationMs: number,
): string {
  const pricing = PRICING[modelName] || PRICING.default;
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;

  let line = `  ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`;
  if (usage.thinkingTokens) {
    line += ` (${usage.thinkingTokens.toLocaleString()} thinking)`;
  }
  line += ` [${(durationMs / 1000).toFixed(1)}s]`;
  line += `\n  Cost: $${inputCost.toFixed(4)} input + $${outputCost.toFixed(4)} output = $${usage.cost.toFixed(4)} (${modelName})`;
  return line;
}

export function getTriageRequirementParserVersion(
  modelStr: string,
  priorities?: string | null,
): string {
  if (!priorities?.trim()) return 'triage-default-requirements-v1';
  const modelConfig = parseModelConfig(modelStr);
  return [
    TRIAGE_REQUIREMENT_PARSER_VERSION,
    modelConfig.provider,
    modelConfig.model,
    modelConfig.thinkingLevel || 'default',
  ].join(':');
}

async function parseRequirementSet(input: {
  ai: any;
  modelName: string;
  thinkingLevel: string | null;
  priorities?: string;
}): Promise<{
  requirementSet: CanonicalRequirementSet;
  call: CallResult | null;
}> {
  const parserVersion = getTriageRequirementParserVersion(
    `${input.modelName}${input.thinkingLevel ? `:${input.thinkingLevel}` : ''}`,
    input.priorities,
  );
  if (!input.priorities?.trim()) {
    return {
      requirementSet: buildCanonicalRequirementSet({
        brief: null,
        parserVersion,
      }),
      call: null,
    };
  }

  const call = await callGeminiTriage(
    input.ai,
    input.modelName,
    input.thinkingLevel,
    REQUIREMENT_PARSE_SYSTEM_PROMPT,
    input.priorities,
    REQUIREMENT_PARSE_JSON_SCHEMA,
    'requirements',
    0,
  );
  let parsed: any;
  try {
    parsed = JSON.parse(call.text);
  } catch {
    throw new Error(
      `Failed to parse requirement response as JSON:\n${call.text.slice(0, 500)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Requirement response must be a JSON object.');
  }
  if (!Array.isArray(parsed.definitions)) {
    throw new Error('Requirement response must contain definitions.');
  }

  const parsedBudget: ParsedAnalysisBudget | null =
    parsed.budget && typeof parsed.budget === 'object'
      ? {
          minimumAmount: parsed.budget.minimumAmount ?? null,
          maximumAmount: parsed.budget.maximumAmount,
          currency: parsed.budget.currency,
          basis: 'stay',
          source: 'brief',
        }
      : null;

  return {
    requirementSet: buildCanonicalRequirementSet({
      brief: input.priorities,
      parserVersion,
      definitions: parsed.definitions as CanonicalRequirementInput[],
      parsedBudget,
    }),
    call,
  };
}

function normalizePriceCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(text)) return text;
  if (text === '$' || text.includes('US$')) return 'USD';
  if (text === '€') return 'EUR';
  if (text === '£') return 'GBP';
  if (text.includes('ZŁ')) return 'PLN';
  return null;
}

function parsePriceText(
  value: unknown,
  fallbackCurrency?: unknown,
): { amount: number; currency: string } | null {
  if (typeof value !== 'string') return null;
  const currency =
    normalizePriceCurrency(value.match(/\b[A-Z]{3}\b/)?.[0])
    ?? normalizePriceCurrency(
      value.includes('zł')
        ? 'PLN'
        : value.includes('€')
          ? 'EUR'
          : value.includes('£')
            ? 'GBP'
            : value.includes('$')
              ? 'USD'
              : fallbackCurrency,
    );
  if (!currency) return null;

  const numeric = value.match(/\d[\d\s\u00a0.,]*/)?.[0]
    ?.replace(/[\s\u00a0]/g, '');
  if (!numeric) return null;

  const lastComma = numeric.lastIndexOf(',');
  const lastDot = numeric.lastIndexOf('.');
  let normalized = numeric;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = normalized.split(thousandsSeparator).join('');
    normalized = normalized.replace(decimalSeparator, '.');
  } else {
    const separator = lastComma >= 0 ? ',' : lastDot >= 0 ? '.' : null;
    if (separator) {
      const occurrences = normalized.split(separator).length - 1;
      const fractionalDigits = normalized.length
        - normalized.lastIndexOf(separator)
        - 1;
      if (occurrences > 1 || fractionalDigits === 3) {
        normalized = normalized.split(separator).join('');
      } else {
        normalized = normalized.replace(separator, '.');
      }
    }
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0
    ? { amount, currency }
    : null;
}

export function extractComparableStayPrice(
  listing: any,
  freshness: ComparableStayPrice['freshness'] = 'unknown',
): ComparableStayPrice | null {
  const pricing = listing?.pricing;
  if (!pricing || typeof pricing !== 'object') return null;

  const capturedAt =
    typeof listing.priceCapturedAt === 'string'
      ? listing.priceCapturedAt
      : typeof listing.scrapedAt === 'string'
        ? listing.scrapedAt
        : null;
  const rateType: ComparableStayPrice['rateType'] =
    pricing.rateType === 'member'
      ? 'member'
      : pricing.rateType === 'unknown'
        ? 'unknown'
        : 'public';
  const mandatoryChargesResolved =
    typeof pricing.mandatoryChargesResolved === 'boolean'
      ? pricing.mandatoryChargesResolved
      : true;

  if (
    pricing.total
    && typeof pricing.total === 'object'
    && typeof pricing.total.amount === 'number'
  ) {
    const currency = normalizePriceCurrency(pricing.total.currency);
    if (currency) {
      return {
        amount: pricing.total.amount,
        currency,
        basis: 'stay',
        source:
          typeof pricing.total.source === 'string'
            ? pricing.total.source
            : 'upstream',
        capturedAt,
        freshness,
        rateType,
        mandatoryChargesResolved,
      };
    }
  }

  const directTotal = parsePriceText(
    pricing.totalPrice,
    pricing.currency,
  );
  if (directTotal) {
    return {
      ...directTotal,
      basis: 'stay',
      source: 'upstream',
      capturedAt,
      freshness,
      rateType,
      mandatoryChargesResolved,
    };
  }

  if (Array.isArray(pricing.rooms)) {
    const totals = pricing.rooms
      .map((room: any) =>
        parsePriceText(room?.totalPrice, pricing.currency))
      .filter(
        (
          total: { amount: number; currency: string } | null,
        ): total is { amount: number; currency: string } => total != null,
      )
      .sort((a: { amount: number }, b: { amount: number }) =>
        a.amount - b.amount);
    if (totals.length > 0) {
      return {
        ...totals[0],
        basis: 'stay',
        source: 'upstream',
        capturedAt,
        freshness,
        rateType,
        mandatoryChargesResolved,
      };
    }
  }
  return null;
}

function deterministicTierReason(
  score: ReturnType<typeof scoreTriageAssessments>,
): string {
  if (score.rankingReason) return score.rankingReason;
  if (score.capReasons.length > 0) {
    return (
      `Deterministic quality score ${score.rawFitScore} was capped to `
      + `${score.fitScore} by ${score.capReasons.length} hard-requirement `
      + `${score.capReasons.length === 1 ? 'rule' : 'rules'}.`
    );
  }
  return (
    `Deterministic quality fit from ${score.requirements.length} canonical `
    + `requirements with ${Math.round(score.coverage * 100)}% known-weight coverage.`
  );
}

// --- Main entry point ---

export async function runTriage(options: TriageOptions): Promise<TriageResult> {
  const { listingFile, aiReviewsFile, aiPhotosFile, priorities } = options;
  const modelStr = options.model || process.env.LLM_MODEL || 'gemini-3-flash-preview:high';
  const temperature = options.temperature ?? 0;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error('Triage temperature must be between 0 and 2.');
  }

  // 1. Parse model config
  const modelConfig = parseModelConfig(modelStr);
  if (modelConfig.provider !== 'gemini') {
    throw new Error(`Triage currently only supports Gemini models (got: ${modelConfig.provider}/${modelConfig.model}).`);
  }

  const apiKey = getProviderApiKey(modelConfig.provider);
  if (!apiKey) {
    const keyName = PROVIDER_KEY_NAMES[modelConfig.provider];
    throw new Error(`${keyName} (or LLM_API_KEY) environment variable is required for ${modelConfig.model}.`);
  }

  // 2. Read listing data (required)
  const listingPath = path.resolve(listingFile);
  if (!fs.existsSync(listingPath)) {
    throw new Error(`Listing file not found: ${listingPath}`);
  }
  const listingData = JSON.parse(fs.readFileSync(listingPath, 'utf-8'));
  const trimmedListing = trimListingData(listingData);
  const evidenceGaps: TriageEvidenceGap[] = [];

  // 3. Read AI reviews (optional)
  let aiReviewsData: any = null;
  if (aiReviewsFile) {
    const reviewsPath = path.resolve(aiReviewsFile);
    if (fs.existsSync(reviewsPath)) {
      try {
        aiReviewsData = JSON.parse(fs.readFileSync(reviewsPath, 'utf-8'));
      } catch (err: any) {
        console.warn(`  Warning: could not parse AI reviews file: ${err.message}`);
      }
    }
  }
  if (!aiReviewsData) {
    evidenceGaps.push('reviews');
  }

  // 4. Read AI photos (optional)
  let aiPhotosData: any = null;
  if (aiPhotosFile) {
    const photosPath = path.resolve(aiPhotosFile);
    if (fs.existsSync(photosPath)) {
      try {
        aiPhotosData = JSON.parse(fs.readFileSync(photosPath, 'utf-8'));
      } catch (err: any) {
        console.warn(`  Warning: could not parse AI photos file: ${err.message}`);
      }
    }
  }
  if (!aiPhotosData) {
    evidenceGaps.push('photos');
  }

  const normalizedEvidenceGaps = normalizeTriageEvidenceGaps(evidenceGaps);

  // 5. Resolve the canonical set before evaluating the listing.
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const parsedRequirements = options.requirementSet
    ? { requirementSet: options.requirementSet, call: null }
    : await parseRequirementSet({
        ai,
        modelName: modelConfig.model,
        thinkingLevel: modelConfig.thinkingLevel,
        priorities,
      });
  const requirementSet = parsedRequirements.requirementSet;

  // 6. Build the classifier message.
  const sections: string[] = [];

  sections.push('## Canonical Requirement Definitions');
  sections.push(JSON.stringify(requirementSet.definitions, null, 2));
  sections.push('');

  sections.push('## Evidence Availability');
  sections.push(
    normalizedEvidenceGaps.length > 0
      ? `Missing evidence layers: ${normalizedEvidenceGaps.join(', ')}. Do not infer facts from these layers.`
      : 'All evidence layers are available.',
  );
  sections.push('');

  sections.push('## Listing Details');
  sections.push(JSON.stringify(trimmedListing, null, 2));
  sections.push('');

  sections.push('## Review Analysis');
  sections.push(aiReviewsData
    ? JSON.stringify(aiReviewsData, null, 2)
    : 'No review analysis available for this listing.');
  sections.push('');

  sections.push('## Photo Analysis');
  sections.push(aiPhotosData
    ? JSON.stringify(aiPhotosData, null, 2)
    : 'No photo analysis available for this listing.');

  const userMessage = sections.join('\n');

  // 7. Classify evidence with no model-authored verdict.
  console.error(`Triage: ${listingData.title || listingData.id || listingFile}`);
  console.error(`Model: ${modelConfig.model}${modelConfig.thinkingLevel ? `:${modelConfig.thinkingLevel}` : ''}`);
  console.error(`Requirement set: ${requirementSet.id}`);
  console.error(`Classification temperature: ${temperature}`);

  const result = await callGeminiTriage(
    ai,
    modelConfig.model,
    modelConfig.thinkingLevel,
    TRIAGE_SYSTEM_PROMPT,
    userMessage,
    TRIAGE_JSON_SCHEMA,
    'triage',
    temperature,
  );

  // 8. Parse classifications and apply the pure rubric.
  let parsed: any;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    throw new Error(`Failed to parse Gemini response as JSON:\n${result.text.slice(0, 500)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gemini triage response must be a JSON object.');
  }
  if (!Array.isArray(parsed.requirements)) {
    throw new Error('Gemini triage response must contain requirements.');
  }

  const score = scoreTriageAssessments(
    requirementSet,
    parsed.requirements as RequirementAssessmentInput[],
  );
  const parsedBudget = requirementSet.parsedBudget;
  const budget: AffordabilityBudget | null =
    options.budget
    ?? (parsedBudget
      ? {
          amount: parsedBudget.maximumAmount,
          currency: parsedBudget.currency,
          basis: 'stay',
          source: 'brief',
        }
      : null);
  const price =
    options.price
    ?? extractComparableStayPrice(
      listingData,
      options.priceFreshness ?? 'unknown',
    );
  const affordability = computeAffordability({ budget, price });
  const triageData = {
    ...parsed,
    ...score,
    tierReason: deterministicTierReason(score),
    requirementSet,
    affordability,
    evidenceGaps: normalizedEvidenceGaps,
  };

  // 9. Log and return combined parser + classifier usage.
  const requirementUsage = parsedRequirements.call
    ? usageSummary(
        parsedRequirements.call.usageMetadata,
        modelConfig.model,
      )
    : undefined;
  const classificationUsage = usageSummary(
    result.usageMetadata,
    modelConfig.model,
  );
  const usage = mergeUsage([requirementUsage, classificationUsage]);
  const durationMs =
    (parsedRequirements.call?.durationMs ?? 0) + result.durationMs;
  console.error(`\nUsage:`);
  console.error(
    formatUsageSummary(usage, modelConfig.model, durationMs),
  );

  return {
    data: triageData,
    model: modelConfig.model,
    provider: modelConfig.provider,
    requirementSet,
    evidenceGaps: normalizedEvidenceGaps,
    tokensUsed: usage.inputTokens,
    usage,
  };
}

// --- Standalone execution ---

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: triage <listing-file> [--ai-reviews <file>] [--ai-photos <file>] [--model <model>] [--priorities <text>] [--temperature <n>] [--budget <amount>] [--budget-currency <code>]');
    process.exit(1);
  }

  // Load .env
  try { await import('dotenv/config'); } catch {}

  const listingFile = args[0];
  let aiReviewsFile: string | undefined;
  let aiPhotosFile: string | undefined;
  let model: string | undefined;
  let priorities: string | undefined;
  let temperature = 0;
  let budgetAmount: number | undefined;
  let budgetCurrency = 'USD';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--ai-reviews' && args[i + 1]) { aiReviewsFile = args[++i]; }
    else if (args[i] === '--ai-photos' && args[i + 1]) { aiPhotosFile = args[++i]; }
    else if (args[i] === '--model' && args[i + 1]) { model = args[++i]; }
    else if (args[i] === '--priorities' && args[i + 1]) { priorities = args[++i]; }
    else if (args[i] === '--temperature' && args[i + 1]) { temperature = Number(args[++i]); }
    else if (args[i] === '--budget' && args[i + 1]) { budgetAmount = Number(args[++i]); }
    else if (args[i] === '--budget-currency' && args[i + 1]) { budgetCurrency = args[++i].toUpperCase(); }
  }

  const budget =
    budgetAmount == null
      ? undefined
      : {
          amount: budgetAmount,
          currency: budgetCurrency,
          basis: 'stay' as const,
          source: 'explicit' as const,
        };
  const result = await runTriage({
    listingFile,
    aiReviewsFile,
    aiPhotosFile,
    model,
    priorities,
    temperature,
    budget,
  });
  console.log(JSON.stringify(result.data, null, 2));
}

if (process.argv[1] && (
  process.argv[1].endsWith('/triage.js') ||
  process.argv[1].endsWith('/triage.ts')
)) {
  main().catch(err => {
    console.error('Fatal error:', err.message || err);
    process.exit(1);
  });
}
