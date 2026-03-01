// src/ask.ts
//
// Ad-hoc Q&A for shortlisted properties.
// One LLM call per listing with listing details + raw reviews.
// Returns per-listing answers with confidence and evidence.

import * as fs from 'fs';
import * as path from 'path';
import { parseModelConfig, getProviderApiKey, PROVIDER_KEY_NAMES, type LLMProvider, type UsageSummary } from './analyze.js';

// --- Types ---

export interface AskOptions {
  question: string;
  outputDir: string;
  picks?: 'liked' | 'hidden' | 'all';
  ids?: string[];
  model?: string;
  saveName?: string;
  force?: boolean;
}

export interface AskAnswer {
  id: string;
  title: string;
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
}

export interface AskResult {
  question: string;
  askedAt: string;
  model: string;
  answers: AskAnswer[];
  usage?: UsageSummary;
}

// --- Constants ---

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 5000;

const PRICING: Record<string, { input: number; output: number }> = {
  default:                          { input: 0.15, output: 0.60 },
  'gemini-3-flash-preview':        { input: 0.50, output: 3.00 },
  'gemini-2.5-flash-preview-05-20':{ input: 0.15, output: 3.50 },
  'gemini-2.0-flash':              { input: 0.10, output: 0.40 },
};

// --- System prompt ---

const ASK_SYSTEM_PROMPT = `You are a property researcher helping a guest evaluate a rental listing.
You will receive a question, listing details, and guest reviews for ONE property.

Rules:
- Answer the question based on ALL available data (listing details, amenities, description, reviews).
- If data is insufficient to answer, say so honestly. Do not guess.
- Be specific — quote evidence from listing details or reviews.
- For yes/no questions, give a clear answer first, then explain.
- Keep answers concise but thorough (2-5 sentences).`;

// --- JSON response schema for Gemini structured output ---

const ASK_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    answer: { type: 'string' as const },
    confidence: { type: 'string' as const, enum: ['high', 'medium', 'low'] },
    evidence: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['answer', 'confidence', 'evidence'] as const,
};

// --- Helpers ---

function isDegenerate(text: string): boolean {
  if (text.length < 200) return false;
  const sample = text.slice(-200);
  const uniqueChars = new Set(sample).size;
  return uniqueChars < 8;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
}

function trimListingForAsk(listing: any): any {
  const keepFields = [
    'title', 'description', 'propertyType', 'bedrooms', 'beds', 'bathrooms',
    'amenities', 'pricing', 'checkIn', 'checkOut', 'sleepingArrangements',
    'host', 'rating', 'reviewCount', 'subRatings', 'capacity', 'highlights',
    'houseRules', 'cancellationPolicy', 'address', 'ratingText', 'stars',
    'rooms', 'url', 'id',
  ];
  const trimmed: any = {};
  for (const key of keepFields) {
    if (listing[key] !== undefined) {
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

/**
 * Compact raw reviews into a text block.
 * Strips metadata, keeps just date + rating + text.
 */
function compactReviews(reviewsFile: any, platform: string): string {
  const reviews: any[] = reviewsFile?.reviews || [];
  if (reviews.length === 0) return 'No reviews available.';

  const lines: string[] = [];
  for (const r of reviews) {
    if (platform === 'booking') {
      const date = r.review_post_date || '';
      const rating = r.rating ?? '';
      const liked = r.review_text_liked || '';
      const disliked = r.review_text_disliked || '';
      const text = liked && disliked ? `+: ${liked} | -: ${disliked}`
        : liked ? `+: ${liked}`
        : disliked ? `-: ${disliked}`
        : r.en_full_review || r.full_review || '';
      if (text) lines.push(`[${date}] ${rating}/10 ${text}`);
    } else {
      // airbnb
      const date = r.review_date || r.localized_date || '';
      const rating = r.rating ?? '';
      const text = r.review_text || '';
      if (text) lines.push(`[${date}] ${rating}/5 ${text}`);
    }
  }
  return lines.join('\n');
}

// --- Gemini API call ---

async function callGemini(
  ai: any,
  modelName: string,
  thinkingLevel: string | null,
  systemPrompt: string,
  userMessage: string,
  jsonSchema: any,
  label: string,
): Promise<{ text: string; usageMetadata?: any; durationMs: number }> {
  const generateConfig: any = {
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 4096,
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
        throw new Error(`Degenerate output (finishReason=${finishReason}, ${text.length} chars)`);
      }

      return { text, usageMetadata: result.usageMetadata, durationMs };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const status = err?.status || err?.code || '';
      const msg = err?.message || String(err);
      console.error(`  [${label}] attempt ${attempt}/${MAX_RETRIES} failed after ${(durationMs / 1000).toFixed(1)}s — ${status} ${msg}`);

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * attempt;
        console.error(`  Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw new Error(`Gemini API failed after ${MAX_RETRIES} attempts (${label}): ${msg}`);
      }
    }
  }

  throw new Error('Unreachable');
}

// --- Main entry point ---

export async function runAsk(options: AskOptions): Promise<AskResult> {
  const { question, outputDir, force } = options;
  const picksFilter = options.picks || 'liked';
  const modelStr = options.model || process.env.LLM_MODEL || 'gemini-3-flash-preview:high';

  // 1. Parse model config
  const modelConfig = parseModelConfig(modelStr);
  if (modelConfig.provider !== 'gemini') {
    throw new Error(`Ask currently only supports Gemini models (got: ${modelConfig.provider}/${modelConfig.model}).`);
  }

  const apiKey = getProviderApiKey(modelConfig.provider);
  if (!apiKey) {
    const keyName = PROVIDER_KEY_NAMES[modelConfig.provider];
    throw new Error(`${keyName} (or LLM_API_KEY) environment variable is required for ${modelConfig.model}.`);
  }

  const resolvedDir = path.resolve(outputDir);

  // 2. Check if result already exists
  const slug = options.saveName || slugify(question);
  const queriesDir = path.join(resolvedDir, 'queries');
  const queryFile = path.join(queriesDir, `${slug}.json`);

  if (!force && fs.existsSync(queryFile)) {
    console.error(`Query already exists: ${queryFile}`);
    console.error('Use --force to re-run.');
    const existing: AskResult = JSON.parse(fs.readFileSync(queryFile, 'utf-8'));
    return existing;
  }

  // 3. Load manifest
  const manifestPath = path.join(resolvedDir, 'batch_manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // 4. Determine which listing IDs to query
  let targetIds: string[];

  if (options.ids && options.ids.length > 0) {
    targetIds = options.ids;
  } else {
    const picksPath = path.join(resolvedDir, 'picks.json');
    if (!fs.existsSync(picksPath)) {
      throw new Error(`picks.json not found: ${picksPath}. Use --ids to specify listings manually.`);
    }
    const picks = JSON.parse(fs.readFileSync(picksPath, 'utf-8'));
    const extractIds = (arr: any[]): string[] =>
      arr.map((item: any) => typeof item === 'string' ? item : item?.id).filter(Boolean);

    if (picksFilter === 'liked') {
      targetIds = extractIds(picks.liked || []);
    } else if (picksFilter === 'hidden') {
      targetIds = extractIds(picks.hidden || []);
    } else {
      targetIds = [...extractIds(picks.liked || []), ...extractIds(picks.hidden || [])];
    }
  }

  if (targetIds.length === 0) {
    throw new Error('No listing IDs found. Check your picks.json or use --ids.');
  }

  // 5. Gather per-listing data
  interface ListingContext {
    id: string;
    title: string;
    platform: string;
    listingData: any;
    reviewsText: string;
  }

  const listings: ListingContext[] = [];

  for (const id of targetIds) {
    const entryKey = Object.keys(manifest.listings).find((k: string) => manifest.listings[k].id === id);
    if (!entryKey) {
      console.error(`  Warning: listing ${id} not found in manifest, skipping.`);
      continue;
    }
    const entry = manifest.listings[entryKey];

    // Read listing details
    let listingData: any = null;
    if (entry.details?.status === 'fetched' && entry.details.file) {
      const p = path.join(resolvedDir, entry.details.file);
      if (fs.existsSync(p)) {
        try { listingData = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch {}
      }
    }

    // Read raw reviews
    let reviewsText = 'No reviews available.';
    if (entry.reviews?.status === 'fetched' && entry.reviews.file) {
      const p = path.join(resolvedDir, entry.reviews.file);
      if (fs.existsSync(p)) {
        try {
          const reviewsFile = JSON.parse(fs.readFileSync(p, 'utf-8'));
          reviewsText = compactReviews(reviewsFile, entry.platform);
        } catch {}
      }
    }

    if (!listingData) {
      console.error(`  Warning: no listing data for ${id}, skipping.`);
      continue;
    }

    const title = listingData.title || listingData.name || id;
    listings.push({ id, title, platform: entry.platform, listingData, reviewsText });
  }

  if (listings.length === 0) {
    throw new Error('No listing data found for any of the specified IDs.');
  }

  console.error(`Ask: "${question}"`);
  console.error(`Listings: ${listings.length} (${picksFilter}) — one call per listing`);
  console.error(`Model: ${modelConfig.model}${modelConfig.thinkingLevel ? `:${modelConfig.thinkingLevel}` : ''}`);

  // 6. Init Gemini
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  // 7. Call LLM per listing
  const answers: AskAnswer[] = [];
  let totalInput = 0, totalOutput = 0, totalThinking = 0, totalDurationMs = 0;

  for (let i = 0; i < listings.length; i++) {
    const ctx = listings[i];
    const label = `${i + 1}/${listings.length} ${ctx.title.substring(0, 40)}`;
    console.error(`  [${label}]...`);

    const userMessage = `## Question\n${question}\n\n## Listing Details\n${JSON.stringify(trimListingForAsk(ctx.listingData), null, 2)}\n\n## Guest Reviews\n${ctx.reviewsText}`;

    try {
      const result = await callGemini(
        ai, modelConfig.model, modelConfig.thinkingLevel,
        ASK_SYSTEM_PROMPT, userMessage, ASK_JSON_SCHEMA, label,
      );

      const parsed = JSON.parse(result.text);
      answers.push({
        id: ctx.id,
        title: ctx.title,
        answer: parsed.answer,
        confidence: parsed.confidence,
        evidence: parsed.evidence || [],
      });

      const inTok = result.usageMetadata?.promptTokenCount || 0;
      const outTok = result.usageMetadata?.candidatesTokenCount || 0;
      const thinkTok = result.usageMetadata?.thoughtsTokenCount || 0;
      totalInput += inTok;
      totalOutput += outTok;
      totalThinking += thinkTok;
      totalDurationMs += result.durationMs;

      const conf = parsed.confidence === 'high' ? '●' : parsed.confidence === 'medium' ? '◐' : '○';
      console.error(`    ${conf} ${(result.durationMs / 1000).toFixed(1)}s · ${inTok} in / ${outTok} out`);
    } catch (err: any) {
      console.error(`    FAILED: ${err.message}`);
      answers.push({
        id: ctx.id,
        title: ctx.title,
        answer: `Error: ${err.message}`,
        confidence: 'low',
        evidence: [],
      });
    }
  }

  // 8. Compute total usage
  const pricing = PRICING[modelConfig.model] || PRICING.default;
  const inputCost = (totalInput / 1_000_000) * pricing.input;
  const outputCost = (totalOutput / 1_000_000) * pricing.output;
  const cost = +(inputCost + outputCost).toFixed(4);

  console.error(`\nTotal: ${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out${totalThinking ? ` (${totalThinking.toLocaleString()} thinking)` : ''} [${(totalDurationMs / 1000).toFixed(1)}s]`);
  console.error(`Cost: $${inputCost.toFixed(4)} + $${outputCost.toFixed(4)} = $${cost} (${modelConfig.model})`);

  // 9. Save result
  const askResult: AskResult = {
    question,
    askedAt: new Date().toISOString(),
    model: modelConfig.model,
    answers,
    usage: { inputTokens: totalInput, outputTokens: totalOutput, thinkingTokens: totalThinking || undefined, cost },
  };

  fs.mkdirSync(queriesDir, { recursive: true });
  fs.writeFileSync(queryFile, JSON.stringify(askResult, null, 2), 'utf-8');
  console.error(`Saved: ${queryFile}`);

  // 10. Print summary table
  console.log('');
  console.log(`Q: ${question}`);
  console.log('─'.repeat(80));
  for (const ans of answers) {
    const conf = ans.confidence === 'high' ? '●' : ans.confidence === 'medium' ? '◐' : '○';
    console.log(`${conf} ${ans.title}`);
    console.log(`  ${ans.answer}`);
    if (ans.evidence.length > 0) {
      console.log(`  Evidence: ${ans.evidence.join(' | ')}`);
    }
    console.log('');
  }

  return askResult;
}

// --- Standalone execution ---

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: ask <question> [--picks liked|hidden|all] [--ids <csv>] [--model <model>] [-o <dir>] [--save-name <slug>] [--force]');
    process.exit(1);
  }

  try { await import('dotenv/config'); } catch {}

  const question = args[0];
  let picks: 'liked' | 'hidden' | 'all' | undefined;
  let ids: string[] | undefined;
  let model: string | undefined;
  let outputDir = 'data';
  let saveName: string | undefined;
  let force = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--picks' && args[i + 1]) { picks = args[++i] as any; }
    else if (args[i] === '--ids' && args[i + 1]) { ids = args[++i].split(','); }
    else if (args[i] === '--model' && args[i + 1]) { model = args[++i]; }
    else if ((args[i] === '-o' || args[i] === '--output-dir') && args[i + 1]) { outputDir = args[++i]; }
    else if (args[i] === '--save-name' && args[i + 1]) { saveName = args[++i]; }
    else if (args[i] === '--force') { force = true; }
  }

  await runAsk({ question, outputDir, picks, ids, model, saveName, force });
}

if (process.argv[1] && (
  process.argv[1].endsWith('/ask.js') ||
  process.argv[1].endsWith('/ask.ts')
)) {
  main().catch(err => {
    console.error('Fatal error:', err.message || err);
    process.exit(1);
  });
}
