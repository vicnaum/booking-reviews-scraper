// src/triage.ts
//
// AI-powered listing triage — grade listings against guest requirements
// Consolidates listing details + AI review analysis + AI photo analysis
// into a single graded assessment per listing

import * as fs from 'fs';
import * as path from 'path';
import { parseModelConfig, getProviderApiKey, PROVIDER_KEY_NAMES, type LLMProvider } from './analyze.js';

// --- Types ---

export interface TriageOptions {
  listingFile: string;       // Path to listing JSON
  aiReviewsFile?: string;    // Path to ai-reviews JSON
  aiPhotosFile?: string;     // Path to ai-photos JSON
  model?: string;            // Default: gemini-3-flash-preview:high
  priorities?: string;       // Guest requirements (free text)
}

export interface TriageResult {
  data: any;                 // Parsed triage JSON
  model: string;
  provider: LLMProvider;
  tokensUsed?: number;
}

// --- Constants ---

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 5000;

// Pricing per 1M tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  default:                          { input: 0.15, output: 0.60 },
  'gemini-3-flash-preview':        { input: 0.50, output: 3.00 },
  'gemini-2.5-flash-preview-05-20':{ input: 0.15, output: 3.50 },
  'gemini-2.0-flash':              { input: 0.10, output: 0.40 },
};

// --- System prompt ---

const TRIAGE_SYSTEM_PROMPT = `You are a property evaluator helping a specific guest decide which rental to book. You have three data sources for each listing:

1. **Listing Details** (most reliable) — factual data from the platform: beds, amenities, pricing, description, ratings
2. **Review Analysis** (reliable) — AI-condensed summary of guest reviews with themes, quotes, scores
3. **Photo Analysis** (supplementary) — AI analysis of listing photos for room conditions and layout

## Data Reliability Hierarchy
- Listing details and reviews are your primary sources. Trust them.
- Photo analysis is supplementary. Photos can be outdated, selectively chosen, or misleading.
- **Absence in photos does NOT mean absence in reality.** Only flag what's clearly visible as a concern.
- Never assign no_go tier based on photo evidence alone — only from listing details or reviews.

## Requirement Evaluation Rules
1. Parse the guest's requirements from their free text.
2. Classify each as **must_have** (strong language: "need", "must", "essential", "require", critical needs like beds/rooms) or **nice_to_have** (preferences: "prefer", "ideally", "would be nice", "bonus").
3. For each requirement, determine status:
   - **met**: Clear evidence it's satisfied
   - **partial**: Partially satisfied or with caveats
   - **unmet**: Clear evidence it's NOT satisfied
   - **unknown**: Insufficient data to determine
4. Be **conservative**: prefer "unknown" over "unmet" when data is insufficient. Never assume the worst.
5. **An unmet must_have with high confidence IS a deal-breaker.** These are the guest's non-negotiable requirements. If someone needs a separate bedroom for their daughter and the listing doesn't have one, that's a deal-breaker — period. It doesn't matter how clean or well-located the place is. Include it in the dealBreakers array.

## Scoring Rules
- **scores.fit** (0-10): How well the listing matches the guest's specific requirements. This is the MOST important dimension.
  - If ANY must_have is unmet with high confidence, fit score MUST be ≤ 3.
  - If ANY must_have is unmet with medium confidence, fit score MUST be ≤ 5.
- **fitScore** (0-100): Overall suitability score combining:
  - ~50% from fit (requirement match)
  - ~25% from quality (cleanliness, modernity, reviews)
  - ~15% from value for money
  - ~10% from bonuses (great location, exceptional host, standout features)
- Same quality at a lower price should score higher on valueForMoney.
- **Hard tier caps based on must_have status:**
  - If ONE must_have is unmet with high confidence → tier MUST be "unlikely" or "no_go", fitScore ≤ 40
  - If TWO+ must_haves are unmet with high confidence → tier MUST be "no_go", fitScore ≤ 24
  - If ANY must_have is unmet with medium confidence → tier MUST be "unlikely" or below, fitScore ≤ 44
  - top_pick requires ALL must_haves met
  - shortlist requires ALL must_haves met or partial
- **Tier must match fitScore range exactly:**
  - top_pick: 80-100 — All must-haves met, strong on priorities
  - shortlist: 65-79 — Most requirements met, minor compromises on nice-to-haves only
  - consider: 45-64 — Notable gaps but could work (no unmet must-haves with high confidence)
  - unlikely: 25-44 — Significant issues on key requirements, or a must-have unmet
  - no_go: 0-24 — Multiple confirmed deal-breakers or a single critical one that makes the listing completely unsuitable

## Output Guidelines
- **bedSetup**: Describe the actual sleeping arrangement concisely
- **highlights**: Top 3-5 genuinely standout features relevant to this guest
- **concerns**: Top 3-5 notable issues relevant to this guest
- **dealBreakers**: Any must_have requirement that is unmet with high confidence.
- **summary**: 2-3 sentences — would you recommend this to this specific guest? Why or why not?
- **price.valueAssessment**: Compare price to quality/location/amenities. "unknown" if no price data.`;

// --- JSON response schema for Gemini structured output ---

const TRIAGE_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    fitScore: { type: 'number' as const },
    tier: { type: 'string' as const, enum: ['top_pick', 'shortlist', 'consider', 'unlikely', 'no_go'] },
    tierReason: { type: 'string' as const },
    requirements: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          requirement: { type: 'string' as const },
          type: { type: 'string' as const, enum: ['must_have', 'nice_to_have'] },
          status: { type: 'string' as const, enum: ['met', 'partial', 'unmet', 'unknown'] },
          confidence: { type: 'string' as const, enum: ['high', 'medium', 'low'] },
          note: { type: 'string' as const },
        },
        required: ['requirement', 'type', 'status', 'confidence', 'note'] as const,
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
  required: ['fitScore', 'tier', 'tierReason', 'requirements', 'scores', 'bedSetup', 'price', 'highlights', 'concerns', 'dealBreakers', 'summary'] as const,
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
): Promise<CallResult> {
  const generateConfig: any = {
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 8192,
      temperature: 1.0,
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

function formatUsageSummary(usageMetadata: any, modelName: string, durationMs: number): string {
  const prompt = usageMetadata?.promptTokenCount || 0;
  const response = usageMetadata?.candidatesTokenCount || 0;
  const thinking = usageMetadata?.thoughtsTokenCount || 0;

  const pricing = PRICING[modelName] || PRICING.default;
  const inputCost = (prompt / 1_000_000) * pricing.input;
  const outputCost = (response / 1_000_000) * pricing.output;
  const totalCost = inputCost + outputCost;

  let line = `  ${prompt.toLocaleString()} in / ${response.toLocaleString()} out`;
  if (thinking) line += ` (${thinking.toLocaleString()} thinking)`;
  line += ` [${(durationMs / 1000).toFixed(1)}s]`;
  line += `\n  Cost: $${inputCost.toFixed(4)} input + $${outputCost.toFixed(4)} output = $${totalCost.toFixed(4)} (${modelName})`;
  return line;
}

// --- Main entry point ---

export async function runTriage(options: TriageOptions): Promise<TriageResult> {
  const { listingFile, aiReviewsFile, aiPhotosFile, priorities } = options;
  const modelStr = options.model || process.env.LLM_MODEL || 'gemini-3-flash-preview:high';

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

  // 5. Build user message
  const sections: string[] = [];

  sections.push('## Guest Requirements');
  sections.push(priorities || 'No specific requirements provided. Evaluate for a general traveler.');
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

  // 6. Call Gemini API
  console.error(`Triage: ${listingData.title || listingData.id || listingFile}`);
  console.error(`Model: ${modelConfig.model}${modelConfig.thinkingLevel ? `:${modelConfig.thinkingLevel}` : ''}`);

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const result = await callGeminiTriage(
    ai,
    modelConfig.model,
    modelConfig.thinkingLevel,
    TRIAGE_SYSTEM_PROMPT,
    userMessage,
    TRIAGE_JSON_SCHEMA,
    'triage',
  );

  // 7. Parse result
  let parsed: any;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    throw new Error(`Failed to parse Gemini response as JSON:\n${result.text.slice(0, 500)}`);
  }

  // 8. Log usage
  console.error(`\nUsage:`);
  console.error(formatUsageSummary(result.usageMetadata, modelConfig.model, result.durationMs));

  return {
    data: parsed,
    model: modelConfig.model,
    provider: modelConfig.provider,
    tokensUsed: result.usageMetadata?.promptTokenCount,
  };
}

// --- Standalone execution ---

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: triage <listing-file> [--ai-reviews <file>] [--ai-photos <file>] [--model <model>] [--priorities <text>]');
    process.exit(1);
  }

  // Load .env
  try { await import('dotenv/config'); } catch {}

  const listingFile = args[0];
  let aiReviewsFile: string | undefined;
  let aiPhotosFile: string | undefined;
  let model: string | undefined;
  let priorities: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--ai-reviews' && args[i + 1]) { aiReviewsFile = args[++i]; }
    else if (args[i] === '--ai-photos' && args[i + 1]) { aiPhotosFile = args[++i]; }
    else if (args[i] === '--model' && args[i + 1]) { model = args[++i]; }
    else if (args[i] === '--priorities' && args[i + 1]) { priorities = args[++i]; }
  }

  const result = await runTriage({ listingFile, aiReviewsFile, aiPhotosFile, model, priorities });
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
