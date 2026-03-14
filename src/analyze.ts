// src/analyze.ts
//
// AI-powered review analysis using Google Gemini
// Formats review/listing JSON into compact text, sends to LLM for analysis

import * as fs from 'fs';
import * as path from 'path';

// --- Types ---

interface BookingReview {
  hotel_name: string;
  username: string;
  user_country: string;
  room_view: string;
  stay_duration: string;
  stay_type: string;
  review_post_date: string;
  review_title: string;
  rating: number;
  original_lang: string;
  review_text_liked: string | null;
  review_text_disliked: string | null;
  full_review: string;
  en_full_review: string;
  found_helpful: number;
  found_unhelpful: number;
  owner_resp_text: string | null;
}

interface BookingReviewFile {
  scraped_at: string;
  total_reviews: number;
  hotels_processed: string[];
  reviews: BookingReview[];
}

interface AirbnbReview {
  property_id: string;
  property_title: string;
  review_id: string;
  reviewer_name: string | null;
  reviewer_id: string | null;
  review_date: string;
  review_text: string;
  rating: number;
  reviewer_avatar_url: string | null;
  reviewer_verification_level: string | null;
  response_text: string | null;
  response_date: string | null;
  language: string;
  can_be_translated: boolean;
  localized_date: string;
}

interface AirbnbReviewFile {
  input_file: string;
  scraped_at: string;
  total_reviews: number;
  properties_processed: string[];
  reviews: AirbnbReview[];
}

interface BookingListing {
  id: string;
  hotelId: number;
  url: string;
  title: string;
  description: string;
  propertyType: string | null;
  stars: number | null;
  address: {
    street: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
    full: string;
  };
  coordinates: { lat: number; lng: number };
  photos: any[];
  amenities: string[];
  rating: number;
  ratingText: string;
  reviewCount: number;
  subRatings: Record<string, number>;
  checkIn: string | null;
  checkOut: string | null;
  linkedRoomId: string | null;
  rooms: { id: string; name: string; blockIds: string[]; photos?: any[] }[];
  poi?: { lat: number; lng: number };
  poiDistanceMeters?: number | null;
  scrapedAt: string;
}

interface AirbnbListing {
  id: string;
  url: string;
  title: string;
  description: string;
  propertyType: string | null;
  coordinates: { lat: number; lng: number };
  capacity: number;
  bedrooms: number;
  beds: number;
  bathrooms: number | null;
  photos: any[];
  amenities: { name: string; available: boolean; category: string }[];
  host: {
    name: string;
    id: string;
    isSuperhost: boolean;
    profilePicUrl: string;
    highlights: any[];
  };
  houseRules: string[];
  highlights: any[];
  rating: number;
  reviewCount: number;
  subRatings: Record<string, number>;
  pricing: any;
  checkIn: string;
  checkOut: string;
  cancellationPolicy: string | null;
  sleepingArrangements: { room: string; beds: string[] }[];
  poi?: { lat: number; lng: number };
  poiDistanceMeters?: number | null;
  scrapedAt: string;
}

type Platform = 'booking' | 'airbnb';

interface FormatResult {
  text: string;
  totalReviews: number;
  includedReviews: number;
  filteredReviews: number;
}

interface FormatOptions {
  yearHeaders?: boolean;
}

// --- Compact text formatters ---

const GENERIC_TITLES = new Set([
  'exceptional', 'exceptional.', 'superb', 'superb.', 'wonderful', 'wonderful.',
  'very good', 'very good.', 'good', 'good.', 'pleasant', 'pleasant.',
  'passable', 'passable.', 'poor', 'poor.', 'very poor', 'very poor.',
  'disappointing', 'disappointing.', 'ok', 'ok.', 'okay', 'okay.',
  'fine', 'fine.', 'nice', 'nice.', 'great', 'great.', 'excellent', 'excellent.',
  'awesome', 'awesome.', 'amazing', 'amazing.', 'perfect', 'perfect.',
  'bad', 'bad.', 'terrible', 'terrible.', 'horrible', 'horrible.',
]);

function isGenericTitle(title: string): boolean {
  if (!title || title.length <= 15) return true;
  return GENERIC_TITLES.has(title.trim().toLowerCase());
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

function formatPoiDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

function appendPoiContext(
  lines: string[],
  listing: { poi?: { lat: number; lng: number }; poiDistanceMeters?: number | null },
): void {
  if (listing.poiDistanceMeters != null) {
    lines.push(`Distance to POI: ${formatPoiDistance(listing.poiDistanceMeters)}`);
  }

  if (listing.poi) {
    lines.push(`POI: ${listing.poi.lat}, ${listing.poi.lng}`);
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function formatDate(dateStr: string): string {
  // "2025-08-05 12:00:00" → "2025-08-05"
  // "2025-08-05T12:00:00.000Z" → "2025-08-05"
  return dateStr.slice(0, 10);
}

// --- Empty review filter helpers ---

function isEmptyBookingReview(r: BookingReview): boolean {
  const hasLiked = r.review_text_liked && r.review_text_liked.trim().length > 0;
  const hasDisliked = r.review_text_disliked && r.review_text_disliked.trim().length > 0;
  return !hasLiked && !hasDisliked && isGenericTitle(r.review_title);
}

function isEmptyAirbnbReview(r: AirbnbReview): boolean {
  const text = r.review_text ? stripHtml(r.review_text) : '';
  return !text || text.length < 5;
}

function filterEmptyBookingReviews(reviews: BookingReview[]): BookingReview[] {
  return reviews.filter(r => !isEmptyBookingReview(r));
}

function filterEmptyAirbnbReviews(reviews: AirbnbReview[]): AirbnbReview[] {
  return reviews.filter(r => !isEmptyAirbnbReview(r));
}

// --- Date and year helpers ---

function getReviewYear(r: any, platform: Platform): number {
  const dateStr = platform === 'booking' ? r.review_post_date : r.review_date;
  return parseInt(dateStr.slice(0, 4));
}

function filterByDateWindow(reviews: any[], platform: Platform, minYear: number): { filtered: any[]; dropped: number } {
  const result = reviews.filter((r: any) => getReviewYear(r, platform) >= minYear);
  return { filtered: result, dropped: reviews.length - result.length };
}

function groupReviewsByYear(reviews: any[], platform: Platform): Map<number, any[]> {
  const groups = new Map<number, any[]>();
  for (const r of reviews) {
    const year = getReviewYear(r, platform);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year)!.push(r);
  }
  return new Map(Array.from(groups.entries()).sort((a, b) => a[0] - b[0]));
}

// --- Format functions ---

export function formatBookingReviews(data: BookingReviewFile, roomName?: string, options?: FormatOptions): FormatResult {
  // Sort by date ascending
  const sortedReviews = [...data.reviews].sort((a, b) =>
    a.review_post_date.localeCompare(b.review_post_date)
  );

  const lines: string[] = [];
  let filtered = 0;
  let currentYear = '';

  for (const r of sortedReviews) {
    // Filter: skip if both liked/disliked are null AND title is generic
    if (isEmptyBookingReview(r)) {
      filtered++;
      continue;
    }

    const parts: string[] = [];

    // Header line: [rating/10] date | stay_type | country | duration | room
    const date = formatDate(r.review_post_date);
    const duration = r.stay_duration || '';
    const headerParts = [date, r.stay_type, r.user_country, duration, r.room_view].filter(Boolean);
    parts.push(`[${r.rating}/10] ${headerParts.join(' | ')}`);

    // Title (only if meaningful)
    if (!isGenericTitle(r.review_title)) {
      parts.push(r.review_title);
    }

    // Liked/disliked — prefer en_full_review extraction, fall back to raw fields
    let liked = extractLikedFromEnFull(r.en_full_review);
    let disliked = extractDislikedFromEnFull(r.en_full_review);
    if (!liked) liked = r.review_text_liked?.trim() || null;
    if (!disliked) disliked = r.review_text_disliked?.trim() || null;

    if (liked) {
      parts.push(`+: ${liked}`);
    }
    if (disliked) {
      parts.push(`-: ${disliked}`);
    }

    // Owner response
    if (r.owner_resp_text && r.owner_resp_text.trim()) {
      parts.push(`RESP: ${r.owner_resp_text.trim()}`);
    }

    // Year header (prepend to first review of each new year)
    let reviewBlock = parts.join('\n');
    if (options?.yearHeaders) {
      const year = r.review_post_date.slice(0, 4);
      if (year !== currentYear) {
        currentYear = year;
        reviewBlock = `=== YEAR: ${year} ===\n` + reviewBlock;
      }
    }

    lines.push(reviewBlock);
  }

  const included = data.reviews.length - filtered;
  let header: string;
  if (roomName) {
    header = `=== REVIEWS (booking.com): ${included} of ${data.total_reviews} reviews for "${roomName}" (${filtered} empty filtered) ===\n`;
  } else {
    header = `=== REVIEWS (booking.com): ${included} of ${data.total_reviews} reviews (${filtered} empty filtered) ===\n`;
  }
  const text = header + lines.join('\n---\n');

  return { text, totalReviews: data.total_reviews, includedReviews: included, filteredReviews: filtered };
}

/**
 * Extract "liked" portion from en_full_review which has formats:
 * "Title\nLiked · text\nDisliked · text" or "title: X liked: Y disliked: Z"
 */
function extractLikedFromEnFull(enFull: string | null): string | null {
  if (!enFull) return null;
  // Match "Liked ·", "Liked:", or "liked:" followed by text, stopping at "Disliked" or end
  const match = enFull.match(/[Ll]iked\s*[·:]\s*([\s\S]*?)(?=[Dd]isliked\s*[·:]|$)/);
  if (match && match[1].trim()) return match[1].trim();
  return null;
}

function extractDislikedFromEnFull(enFull: string | null): string | null {
  if (!enFull) return null;
  const match = enFull.match(/[Dd]isliked\s*[·:]\s*([\s\S]*?)$/);
  if (match && match[1].trim()) return match[1].trim();
  return null;
}

export function formatAirbnbReviews(data: AirbnbReviewFile, options?: FormatOptions): FormatResult {
  // Sort by date ascending
  const sortedReviews = [...data.reviews].sort((a, b) =>
    a.review_date.localeCompare(b.review_date)
  );

  const lines: string[] = [];
  let filtered = 0;
  let currentYear = '';

  for (const r of sortedReviews) {
    const text = r.review_text ? stripHtml(r.review_text) : '';
    if (!text || text.length < 5) {
      filtered++;
      continue;
    }

    const date = formatDate(r.review_date);
    const header = `[${r.rating}/5] ${date} | ${r.language}`;
    const parts = [header, text];

    if (r.response_text && r.response_text.trim()) {
      parts.push(`RESP: ${stripHtml(r.response_text.trim())}`);
    }

    // Year header (prepend to first review of each new year)
    let reviewBlock = parts.join('\n');
    if (options?.yearHeaders) {
      const year = r.review_date.slice(0, 4);
      if (year !== currentYear) {
        currentYear = year;
        reviewBlock = `=== YEAR: ${year} ===\n` + reviewBlock;
      }
    }

    lines.push(reviewBlock);
  }

  const included = data.reviews.length - filtered;
  const headerLine = `=== REVIEWS (airbnb): ${included} of ${data.total_reviews} reviews (${filtered} empty filtered) ===\n`;
  const resultText = headerLine + lines.join('\n---\n');

  return { text: resultText, totalReviews: data.total_reviews, includedReviews: included, filteredReviews: filtered };
}

export function formatBookingListing(listing: BookingListing): string {
  const lines: string[] = [];
  lines.push(`=== LISTING: ${listing.title} ===`);
  if (listing.address?.full) lines.push(`Address: ${listing.address.full}`);
  appendPoiContext(lines, listing);
  if (listing.rating) {
    lines.push(`Rating: ${listing.rating} ${listing.ratingText || ''} | ${listing.reviewCount} reviews`);
  }
  if (listing.subRatings && Object.keys(listing.subRatings).length > 0) {
    const subs = Object.entries(listing.subRatings).map(([k, v]) => `${k} ${v}`).join(', ');
    lines.push(`Sub-ratings: ${subs}`);
  }
  if (listing.checkIn) lines.push(`Check-in: ${listing.checkIn}`);
  if (listing.checkOut) lines.push(`Check-out: ${listing.checkOut}`);
  if (listing.amenities?.length) {
    lines.push(`Amenities: ${listing.amenities.join(', ')}`);
  }
  if (listing.description) {
    lines.push(`Description: ${listing.description}`);
  }
  return lines.join('\n');
}

export function formatAirbnbListing(listing: AirbnbListing): string {
  const lines: string[] = [];
  lines.push(`=== LISTING: ${listing.title} ===`);
  if (listing.propertyType) lines.push(`Type: ${listing.propertyType}`);
  appendPoiContext(lines, listing);

  const capacityParts: string[] = [];
  if (listing.capacity) capacityParts.push(`${listing.capacity} guests`);
  if (listing.bedrooms) capacityParts.push(`${listing.bedrooms} bedrooms`);
  if (listing.beds) capacityParts.push(`${listing.beds} beds`);
  if (listing.bathrooms) capacityParts.push(`${listing.bathrooms} baths`);
  if (capacityParts.length) lines.push(`Capacity: ${capacityParts.join(', ')}`);

  if (listing.host) {
    const superhost = listing.host.isSuperhost ? ' (Superhost)' : '';
    lines.push(`Host: ${listing.host.name}${superhost}`);
  }
  if (listing.rating) {
    lines.push(`Rating: ${listing.rating} | ${listing.reviewCount} reviews`);
  }
  if (listing.subRatings && Object.keys(listing.subRatings).length > 0) {
    const subs = Object.entries(listing.subRatings).map(([k, v]) => `${k} ${v}`).join(', ');
    lines.push(`Sub-ratings: ${subs}`);
  }
  if (listing.checkIn) lines.push(`Check-in: ${listing.checkIn}`);
  if (listing.checkOut) lines.push(`Check-out: ${listing.checkOut}`);
  if (listing.houseRules?.length) {
    lines.push(`House rules: ${listing.houseRules.join(', ')}`);
  }
  if (listing.amenities?.length) {
    const available = listing.amenities
      .filter(a => a.available)
      .map(a => a.name);
    if (available.length) lines.push(`Amenities: ${available.join(', ')}`);
  }
  if (listing.sleepingArrangements?.length) {
    const beds = listing.sleepingArrangements
      .map(s => `${s.room}: ${s.beds.join(', ')}`)
      .join('; ');
    lines.push(`Sleeping: ${beds}`);
  }
  if (listing.description) {
    lines.push(`Description: ${listing.description}`);
  }
  return lines.join('\n');
}

// --- Platform detection from JSON structure ---

function detectPlatformFromReviews(data: any): Platform {
  if (data.hotels_processed) return 'booking';
  if (data.properties_processed) return 'airbnb';
  // Fallback: check review fields
  if (data.reviews?.[0]?.review_text_liked !== undefined) return 'booking';
  if (data.reviews?.[0]?.review_text !== undefined) return 'airbnb';
  throw new Error('Cannot detect platform from review JSON structure. Use --booking or --airbnb.');
}

function detectPlatformFromListing(data: any): Platform {
  if (data.hotelId !== undefined) return 'booking';
  if (data.host !== undefined || data.capacity !== undefined) return 'airbnb';
  throw new Error('Cannot detect platform from listing JSON structure.');
}

// --- LLM model & provider routing ---

export type LLMProvider = 'gemini' | 'openai' | 'xai';

interface ModelConfig {
  provider: LLMProvider;
  model: string;
  thinkingLevel: string | null;
}

export function parseModelConfig(modelStr: string): ModelConfig {
  const parts = modelStr.split(':');
  const model = parts[0];
  const thinkingLevel = parts[1] || null;

  let provider: LLMProvider;
  if (model.startsWith('gemini')) {
    provider = 'gemini';
  } else if (model.startsWith('grok')) {
    provider = 'xai';
  } else {
    provider = 'openai';
  }

  return { provider, model, thinkingLevel };
}

export function getProviderApiKey(provider: LLMProvider): string | undefined {
  switch (provider) {
    case 'gemini': return process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    case 'openai': return process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
    case 'xai': return process.env.XAI_API_KEY || process.env.LLM_API_KEY;
  }
}

function getProviderBaseURL(provider: LLMProvider): string | undefined {
  if (provider === 'xai') return 'https://api.x.ai/v1';
  return undefined;
}

export const PROVIDER_KEY_NAMES: Record<LLMProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
};

// --- Default analysis prompt ---

const DEFAULT_SYSTEM_PROMPT = `You are helping a real traveler decide whether to book this property. Analyze guest reviews (and listing details if available).

Think like someone who will actually SLEEP here, EAT here, LIVE here for days. What would make them love it or regret booking?

Return JSON with this structure:
{
  "overallSentiment": "1-2 factual sentences — would a typical guest be happy here?",
  "strengths": [
    { "theme": "Short label", "description": "What guests actually enjoyed", "evidence": ["direct quote 1", "direct quote 2", ...], "frequency": "N of M reviews mention this" }
  ],
  "weaknesses": [
    { "theme": "Short label", "description": "What made guests unhappy", "evidence": ["direct quote 1", "direct quote 2", ...], "severity": "low/medium/high", "frequency": "N of M reviews mention this" }
  ],
  "redFlags": [
    { "issue": "Short label", "description": "Why this matters depending on your situation", "evidence": ["direct quote 1", ...], "frequency": "N of M reviews mention this" }
  ],
  "dealBreakers": [
    { "issue": "Short label", "description": "Why this could ruin someone's stay", "evidence": ["direct quote 1", ...], "frequency": "N of M reviews mention this" }
  ],
  "trends": "What changed between years — getting better or worse?",
  "guestDemographics": "Who stays here (couples, families, solo)? Nationality patterns?",
  "summaryScore": { "score": 8.5, "justification": "Brief justification on 1-10 scale" }
}

What counts as a redFlag — things that DEPEND ON YOUR SITUATION:
- No elevator (fine for young couple, problem with heavy luggage or stroller)
- Small bathroom/shower (fine if you're average-sized, cramped if tall/large)
- Basic breakfast (fine if you eat out, annoying if you need a proper morning meal)
- Far from center / limited transit (fine with a car, bad if walking)
- Street noise during day (light sleepers beware, others won't care)
- Quirky decor or layout (some love it, some hate it)
- Old building common areas (cosmetic, not a comfort issue)

What counts as a dealBreaker — things that could RUIN a stay:
- No windows / can't open windows / no fresh air in bedroom
- Severe noise: loud bar/club below, construction at 6am, thin walls hearing every word
- Pests: cockroaches, bedbugs, ants, mice
- Filth: mold, stains, dirty bathrooms, persistent bad smell
- Unsafe feeling: sketchy neighborhood at night, broken locks
- Deceptive listing: photos don't match reality, "apartment" is actually a basement, hidden fees
- Sleep killers: terrible mattress, no AC in summer heat, no heating in winter
- Hostile host: threatens guests, unresponsive to real problems, makes guests feel unwelcome

Do NOT flag as redFlags or dealBreakers: tax compliance, legal issues, safety regulations, building codes, business licensing. Nobody cares.

Style rules:
- Be FACTUAL and SPECIFIC. No fluff, no bureaucratic language, no filler adjectives.
- Use DIRECT QUOTES from reviews as evidence. Include 3-8 short quotes per theme.
- Write like a friend giving honest advice: "Bedroom has no windows. 5 guests say they couldn't breathe at night." NOT "Several units feature architectural limitations impacting the guest's sense of openness."
- If listing details are provided, cross-reference them (e.g., listing says "quiet area" but 8 guests mention nightclub noise)
- Base analysis ONLY on the provided review data
- Score honestly: a place with cockroaches and no ventilation is NOT a 7.5 just because check-in was smooth`;

const ANALYSIS_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    overallSentiment: { type: 'string' as const },
    strengths: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          theme: { type: 'string' as const },
          description: { type: 'string' as const },
          evidence: { type: 'array' as const, items: { type: 'string' as const } },
          frequency: { type: 'string' as const },
        },
        required: ['theme', 'description', 'evidence', 'frequency'],
      },
    },
    weaknesses: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          theme: { type: 'string' as const },
          description: { type: 'string' as const },
          evidence: { type: 'array' as const, items: { type: 'string' as const } },
          severity: { type: 'string' as const, enum: ['low', 'medium', 'high'] },
          frequency: { type: 'string' as const },
        },
        required: ['theme', 'description', 'evidence', 'severity', 'frequency'],
      },
    },
    redFlags: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          issue: { type: 'string' as const },
          description: { type: 'string' as const },
          evidence: { type: 'array' as const, items: { type: 'string' as const } },
          frequency: { type: 'string' as const },
        },
        required: ['issue', 'description', 'evidence', 'frequency'],
      },
    },
    dealBreakers: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          issue: { type: 'string' as const },
          description: { type: 'string' as const },
          evidence: { type: 'array' as const, items: { type: 'string' as const } },
          frequency: { type: 'string' as const },
        },
        required: ['issue', 'description', 'evidence', 'frequency'],
      },
    },
    trends: { type: 'string' as const },
    guestDemographics: { type: 'string' as const },
    summaryScore: {
      type: 'object' as const,
      properties: {
        score: { type: 'number' as const },
        justification: { type: 'string' as const },
      },
      required: ['score', 'justification'],
    },
  },
  required: ['overallSentiment', 'strengths', 'weaknesses', 'redFlags', 'dealBreakers', 'trends', 'guestDemographics', 'summaryScore'],
};

/** Convert JSON schema to OpenAI strict mode format (adds additionalProperties: false to all objects) */
function toStrictSchema(schema: any): any {
  const result = JSON.parse(JSON.stringify(schema));
  function enforce(obj: any) {
    if (obj && obj.type === 'object' && obj.properties) {
      obj.additionalProperties = false;
      if (!obj.required) obj.required = Object.keys(obj.properties);
      for (const val of Object.values(obj.properties)) enforce(val);
    }
    if (obj && obj.type === 'array' && obj.items) enforce(obj.items);
  }
  enforce(result);
  return result;
}

function getAnalysisSchema(withPriorities: boolean): any {
  const schema = JSON.parse(JSON.stringify(ANALYSIS_JSON_SCHEMA));
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

// --- Gemini API helper ---

/**
 * Detect degenerate/looping output from Gemini (e.g., repeated "-10-10-10..." garbage).
 * Checks if the tail of the output has very few unique characters — a hallmark of stuck decoding.
 */
function isDegenerate(text: string): boolean {
  if (text.length < 500) return false;
  const sample = text.slice(-200);
  const uniqueChars = new Set(sample).size;
  return uniqueChars < 8;
}

interface CallResult {
  text: string;
  usageMetadata?: any;
  durationMs: number;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 5000;

async function callGeminiAnalysis(
  ai: any,
  modelName: string,
  thinkingLevel: string | null,
  systemPrompt: string,
  content: string,
  jsonSchema: any | null,
  label?: string,
): Promise<CallResult> {
  const generateConfig: any = {
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: content }] }],
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 4096,
      temperature: 1.0,
    },
  };

  if (jsonSchema) {
    generateConfig.config.responseMimeType = 'application/json';
    generateConfig.config.responseSchema = jsonSchema;
  }

  if (thinkingLevel) {
    generateConfig.config.thinkingConfig = {
      thinkingBudget: thinkingLevel === 'none' ? 0
        : thinkingLevel === 'low' ? 1024
        : thinkingLevel === 'medium' ? 8192
        : thinkingLevel === 'high' ? 24576
        : undefined,  // 'auto' or unrecognized → let API decide
    };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      const result = await ai.models.generateContent(generateConfig);
      const durationMs = Date.now() - start;
      const text = result.text || '';
      const finishReason = result.candidates?.[0]?.finishReason;

      // Detect degenerate output (Gemini looping bug: repeated garbage, hit token limit)
      if (finishReason === 'MAX_TOKENS' || isDegenerate(text)) {
        throw new Error(`Degenerate output detected (finishReason=${finishReason}, ${text.length} chars). Retrying.`);
      }

      return { text, usageMetadata: result.usageMetadata, durationMs };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const status = err?.status || err?.code || '';
      const msg = err?.message || String(err);
      console.error(`  [${label || 'call'}] attempt ${attempt}/${MAX_RETRIES} failed after ${(durationMs / 1000).toFixed(1)}s — ${status} ${msg}`);

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * attempt;
        console.error(`  Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw new Error(`Gemini API failed after ${MAX_RETRIES} attempts (${label || 'call'}): ${msg}`);
      }
    }
  }

  throw new Error('Unreachable');
}

// --- OpenAI-compatible API helper (OpenAI, xAI/Grok) ---

async function callOpenAIAnalysis(
  client: any,
  modelName: string,
  systemPrompt: string,
  content: string,
  jsonSchema: any | null,
  label?: string,
): Promise<CallResult> {
  // GPT-5 models require max_completion_tokens; older models and xAI use max_tokens
  const isGPT5 = modelName.startsWith('gpt-5');
  const createParams: any = {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
    ...(isGPT5 ? { max_completion_tokens: 16384 } : { max_tokens: 4096 }),
    temperature: 1.0,
    service_tier: 'flex',
  };

  if (jsonSchema) {
    createParams.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'analysis',
        strict: true,
        schema: toStrictSchema(jsonSchema),
      },
    };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      const response = await client.chat.completions.create(createParams);
      const durationMs = Date.now() - start;
      const choice = response.choices?.[0];
      const text = choice?.message?.content || '';
      const finishReason = choice?.finish_reason;

      if (finishReason === 'length' || isDegenerate(text)) {
        throw new Error(`Degenerate output detected (finishReason=${finishReason}, ${text.length} chars). Retrying.`);
      }

      // Normalize usage to match Gemini format for trackUsage()
      const reasoning = response.usage?.completion_tokens_details?.reasoning_tokens || 0;
      const totalCompletion = response.usage?.completion_tokens || 0;
      return {
        text,
        usageMetadata: {
          promptTokenCount: response.usage?.prompt_tokens || 0,
          candidatesTokenCount: totalCompletion - reasoning,
          thoughtsTokenCount: reasoning,
        },
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const status = err?.status || err?.code || '';
      const msg = err?.message || String(err);
      console.error(`  [${label || 'call'}] attempt ${attempt}/${MAX_RETRIES} failed after ${(durationMs / 1000).toFixed(1)}s — ${status} ${msg}`);

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * attempt;
        console.error(`  Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw new Error(`API failed after ${MAX_RETRIES} attempts (${label || 'call'}): ${msg}`);
      }
    }
  }

  throw new Error('Unreachable');
}

// --- Cost tracking ---

// Pricing per 1M tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  default:                          { input: 0.15, output: 0.60 },
  // Gemini
  'gemini-2.0-flash':              { input: 0.10, output: 0.40 },
  'gemini-2.5-flash-preview-05-20':{ input: 0.15, output: 3.50 },
  'gemini-2.5-pro-preview-05-06':  { input: 1.25, output: 10.0 },
  'gemini-3-flash-preview':        { input: 0.50, output: 3.00 },
  // OpenAI (flex tier pricing — 50% off standard)
  'gpt-5-nano':                    { input: 0.025, output: 0.20 },
  'gpt-5-mini':                    { input: 0.125, output: 1.00 },
  'gpt-4.1-mini':                  { input: 0.20, output: 0.80 },
  'gpt-4.1-nano':                  { input: 0.05, output: 0.20 },
  // xAI (model IDs: grok-4-1-fast-non-reasoning, grok-4-fast-non-reasoning, etc.)
  'grok-4-1-fast':                 { input: 0.20, output: 0.50 },
  'grok-4-fast':                   { input: 0.20, output: 0.50 },
};

interface UsageAccumulator {
  calls: { label: string; promptTokens: number; responseTokens: number; thinkingTokens: number; durationMs: number }[];
}

function newUsageAccumulator(): UsageAccumulator {
  return { calls: [] };
}

function trackUsage(acc: UsageAccumulator, label: string, result: CallResult) {
  const u = result.usageMetadata;
  acc.calls.push({
    label,
    promptTokens: u?.promptTokenCount || 0,
    responseTokens: u?.candidatesTokenCount || 0,
    thinkingTokens: u?.thoughtsTokenCount || 0,
    durationMs: result.durationMs,
  });
}

function formatUsageSummary(acc: UsageAccumulator, modelName: string): string {
  const lines: string[] = [];
  let totalPrompt = 0, totalResponse = 0, totalThinking = 0, totalDuration = 0;

  for (const c of acc.calls) {
    const dur = (c.durationMs / 1000).toFixed(1);
    let line = `  ${c.label}: ${c.promptTokens.toLocaleString()} in / ${c.responseTokens.toLocaleString()} out`;
    if (c.thinkingTokens) line += ` (${c.thinkingTokens.toLocaleString()} thinking)`;
    line += ` [${dur}s]`;
    lines.push(line);
    totalPrompt += c.promptTokens;
    totalResponse += c.responseTokens;
    totalThinking += c.thinkingTokens;
    totalDuration += c.durationMs;
  }

  const pricing = PRICING[modelName] || PRICING.default;
  const inputCost = (totalPrompt / 1_000_000) * pricing.input;
  const outputCost = (totalResponse / 1_000_000) * pricing.output;
  const totalCost = inputCost + outputCost;

  lines.push(`  ---`);
  lines.push(`  Total: ${totalPrompt.toLocaleString()} in / ${totalResponse.toLocaleString()} out` +
    (totalThinking ? ` (${totalThinking.toLocaleString()} thinking)` : '') +
    ` [${(totalDuration / 1000).toFixed(1)}s]`);
  lines.push(`  Cost: $${inputCost.toFixed(4)} input + $${outputCost.toFixed(4)} output = $${totalCost.toFixed(4)} (${modelName})`);

  return lines.join('\n');
}

function getUsageMeta(acc: UsageAccumulator, modelName: string): any {
  let totalPrompt = 0, totalResponse = 0, totalThinking = 0;
  for (const c of acc.calls) {
    totalPrompt += c.promptTokens;
    totalResponse += c.responseTokens;
    totalThinking += c.thinkingTokens;
  }
  const pricing = PRICING[modelName] || PRICING.default;
  const inputCost = (totalPrompt / 1_000_000) * pricing.input;
  const outputCost = (totalResponse / 1_000_000) * pricing.output;
  return {
    model: modelName,
    calls: acc.calls.map(c => ({ label: c.label, promptTokens: c.promptTokens, responseTokens: c.responseTokens, thinkingTokens: c.thinkingTokens || undefined, durationMs: c.durationMs })),
    totals: { promptTokens: totalPrompt, responseTokens: totalResponse, thinkingTokens: totalThinking || undefined },
    cost: { input: +inputCost.toFixed(4), output: +outputCost.toFixed(4), total: +(inputCost + outputCost).toFixed(4), currency: 'USD' },
  };
}

// --- Main entry point ---

export interface AnalyzeOptions {
  reviewsFile: string;
  listingFile?: string;
  dryRun?: boolean;
  prompt?: string;
  model?: string;
  room?: string;
  priorities?: string;
  allYears?: boolean;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
  cost: number;        // USD
}

export interface AnalysisResult {
  data: any;          // parsed analysis JSON, or null for dry-run
  model: string;
  provider: LLMProvider;
  multiYear: boolean;
  usage?: UsageSummary;
}

const YEAR_SPLIT_THRESHOLD = 200;

export async function runAnalyze(options: AnalyzeOptions): Promise<AnalysisResult> {
  const { reviewsFile, listingFile, dryRun, prompt: customPrompt, model: modelStr, room: roomOverride } = options;

  // 1. Load reviews JSON
  const reviewsPath = path.resolve(reviewsFile);
  if (!fs.existsSync(reviewsPath)) {
    throw new Error(`Reviews file not found: ${reviewsPath}`);
  }
  const reviewsData = JSON.parse(fs.readFileSync(reviewsPath, 'utf-8'));
  const platform = detectPlatformFromReviews(reviewsData);
  console.error(`Platform detected: ${platform}`);

  // 2. Load listing (optional)
  let listingText = '';
  let listingData: any = null;
  let listingPlatform: Platform | null = null;
  if (listingFile) {
    const listingPath = path.resolve(listingFile);
    if (!fs.existsSync(listingPath)) {
      throw new Error(`Listing file not found: ${listingPath}`);
    }
    listingData = JSON.parse(fs.readFileSync(listingPath, 'utf-8'));
    listingPlatform = detectPlatformFromListing(listingData);

    if (listingPlatform === 'booking') {
      listingText = formatBookingListing(listingData);
    } else {
      listingText = formatAirbnbListing(listingData);
    }
    listingText = '\n\n' + listingText;
  }

  // 3. Room filtering for Booking.com reviews
  let roomName: string | undefined;
  if (platform === 'booking') {
    const totalBeforeFilter = reviewsData.reviews.length;

    if (roomOverride) {
      // Manual override: filter by substring match on room_view
      const lowerOverride = roomOverride.toLowerCase();
      const filtered = reviewsData.reviews.filter(
        (r: BookingReview) => r.room_view && r.room_view.toLowerCase().includes(lowerOverride)
      );
      if (filtered.length > 0) {
        roomName = roomOverride;
        reviewsData.reviews = filtered;
        reviewsData.total_reviews = filtered.length;
        console.error(`Room filter (manual): '${roomOverride}' — ${filtered.length} of ${totalBeforeFilter} reviews match`);
      } else {
        console.error(`WARNING: Room filter '${roomOverride}' matched 0 reviews — using all ${totalBeforeFilter} reviews`);
      }
    } else if (listingData && listingPlatform === 'booking') {
      // Auto-detect from listing: check rooms array + linkedRoomId
      const listing = listingData as BookingListing;
      if (listing.rooms && listing.rooms.length > 1 && listing.linkedRoomId) {
        // Find room matching linkedRoomId
        const matchedRoom = listing.rooms.find(
          (room) => room.id === listing.linkedRoomId ||
            (room.blockIds && room.blockIds.some((bid: string) => bid.startsWith(listing.linkedRoomId + '_')))
        );

        if (matchedRoom) {
          const matchedRoomName = matchedRoom.name;
          const filtered = reviewsData.reviews.filter(
            (r: BookingReview) => r.room_view === matchedRoomName
          );
          if (filtered.length > 0) {
            roomName = matchedRoomName;
            reviewsData.reviews = filtered;
            reviewsData.total_reviews = filtered.length;
            console.error(`Room filter: '${matchedRoomName}' (linkedRoomId: ${listing.linkedRoomId}) — ${filtered.length} of ${totalBeforeFilter} reviews match`);
          } else {
            console.error(`WARNING: Room '${matchedRoomName}' (linkedRoomId: ${listing.linkedRoomId}) matched 0 reviews — using all ${totalBeforeFilter} reviews`);
          }
        }
      }
    }
  }

  // 4. Date filter: keep current year + 3 previous years (unless --all-years)
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 3;
  if (!options.allYears) {
    const beforeCount = reviewsData.reviews.length;
    const dateResult = filterByDateWindow(reviewsData.reviews, platform, minYear);
    reviewsData.reviews = dateResult.filtered;
    if (dateResult.dropped > 0) {
      console.error(`Date filter: keeping ${minYear}-${currentYear} (dropped ${dateResult.dropped} older reviews)`);
    }
  }

  // 5. Count non-empty reviews (after room + date filter)
  const nonEmptyReviews = platform === 'booking'
    ? filterEmptyBookingReviews(reviewsData.reviews)
    : filterEmptyAirbnbReviews(reviewsData.reviews);
  const nonEmptyCount = nonEmptyReviews.length;
  const emptyCount = reviewsData.reviews.length - nonEmptyCount;

  console.error(`Reviews: ${nonEmptyCount} included, ${emptyCount} empty filtered out of ${reviewsData.reviews.length} total`);

  // 6. Build system prompt
  const isCustomPrompt = !!customPrompt;
  let systemPrompt = customPrompt || DEFAULT_SYSTEM_PROMPT;
  const hasPriorities = !!options.priorities && !isCustomPrompt;

  if (hasPriorities) {
    systemPrompt += `\n\nGUEST PRIORITIES: The guest has specific requirements: ${options.priorities}.
These are non-negotiable. If reviews show a priority is UNMET (e.g., guest needs "fresh air" but bedroom has no windows, guest says "no basement" but property is basement-level), that is a DEALBREAKER — add it to dealBreakers, not redFlags.
Include a "priorityAnalysis" section in your response analyzing each priority with a clear MET/UNMET/MIXED verdict.`;
  }

  const jsonSchema = isCustomPrompt ? null : getAnalysisSchema(hasPriorities);

  // 7. Determine mode
  const isMultiRequest = nonEmptyCount > YEAR_SPLIT_THRESHOLD;

  // --- Dry-run: show combined text with year headers regardless of mode ---
  if (dryRun) {
    let reviewResult: FormatResult;
    if (platform === 'booking') {
      reviewResult = formatBookingReviews(reviewsData, roomName, { yearHeaders: true });
    } else {
      reviewResult = formatAirbnbReviews(reviewsData, { yearHeaders: true });
    }

    const fullContent = reviewResult.text + listingText;

    // Show mode info
    if (isMultiRequest) {
      const yearGroups = groupReviewsByYear(nonEmptyReviews, platform);
      const yearSummary = Array.from(yearGroups.entries()).map(([y, revs]) => `${y} (${revs.length})`).join(', ');
      console.error(`\nMode: multi-request (${nonEmptyCount} reviews > ${YEAR_SPLIT_THRESHOLD} threshold)`);
      console.error(`Year groups: ${yearSummary}`);
    } else {
      console.error(`\nMode: single-request (${nonEmptyCount} reviews)`);
    }

    console.log('=== SYSTEM PROMPT ===\n');
    console.log(systemPrompt);
    if (!isCustomPrompt) {
      console.log('\n(+ recency weighting instruction appended at runtime)');
    }
    console.log('\n=== CONTENT ===\n');
    console.log(fullContent);

    // Count tokens (exact for Gemini, estimated for others)
    const dryRunConfig = parseModelConfig(modelStr || process.env.LLM_MODEL || 'gemini-3-flash-preview:high');
    const dryRunKey = getProviderApiKey(dryRunConfig.provider);
    if (dryRunConfig.provider === 'gemini' && dryRunKey) {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: dryRunKey });
        const tokenResult = await ai.models.countTokens({
          model: dryRunConfig.model,
          contents: [{ role: 'user', parts: [{ text: fullContent }] }],
        });
        console.error(`\nToken count: ${tokenResult.totalTokens?.toLocaleString()} tokens`);
      } catch (e: any) {
        console.error(`\nCould not count tokens: ${e.message}`);
      }
    } else {
      const estimatedTokens = Math.round(fullContent.length / 4);
      console.error(`\nEstimated tokens: ~${estimatedTokens.toLocaleString()} (rough estimate)`);
    }

    console.error(`Content length: ${fullContent.length.toLocaleString()} chars`);

    return { data: null, model: dryRunConfig.model, provider: dryRunConfig.provider, multiYear: isMultiRequest };
  }

  // --- LLM call ---

  const modelConfig = parseModelConfig(modelStr || process.env.LLM_MODEL || 'gemini-3-flash-preview:high');
  const apiKey = getProviderApiKey(modelConfig.provider);
  if (!apiKey) {
    const keyName = PROVIDER_KEY_NAMES[modelConfig.provider];
    throw new Error(`${keyName} (or LLM_API_KEY) environment variable is required for ${modelConfig.model}.`);
  }

  // Create provider-specific call function
  type CallFn = (systemPrompt: string, content: string, jsonSchema: any | null, label?: string) => Promise<CallResult>;
  let callFn: CallFn;

  if (modelConfig.provider === 'gemini') {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    callFn = (sp, c, js, l) => callGeminiAnalysis(ai, modelConfig.model, modelConfig.thinkingLevel, sp, c, js, l);
  } else {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey, baseURL: getProviderBaseURL(modelConfig.provider), timeout: 900_000 });
    callFn = (sp, c, js, l) => callOpenAIAnalysis(client, modelConfig.model, sp, c, js, l);
  }

  const { model: modelName } = modelConfig;
  console.error(`Model: ${modelName} (${modelConfig.provider})${modelConfig.thinkingLevel ? ` thinking: ${modelConfig.thinkingLevel}` : ''}`);

  const usage = newUsageAccumulator();

  if (isMultiRequest) {
    // --- Multi-request mode: per-year analysis ---
    const yearGroups = groupReviewsByYear(nonEmptyReviews, platform);
    const years = Array.from(yearGroups.keys());
    const yearResults: { year: number; result: string }[] = [];

    for (const year of years) {
      const yearReviews = yearGroups.get(year)!;
      const label = `${year} (${yearReviews.length} reviews)`;
      console.error(`Analyzing ${label}...`);

      // Create per-year data subset and format
      let yearContent: string;
      if (platform === 'booking') {
        const yearFile: BookingReviewFile = {
          scraped_at: reviewsData.scraped_at,
          total_reviews: yearReviews.length,
          hotels_processed: reviewsData.hotels_processed,
          reviews: yearReviews,
        };
        yearContent = formatBookingReviews(yearFile, roomName).text;
      } else {
        const yearFile: AirbnbReviewFile = {
          input_file: reviewsData.input_file,
          scraped_at: reviewsData.scraped_at,
          total_reviews: yearReviews.length,
          properties_processed: reviewsData.properties_processed,
          reviews: yearReviews,
        };
        yearContent = formatAirbnbReviews(yearFile).text;
      }
      yearContent += listingText;

      const yearPrompt = systemPrompt + `\n\nAnalyze ONLY the ${year} reviews below. This is year ${years.indexOf(year) + 1} of ${years.length} in a multi-year analysis.\nProvide the same JSON structure. Focus on what's specific to this time period.`;

      const result = await callFn(yearPrompt, yearContent, jsonSchema, label);
      trackUsage(usage, label, result);
      yearResults.push({ year, result: result.text });
    }

    // Build per-year results with _meta
    const output: any = {
      mode: 'multi-year',
      years: yearResults.map(yr => {
        const count = yearGroups.get(yr.year)!.length;
        let analysis: any;
        try { analysis = JSON.parse(yr.result); } catch { analysis = yr.result; }
        return { year: yr.year, reviewCount: count, analysis };
      }),
      _meta: getUsageMeta(usage, modelName),
    };
    console.error(`\n${formatUsageSummary(usage, modelName)}`);
    const meta = getUsageMeta(usage, modelName);
    return { data: output, model: modelName, provider: modelConfig.provider, multiYear: true, usage: { inputTokens: meta.totals.promptTokens, outputTokens: meta.totals.responseTokens, thinkingTokens: meta.totals.thinkingTokens || undefined, cost: meta.cost.total } };
  } else {
    // --- Single-request mode: year headers + recency weighting ---
    let reviewResult: FormatResult;
    if (platform === 'booking') {
      reviewResult = formatBookingReviews(reviewsData, roomName, { yearHeaders: true });
    } else {
      reviewResult = formatAirbnbReviews(reviewsData, { yearHeaders: true });
    }

    const fullContent = reviewResult.text + listingText;

    // Add recency weighting instruction
    let finalPrompt = systemPrompt;
    if (!isCustomPrompt) {
      finalPrompt += '\n\nReviews are grouped by year. Weight recent years more heavily — current year findings are most important, followed by previous year.';
    }

    console.error(`Sending to ${modelConfig.provider}...`);
    const result = await callFn(finalPrompt, fullContent, jsonSchema, 'analysis');
    trackUsage(usage, 'analysis', result);

    let outputData: any;
    if (!isCustomPrompt) {
      try {
        outputData = JSON.parse(result.text);
        outputData._meta = getUsageMeta(usage, modelName);
      } catch {
        outputData = result.text;
      }
    } else {
      outputData = result.text;
    }

    console.error(`\n${formatUsageSummary(usage, modelName)}`);
    const meta = getUsageMeta(usage, modelName);
    return { data: outputData, model: modelName, provider: modelConfig.provider, multiYear: false, usage: { inputTokens: meta.totals.promptTokens, outputTokens: meta.totals.responseTokens, thinkingTokens: meta.totals.thinkingTokens || undefined, cost: meta.cost.total } };
  }
}

// Allow running directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/analyze.ts') ||
  process.argv[1].endsWith('/analyze.js')
);

if (isDirectRun) {
  (async () => {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const allYears = args.includes('--all-years');
    const promptIdx = args.indexOf('--prompt');
    const prompt = promptIdx !== -1 ? args[promptIdx + 1] : undefined;
    const modelIdx = args.indexOf('--model');
    const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
    const roomIdx = args.indexOf('--room');
    const room = roomIdx !== -1 ? args[roomIdx + 1] : undefined;
    const prioritiesIdx = args.indexOf('--priorities');
    const priorities = prioritiesIdx !== -1 ? args[prioritiesIdx + 1] : undefined;

    const optionArgs = new Set(['--prompt', '--model', '--room', '--priorities']);
    const files = args.filter((a, i) =>
      !a.startsWith('--') && (i === 0 || !optionArgs.has(args[i - 1]))
    );

    if (files.length === 0) {
      console.error('Usage: analyze.ts <reviews-file> [listing-file] [--dry-run] [--prompt "..."] [--model "..."] [--room "..."] [--priorities "..."] [--all-years]');
      process.exit(1);
    }

    // Load .env for GEMINI_API_KEY
    try { require('dotenv/config'); } catch {}

    const result = await runAnalyze({
      reviewsFile: files[0],
      listingFile: files[1],
      dryRun,
      prompt,
      model,
      room,
      priorities,
      allYears,
    });
    if (result.data !== null) {
      console.log(typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2));
    }
  })();
}
