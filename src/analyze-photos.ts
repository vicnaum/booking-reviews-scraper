// src/analyze-photos.ts
//
// AI-powered photo analysis using Gemini vision
// Sends all listing photos in one request for holistic property analysis

import * as fs from 'fs';
import * as path from 'path';
import { parseModelConfig, getProviderApiKey, PROVIDER_KEY_NAMES, type LLMProvider, type UsageSummary } from './analyze.js';

// --- Types ---

export interface PhotoAnalysisOptions {
  photosDir: string;         // Path to directory containing photos
  listingFile?: string;      // Optional listing JSON for cross-referencing
  model?: string;            // Default: gemini-3-flash-preview:high
  priorities?: string;       // Guest priorities
}

export interface PhotoAnalysisResult {
  data: any;                 // Parsed analysis JSON
  model: string;
  provider: LLMProvider;
  photoCount: number;
  tokensUsed?: number;
  usage?: UsageSummary;
}

// --- Constants ---

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 5000;

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// Pricing per 1M tokens (USD) — subset relevant for vision
const PRICING: Record<string, { input: number; output: number }> = {
  default:                          { input: 0.15, output: 0.60 },
  'gemini-3-flash-preview':        { input: 0.50, output: 3.00 },
  'gemini-2.5-flash-preview-05-20':{ input: 0.15, output: 3.50 },
  'gemini-2.0-flash':              { input: 0.10, output: 0.40 },
};

// --- Photo analysis prompt ---

const PHOTO_ANALYSIS_SYSTEM_PROMPT = `You are analyzing photos of a rental property to help a traveler decide whether to book.

Look at ALL photos carefully and return a JSON analysis with this structure:
{
  "rooms": [
    {
      "type": "bedroom|bathroom|kitchen|living_room|dining|balcony|terrace|hallway|exterior|other",
      "description": "Brief description of what you see",
      "bedType": "double|single|twin|bunk|sofa_bed|none",
      "bedCount": 1,
      "condition": "modern|renovated|dated|rustic|mixed",
      "cleanliness": "spotless|clean|acceptable|questionable",
      "naturalLight": "excellent|good|limited|none",
      "size": "spacious|adequate|compact|cramped",
      "notes": "Any notable features or concerns"
    }
  ],
  "bathroom": {
    "count": 1,
    "hasBathtub": false,
    "hasShower": true,
    "condition": "modern|dated|renovated",
    "notes": ""
  },
  "kitchen": {
    "type": "full|kitchenette|none",
    "condition": "modern|dated|renovated",
    "equipment": ["stove", "oven", "dishwasher"],
    "notes": ""
  },
  "exterior": {
    "hasBalcony": false,
    "hasTerrace": false,
    "hasGarden": false,
    "view": "city|street|courtyard|garden|sea|mountain|none",
    "notes": ""
  },
  "overallModernity": 7,
  "overallCleanliness": 8,
  "overallImpression": "1-2 sentences: what would a guest think walking in?",
  "concerns": ["list of visual red flags: stains, damage, clutter, misleading angles"],
  "highlights": ["list of visual positives: nice view, modern appliances, spacious rooms"],
  "listingAccuracy": {
    "score": 8,
    "discrepancies": ["listing says X but photos show Y"]
  }
}

Guidelines:
- Analyze EVERY photo — don't skip any
- Be SPECIFIC and FACTUAL: "small bathroom with standing shower only" not "bathroom facilities"
- Note misleading photography: wide-angle distortion, strategic angles hiding problems, stock photos
- If multiple bedrooms exist, describe each separately in the rooms array
- Count beds carefully — a "double" in the photo might actually be two singles pushed together
- Look for signs of age, wear, and maintenance quality
- Check for windows/natural light in bedrooms — no windows is a major concern
- Note the overall aesthetic: professional decor vs. mismatched furniture vs. bare/sparse
- If a room appears in multiple photos (different angles), combine observations into one entry
- overallModernity and overallCleanliness are on a 1-10 scale
- listingAccuracy.score is on a 1-10 scale (10 = photos match perfectly, 1 = totally misleading)`;

const PHOTO_ANALYSIS_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    rooms: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          type: { type: 'string' as const },
          description: { type: 'string' as const },
          bedType: { type: 'string' as const },
          bedCount: { type: 'number' as const },
          condition: { type: 'string' as const },
          cleanliness: { type: 'string' as const },
          naturalLight: { type: 'string' as const },
          size: { type: 'string' as const },
          notes: { type: 'string' as const },
        },
        required: ['type', 'description', 'condition', 'cleanliness', 'naturalLight', 'size'],
      },
    },
    bathroom: {
      type: 'object' as const,
      properties: {
        count: { type: 'number' as const },
        hasBathtub: { type: 'boolean' as const },
        hasShower: { type: 'boolean' as const },
        condition: { type: 'string' as const },
        notes: { type: 'string' as const },
      },
      required: ['count', 'hasBathtub', 'hasShower', 'condition'],
    },
    kitchen: {
      type: 'object' as const,
      properties: {
        type: { type: 'string' as const },
        condition: { type: 'string' as const },
        equipment: { type: 'array' as const, items: { type: 'string' as const } },
        notes: { type: 'string' as const },
      },
      required: ['type', 'condition', 'equipment'],
    },
    exterior: {
      type: 'object' as const,
      properties: {
        hasBalcony: { type: 'boolean' as const },
        hasTerrace: { type: 'boolean' as const },
        hasGarden: { type: 'boolean' as const },
        view: { type: 'string' as const },
        notes: { type: 'string' as const },
      },
      required: ['hasBalcony', 'hasTerrace', 'hasGarden', 'view'],
    },
    overallModernity: { type: 'number' as const },
    overallCleanliness: { type: 'number' as const },
    overallImpression: { type: 'string' as const },
    concerns: { type: 'array' as const, items: { type: 'string' as const } },
    highlights: { type: 'array' as const, items: { type: 'string' as const } },
    listingAccuracy: {
      type: 'object' as const,
      properties: {
        score: { type: 'number' as const },
        discrepancies: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['score', 'discrepancies'],
    },
  },
  required: ['rooms', 'bathroom', 'kitchen', 'exterior', 'overallModernity', 'overallCleanliness', 'overallImpression', 'concerns', 'highlights', 'listingAccuracy'],
};

function getPhotoAnalysisSchema(withPriorities: boolean): any {
  const schema = JSON.parse(JSON.stringify(PHOTO_ANALYSIS_JSON_SCHEMA));
  if (withPriorities) {
    schema.properties.priorityAnalysis = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'string' },
          verdict: { type: 'string', enum: ['met', 'unmet', 'mixed', 'no-data'] },
          evidence: { type: 'string' },
        },
        required: ['priority', 'verdict', 'evidence'],
      },
    };
    schema.required = [...schema.required, 'priorityAnalysis'];
  }
  return schema;
}

// --- Helpers ---

function isDegenerate(text: string): boolean {
  if (text.length < 500) return false;
  const sample = text.slice(-200);
  const uniqueChars = new Set(sample).size;
  return uniqueChars < 8;
}

function readImageFiles(photosDir: string): { filePath: string; mimeType: string }[] {
  const resolvedDir = path.resolve(photosDir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Photos directory not found: ${resolvedDir}`);
  }

  const entries = fs.readdirSync(resolvedDir)
    .filter(f => {
      const ext = path.extname(f).toLowerCase();
      return SUPPORTED_EXTENSIONS.has(ext);
    })
    .sort(); // alphabetical — photos are numbered: 01_Living_room.jpeg, etc.

  const files: { filePath: string; mimeType: string }[] = [];
  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    const mimeType = MIME_TYPES[ext];
    if (mimeType) {
      files.push({ filePath: path.join(resolvedDir, entry), mimeType });
    }
  }

  return files;
}

// --- Gemini vision call ---

interface CallResult {
  text: string;
  usageMetadata?: any;
  durationMs: number;
}

async function callGeminiVision(
  ai: any,
  modelName: string,
  thinkingLevel: string | null,
  systemPrompt: string,
  textContent: string,
  imageFiles: { filePath: string; mimeType: string }[],
  jsonSchema: any,
  label?: string,
): Promise<CallResult> {
  // Build content parts: text prompt first, then all images
  const parts: any[] = [{ text: textContent }];

  for (const img of imageFiles) {
    try {
      const data = fs.readFileSync(img.filePath);
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: data.toString('base64'),
        },
      });
    } catch (err: any) {
      console.warn(`  Warning: could not read ${path.basename(img.filePath)}: ${err.message}`);
    }
  }

  const generateConfig: any = {
    model: modelName,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 8192,
      temperature: 1.0,
      mediaResolution: 'MEDIA_RESOLUTION_HIGH',
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
      console.error(`  [${label || 'vision'}] attempt ${attempt}/${MAX_RETRIES} failed after ${(durationMs / 1000).toFixed(1)}s — ${status} ${msg}`);

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * attempt;
        console.error(`  Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw new Error(`Gemini API failed after ${MAX_RETRIES} attempts (${label || 'vision'}): ${msg}`);
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

// --- Listing context helpers ---

function formatPoiDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatListingContext(listingData: any): string {
  const lines: string[] = ['=== LISTING DETAILS (for cross-referencing with photos) ==='];

  if (listingData.title) lines.push(`Title: ${listingData.title}`);
  if (listingData.description) lines.push(`Description: ${listingData.description}`);
  if (listingData.poiDistanceMeters != null) {
    lines.push(`Distance to POI: ${formatPoiDistance(listingData.poiDistanceMeters)}`);
  }
  if (listingData.poi?.lat != null && listingData.poi?.lng != null) {
    lines.push(`POI: ${listingData.poi.lat}, ${listingData.poi.lng}`);
  }

  // Booking.com listing
  if (listingData.amenities && Array.isArray(listingData.amenities) && typeof listingData.amenities[0] === 'string') {
    lines.push(`Amenities: ${listingData.amenities.join(', ')}`);
  }
  // Airbnb listing
  if (listingData.amenities && Array.isArray(listingData.amenities) && listingData.amenities[0]?.name) {
    const available = listingData.amenities.filter((a: any) => a.available).map((a: any) => a.name);
    if (available.length) lines.push(`Amenities: ${available.join(', ')}`);
  }

  if (listingData.bedrooms) lines.push(`Bedrooms: ${listingData.bedrooms}`);
  if (listingData.beds) lines.push(`Beds: ${listingData.beds}`);
  if (listingData.bathrooms) lines.push(`Bathrooms: ${listingData.bathrooms}`);
  if (listingData.capacity) lines.push(`Capacity: ${listingData.capacity} guests`);

  if (listingData.sleepingArrangements?.length) {
    const beds = listingData.sleepingArrangements
      .map((s: any) => `${s.room}: ${s.beds.join(', ')}`)
      .join('; ');
    lines.push(`Sleeping: ${beds}`);
  }

  if (listingData.rooms?.length) {
    for (const room of listingData.rooms) {
      lines.push(`Room: ${room.name} — ${room.description || ''}`);
    }
  }

  return lines.join('\n');
}

// --- Main entry point ---

export async function runAnalyzePhotos(options: PhotoAnalysisOptions): Promise<PhotoAnalysisResult> {
  const { photosDir, listingFile, priorities } = options;
  const modelStr = options.model || process.env.LLM_MODEL || 'gemini-3-flash-preview:high';

  // 1. Parse model config
  const modelConfig = parseModelConfig(modelStr);
  if (modelConfig.provider !== 'gemini') {
    throw new Error(`Photo analysis currently only supports Gemini models (got: ${modelConfig.provider}/${modelConfig.model}). Gemini is the most cost-effective for vision.`);
  }

  const apiKey = getProviderApiKey(modelConfig.provider);
  if (!apiKey) {
    const keyName = PROVIDER_KEY_NAMES[modelConfig.provider];
    throw new Error(`${keyName} (or LLM_API_KEY) environment variable is required for ${modelConfig.model}.`);
  }

  // 2. Read image files
  const imageFiles = readImageFiles(photosDir);
  if (imageFiles.length === 0) {
    throw new Error(`No valid image files found in ${photosDir} (supported: ${Array.from(SUPPORTED_EXTENSIONS).join(', ')})`);
  }

  console.error(`Photos: ${imageFiles.length} images in ${path.resolve(photosDir)}`);

  // 3. Build system prompt
  let systemPrompt = PHOTO_ANALYSIS_SYSTEM_PROMPT;
  const hasPriorities = !!priorities;

  if (hasPriorities) {
    systemPrompt += `\n\nGUEST PRIORITIES: The guest has specific requirements: ${priorities}.
Check the photos for visual evidence related to each priority. Include a "priorityAnalysis" section analyzing each priority with a clear MET/UNMET/MIXED/NO-DATA verdict based on what you can see.`;
  }

  // 4. Build text content (listing context + photo filenames for reference)
  const textParts: string[] = [];
  textParts.push(`Analyze these ${imageFiles.length} photos of a rental property.`);
  textParts.push(`Photo filenames (in order): ${imageFiles.map(f => path.basename(f.filePath)).join(', ')}`);

  // Add listing context if available
  if (listingFile) {
    const listingPath = path.resolve(listingFile);
    if (fs.existsSync(listingPath)) {
      try {
        const listingData = JSON.parse(fs.readFileSync(listingPath, 'utf-8'));
        textParts.push('');
        textParts.push(formatListingContext(listingData));
        textParts.push('');
        textParts.push('Cross-reference the listing claims with what you actually see in the photos. Note any discrepancies in listingAccuracy.');
      } catch (err: any) {
        console.warn(`  Warning: could not parse listing file: ${err.message}`);
      }
    }
  }

  const textContent = textParts.join('\n');
  const jsonSchema = getPhotoAnalysisSchema(hasPriorities);

  // 5. Call Gemini vision API
  console.error(`Model: ${modelConfig.model}${modelConfig.thinkingLevel ? `:${modelConfig.thinkingLevel}` : ''}`);

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const result = await callGeminiVision(
    ai,
    modelConfig.model,
    modelConfig.thinkingLevel,
    systemPrompt,
    textContent,
    imageFiles,
    jsonSchema,
    'photo-analysis',
  );

  // 6. Parse result
  let parsed: any;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    throw new Error(`Failed to parse Gemini response as JSON:\n${result.text.slice(0, 500)}`);
  }

  // 7. Log usage
  console.error(`\nUsage:`);
  console.error(formatUsageSummary(result.usageMetadata, modelConfig.model, result.durationMs));

  const prompt = result.usageMetadata?.promptTokenCount || 0;
  const response = result.usageMetadata?.candidatesTokenCount || 0;
  const thinking = result.usageMetadata?.thoughtsTokenCount || 0;
  const pricing = PRICING[modelConfig.model] || PRICING.default;
  const cost = +(((prompt / 1_000_000) * pricing.input) + ((response / 1_000_000) * pricing.output)).toFixed(4);

  return {
    data: parsed,
    model: modelConfig.model,
    provider: modelConfig.provider,
    photoCount: imageFiles.length,
    tokensUsed: prompt,
    usage: { inputTokens: prompt, outputTokens: response, thinkingTokens: thinking || undefined, cost },
  };
}

// --- Standalone execution ---

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: analyze-photos <photos-dir> [--listing <file>] [--model <model>] [--priorities <text>]');
    process.exit(1);
  }

  // Load .env
  try { await import('dotenv/config'); } catch {}

  const photosDir = args[0];
  let listingFile: string | undefined;
  let model: string | undefined;
  let priorities: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--listing' && args[i + 1]) { listingFile = args[++i]; }
    else if (args[i] === '--model' && args[i + 1]) { model = args[++i]; }
    else if (args[i] === '--priorities' && args[i + 1]) { priorities = args[++i]; }
  }

  const result = await runAnalyzePhotos({ photosDir, listingFile, model, priorities });
  console.log(JSON.stringify(result.data, null, 2));
}

if (process.argv[1] && (
  process.argv[1].endsWith('/analyze-photos.js') ||
  process.argv[1].endsWith('/analyze-photos.ts')
)) {
  main().catch(err => {
    console.error('Fatal error:', err.message || err);
    process.exit(1);
  });
}
