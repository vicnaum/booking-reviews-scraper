// src/booking/search.ts
//
// Booking.com listing search.
//
// How it works (Nov 2026):
// 1. Launch a proxied Playwright browser (fails closed without a proxy unless USE_PROXY=false
//    was chosen explicitly) with `--disable-blink-features=AutomationControlled`. Without
//    that flag `navigator.webdriver` is true and booking.com 30x-redirects every
//    city/district searchresults URL to its SEO landing page (/city/pl/gdansk.html).
// 2. Warm the session on the homepage, resolve `--location` to a Booking destination
//    (dest_id + dest_type) through Booking's own AutoComplete GraphQL, then open the real
//    searchresults page for that destination (or a lat/long page for bbox searches).
// 3. Scroll the result list so booking.com's own client fires `FullSearch`, capture that
//    request (headers, URL and body — the body now carries the full query text; the old
//    persisted-query hashes return `PersistedQueryNotFound`) and cache it on disk.
// 4. Replay FullSearch from inside the page (same cookies, WAF token and exit IP) with our
//    own location / dates / filters and offset pagination (100 rows per page). FullSearch
//    accepts `destType: BOUNDING_BOX`, so map-area searches use the same operation.
// Fallback when no FullSearch template is available: harvest the server-rendered result
// pages (`&offset=N`) of the same searchresults URL.

import { createBookingSearchLogger, type BookingSearchLogger } from './search-log.js';
import { parseBookingGraphQLPricing } from './pricing.js';
import {
  forgetFullSearchTemplate,
  getCachedAutoCompleteTemplate,
  getCachedFullSearchTemplate,
  saveAutoCompleteTemplate,
  isStaleQueryError,
  isUsableFullSearchTemplate,
  saveFullSearchTemplate,
  type FullSearchTemplate,
} from './search-template.js';
import {
  countNewChildIds,
  hasMeaningfulChildGain,
  shouldRecurseIntoChildren,
  shouldProbeChildren,
  type AdaptiveSubdivisionConfig,
} from '../search/adaptive.js';
import { bboxIntersectsCircle, geocodeLocation, subdivideBbox } from '../search/geo.js';
import { filterSearchResults } from '../search/filters.js';
import { buildPlaywrightLaunchOptionsFromEnv } from '../config.js';
import { getStayNights } from '../search/pricing.js';
import type {
  BookingSearchParams,
  SearchResult,
  SearchPage,
  BoundingBox,
  ProgressCallback,
} from '../search/types.js';

const ROWS_PER_PAGE = 100;
// Booking stops returning rows past ~1000 results for one query.
const MAX_OFFSET = 1000;
// Optional politeness override: BOOKING_SEARCH_DELAY_MS=<ms> adds that base delay (+ up to 100% jitter).
const PAGE_DELAY_MS = 600;
const CELL_DELAY_MS = 800;
const MAX_SESSION_ATTEMPTS = 3;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

function politeDelay(baseMs: number): number {
  const extra = Number(process.env.BOOKING_SEARCH_DELAY_MS || 0);
  const base = baseMs * (1 + Math.random() * 0.5);
  return extra > 0 ? base + extra * (1 + Math.random()) : base;
}

const BOOKING_SUBDIVISION_CONFIG: AdaptiveSubdivisionConfig = {
  forceProbeDepth: 1,
  maxDepth: 3,
  minCellSideMeters: 900,
  minResultsToProbe: 10,
  minNewIds: 2,
  minGainRatio: 0.05,
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function getMatchingUnitConfigurations(result: any): any[] {
  const matching = result?.matchingUnitConfigurations;
  if (!matching || typeof matching !== 'object') {
    return [];
  }

  const configurations: any[] = [];
  if (matching.commonConfiguration) {
    configurations.push(matching.commonConfiguration);
  }
  if (Array.isArray(matching.unitConfigurations)) {
    configurations.push(...matching.unitConfigurations);
  }

  return configurations;
}

// --- Destinations ---

export interface BookingDestination {
  destId: string;
  /** Booking dest type, upper case as used by GraphQL (CITY, DISTRICT, REGION, LANDMARK, ...) */
  destType: string;
  label: string;
  latitude?: number;
  longitude?: number;
}

interface AutoCompleteSuggestion extends BookingDestination {
  title: string;
  components: Array<{ name: string; type: string }>;
}

function normalizeForMatch(value: string): string {
  return value
    .replace(/[łŁ]/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeForMatch(value).split(/[^a-z0-9]+/).filter(token => token.length >= 2);
}

/**
 * Pick the AutoComplete suggestion that matches every word of the query.
 * Words are matched against the suggestion's own name and its city/country (not the
 * region: "Śródmieście, Gdynia, Pomerania (Gulf of Gdansk)" must not match "Gdańsk Śródmieście").
 * Hotels are never picked. Returns null when Booking has no such destination.
 */
export function pickAutocompleteDestination(
  query: string,
  suggestions: AutoCompleteSuggestion[],
): BookingDestination | null {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return null;

  for (const suggestion of suggestions) {
    if (!suggestion.destId || ['HOTEL', 'NO_DEST_TYPE', ''].includes(suggestion.destType)) continue;
    const matchText = [
      suggestion.title,
      ...suggestion.components.filter(c => c.type !== 'REGION').map(c => c.name),
    ].join(' ');
    const words = tokenize(matchText);
    const allMatch = queryTokens.every(token => words.some(word => word.startsWith(token)));
    if (allMatch) {
      return {
        destId: suggestion.destId,
        destType: suggestion.destType,
        label: suggestion.label,
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
      };
    }
  }

  return null;
}

function parseAutocompleteResponse(payload: any): AutoCompleteSuggestion[] {
  const results = payload?.data?.autoCompleteSuggestions?.results;
  if (!Array.isArray(results)) return [];
  return results.map((r: any) => ({
    destId: String(r?.destination?.destId ?? ''),
    destType: String(r?.destination?.destType ?? '').toUpperCase(),
    label: String(r?.displayInfo?.label ?? r?.displayInfo?.title ?? ''),
    title: String(r?.displayInfo?.title ?? ''),
    latitude: toFiniteNumber(r?.destination?.latitude) ?? undefined,
    longitude: toFiniteNumber(r?.destination?.longitude) ?? undefined,
    components: Array.isArray(r?.displayInfo?.labelComponents)
      ? r.displayInfo.labelComponents.map((c: any) => ({ name: String(c?.name ?? ''), type: String(c?.type ?? '') }))
      : [],
  }));
}

// --- URLs and filters ---

type SearchTarget =
  | { kind: 'destination'; destination: BookingDestination }
  | { kind: 'bbox'; bbox: BoundingBox };

/** Grow a (point-like) bbox to at least `minMeters` per side around its centre. */
export function ensureMinBbox(bbox: BoundingBox, minMeters: number): BoundingBox {
  const center = bboxCenter(bbox);
  const halfLat = minMeters / 111320 / 2;
  const halfLng = minMeters / (111320 * Math.cos((center.lat * Math.PI) / 180)) / 2;
  return {
    neLat: Math.max(bbox.neLat, center.lat + halfLat),
    neLng: Math.max(bbox.neLng, center.lng + halfLng),
    swLat: Math.min(bbox.swLat, center.lat - halfLat),
    swLng: Math.min(bbox.swLng, center.lng - halfLng),
  };
}

function bboxCenter(bbox: BoundingBox): { lat: number; lng: number } {
  return { lat: (bbox.neLat + bbox.swLat) / 2, lng: (bbox.neLng + bbox.swLng) / 2 };
}

export function buildSearchUrl(params: BookingSearchParams, target: SearchTarget): string {
  const url = new URL('https://www.booking.com/searchresults.en-gb.html');

  if (target.kind === 'destination') {
    url.searchParams.set('ss', target.destination.label || target.destination.destId);
    url.searchParams.set('dest_id', target.destination.destId);
    url.searchParams.set('dest_type', target.destination.destType.toLowerCase());
  } else {
    const center = bboxCenter(target.bbox);
    const lat = center.lat.toFixed(5);
    const lng = center.lng.toFixed(5);
    url.searchParams.set('ss', `${lat},${lng}`);
    url.searchParams.set('dest_type', 'latlong');
    url.searchParams.set('latitude', lat);
    url.searchParams.set('longitude', lng);
  }

  if (params.checkin) url.searchParams.set('checkin', params.checkin);
  if (params.checkout) url.searchParams.set('checkout', params.checkout);
  url.searchParams.set('group_adults', String(params.adults));
  url.searchParams.set('no_rooms', '1');
  url.searchParams.set('group_children', '0');
  url.searchParams.set('selected_currency', params.currency);

  const filters = buildFilterString(params);
  if (filters) url.searchParams.set('nflt', filters);

  return url.toString();
}

export function buildFilterString(params: BookingSearchParams): string {
  const parts: string[] = ['oos=1']; // Only available properties

  if (params.minRating) {
    // Convert 0-10 to Booking's scale: 90=9+, 80=8+, 70=7+, 60=6+
    const score = Math.floor(params.minRating) * 10;
    if (score >= 60) parts.push(`review_score=${score}`);
  }

  if (params.propertyType) {
    const typeMap: Record<string, string> = {
      entire: 'privacy_type=3',     // Entire place
      private: 'privacy_type=1',    // Private room
      hotel: 'ht_id=204',           // Hotels
    };
    const mapped = typeMap[params.propertyType];
    if (mapped) parts.push(mapped);
  }

  if (
    params.minBedrooms != null
    && params.minBedrooms > 0
    && params.propertyType !== 'private'
    && params.propertyType !== 'hotel'
  ) {
    if (!parts.includes('privacy_type=3')) {
      parts.push('privacy_type=3');
    }
    parts.push(`entire_place_bedroom_count=${Math.max(1, Math.floor(params.minBedrooms))}`);
  }

  if (params.stars?.length) {
    for (const star of params.stars) {
      parts.push(`class=${star}`);
    }
  }

  if (params.freeCancellation) parts.push('fc=2');

  if (params.priceMin != null || params.priceMax != null) {
    const min = params.priceMin ?? 'min';
    const max = params.priceMax ?? 'max';
    parts.push(`price=${params.currency}-${min}-${max}-1`);
  }

  return parts.join(';');
}

// --- GraphQL request builder ---

function randomRequestId(): string {
  let id = '';
  while (id.length < 32) id += Math.random().toString(16).slice(2);
  return id.slice(0, 32);
}

/**
 * Build a FullSearch body from a template captured from booking.com's own page
 * (keeps its query text / extensions), overriding location, dates, guests, filters, paging.
 */
export function buildFullSearchBody(
  template: FullSearchTemplate,
  params: BookingSearchParams,
  target: SearchTarget,
  offset: number,
  rowsPerPage: number = ROWS_PER_PAGE,
  sessionSearchUrl?: string,
): any {
  const body = JSON.parse(JSON.stringify(template));
  const input = body.variables.input;
  const checkin = params.checkin || '';
  const checkout = params.checkout || '';

  input.dates = { checkin, checkout };
  if (input.flexibleDatesConfig?.dateRangeCalendar) {
    input.flexibleDatesConfig.dateRangeCalendar = {
      ...input.flexibleDatesConfig.dateRangeCalendar,
      checkin: checkin ? [checkin] : [],
      checkout: checkout ? [checkout] : [],
    };
  }
  input.nbRooms = 1;
  input.nbAdults = params.adults;
  input.nbChildren = 0;
  input.childrenAges = [];
  input.filters = { selectedFilters: buildFilterString(params) };
  input.pagination = { rowsPerPage, offset };
  input.clientSideRequestId = randomRequestId();
  // The server reads session search params from this (useSearchParamsFromSession); keep it on
  // the searchresults URL this session opened, not the one the template was captured on.
  const sessionUrl = new URL(sessionSearchUrl || buildSearchUrl(params, target));
  input.rawQueryForSession = `${sessionUrl.pathname}${sessionUrl.search}`;
  // Booking's default ("popularity") ranking reshuffles between requests, so offset pages
  // overlap (~25% duplicates, missing properties). Sorting by price keeps pages stable;
  // it is used whenever more than one page is wanted. BOOKING_SEARCH_SORTER overrides
  // (e.g. `popularity`, `distance`, `review_score_and_price`; empty = Booking default).
  const sorter = process.env.BOOKING_SEARCH_SORTER !== undefined
    ? process.env.BOOKING_SEARCH_SORTER
    : (!params.maxResults || params.maxResults > rowsPerPage ? 'price' : '');
  if (sorter) {
    input.sorters = { ...(input.sorters || {}), selectedSorter: sorter };
  }

  const templateLocation = input.location || {};
  if (target.kind === 'destination') {
    input.location = {
      searchString: target.destination.label,
      destType: target.destination.destType.toUpperCase(),
      destId: Number(target.destination.destId),
    };
  } else {
    const location: Record<string, unknown> = {
      destType: 'BOUNDING_BOX',
      boundingBox: {
        neLat: target.bbox.neLat,
        neLon: target.bbox.neLng,
        swLat: target.bbox.swLat,
        swLon: target.bbox.swLng,
        precision: 1,
      },
    };
    if (templateLocation.destId != null && templateLocation.destType && !['BOUNDING_BOX', 'LATLONG'].includes(templateLocation.destType)) {
      location.initialDestination = { destType: templateLocation.destType, destId: templateLocation.destId };
    }
    input.location = location;
  }

  return body;
}

// --- Live browser session ---

class BookingSessionError extends Error {}

interface LiveSession {
  browser: any;
  page: any;
  searchUrl: string;
  graphqlUrl: string;
  headers: Record<string, string>;
  template: FullSearchTemplate | null;
  templateSource: 'live' | 'cache' | null;
  close(): Promise<void>;
}

/** Sticky exit IP per browser session: Evomi password syntax, so only for Evomi or when forced. */
function useStickyProxySession(): boolean {
  if (process.env.PROXY_STICKY_SESSION === 'false') return false;
  return process.env.PROXY_STICKY_SESSION === 'true' || /evomi/i.test(process.env.PROXY_HOST || '');
}

function hasProxyConfigured(): boolean {
  return process.env.USE_PROXY !== 'false' && !!process.env.PROXY_HOST;
}

/**
 * Booking search runs through the proxy only. Searching from this machine's IP needs an
 * explicit opt-out: the CLI's --no-proxy (sets REVIEWR_NO_PROXY) or BOOKING_ALLOW_NO_PROXY=true.
 * (USE_PROXY=false alone is not enough: the CLI also sets it when no proxy is configured.)
 */
export function assertProxyPolicy(env: NodeJS.ProcessEnv = process.env): void {
  if (env.USE_PROXY !== 'false' && env.PROXY_HOST) return;
  if (env.REVIEWR_NO_PROXY === 'true' || env.BOOKING_ALLOW_NO_PROXY === 'true') {
    console.log('⚠️  Booking search without proxy: requests leave from this machine\'s IP.');
    return;
  }
  throw new Error(
    'Booking search needs a proxy (PROXY_* in .env, ~/.config/reviewr/.env or --proxy). '
    + 'Pass --no-proxy (or set BOOKING_ALLOW_NO_PROXY=true) to search from this machine\'s IP on purpose.',
  );
}

function pickGraphqlHeaders(headers: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    if (key === 'content-type' || key.startsWith('x-booking-') || key.startsWith('apollographql-')) {
      picked[key] = value;
    }
  }
  picked['content-type'] = 'application/json';
  return picked;
}

function buildGraphqlUrl(searchUrl: string): string {
  const source = new URL(searchUrl);
  const url = new URL('https://www.booking.com/dml/graphql');
  for (const [key, value] of source.searchParams.entries()) url.searchParams.set(key, value);
  url.searchParams.set('lang', 'en-gb');
  return url.toString();
}

async function pageFetchJson(page: any, url: string, headers: Record<string, string>, body: any): Promise<{ status: number; json: any; text: string }> {
  const result = await page.evaluate(async ({ url, headers, body }: any) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        credentials: 'include',
        signal: controller.signal,
      });
      return { status: response.status, text: await response.text() };
    } catch (error: any) {
      return { status: 0, text: String(error?.message || error) };
    } finally {
      clearTimeout(timer);
    }
  }, { url, headers, body });

  let json: any = null;
  try { json = JSON.parse(result.text); } catch { /* not JSON */ }
  return { status: result.status, json, text: result.text };
}

async function waitOutWafChallenge(page: any): Promise<void> {
  const html = await page.content().catch(() => '');
  if (html.includes('awsWafCookieDomainList') || html.includes('challenge.js')) {
    console.log('  WAF challenge detected, waiting...');
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(6000);
  }
}

async function resolveDestinationViaAutocomplete(
  page: any,
  query: string,
  pageHeaders: () => Record<string, string>,
  logger?: BookingSearchLogger,
): Promise<BookingDestination | null> {
  let captured: { body: any; headers: Record<string, string>; url: string } | null = null;
  const onRequest = (request: any) => {
    if (!request.url().includes('/dml/graphql')) return;
    try {
      const body = JSON.parse(request.postData() || '{}');
      if (body.operationName === 'AutoComplete' && !captured) {
        captured = { body, headers: request.headers(), url: request.url() };
      }
    } catch { /* ignore */ }
  };
  page.on('request', onRequest);

  try {
    // Type the first letters into the homepage search box so booking.com's own client sends
    // AutoComplete (we then replay it with the full query).
    for (let attempt = 0; attempt < 3 && !captured; attempt++) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.evaluate(() => {
        document.querySelectorAll('[data-bui-trap-root], #onetrust-consent-sdk').forEach((el) => el.remove());
      }).catch(() => {});
      const input = page.locator('input[name="ss"]').first();
      await input.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await input.click({ force: true, timeout: 5000 }).catch(() => {});
      await input.fill('').catch(() => {});
      await page.keyboard.type(query.slice(0, 5), { delay: 110 + Math.random() * 60 }).catch(() => {});
      await page.waitForRequest((request: any) => (
        request.url().includes('/dml/graphql') && (request.postData() || '').includes('"AutoComplete"')
      ), { timeout: 6000 + attempt * 3000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  } finally {
    page.off('request', onRequest);
  }

  let source = 'live';
  if (captured) {
    saveAutoCompleteTemplate((captured as any).body);
  } else {
    const cached = getCachedAutoCompleteTemplate();
    const headers = pageHeaders();
    if (cached && headers['x-booking-csrf-token']) {
      captured = { body: cached, headers, url: 'https://www.booking.com/dml/graphql?lang=en-gb' };
      source = 'cache';
    }
  }
  if (!captured) {
    logger?.log('autocomplete_unavailable', { query });
    console.log('  ⚠️  Booking AutoComplete did not fire');
    return null;
  }

  const template = captured as { body: any; headers: Record<string, string>; url: string };
  // AutoComplete ranking is not deterministic (sometimes only hotels come back for
  // "Gdańsk Old Town"), so also try the "Old Town, Gdańsk" word orders.
  for (const variant of autocompleteQueryVariants(query)) {
    const body = JSON.parse(JSON.stringify(template.body));
    body.variables.input.prefixQuery = variant;
    body.variables.input.nbSuggestions = 10;
    const response = await pageFetchJson(page, template.url, pickGraphqlHeaders(template.headers), body);
    const suggestions = parseAutocompleteResponse(response.json);
    const destination = pickAutocompleteDestination(query, suggestions);
    logger?.log('autocomplete_resolved', {
      query,
      variant,
      source,
      status: response.status,
      suggestions: suggestions.map(s => `${s.destType}:${s.destId}:${s.label}`),
      destination: destination ?? null,
    });
    if (destination) return destination;
    await page.waitForTimeout(400 + Math.random() * 400);
  }
  return null;
}

export function autocompleteQueryVariants(query: string): string[] {
  const trimmed = query.trim().replace(/\s+/g, ' ');
  const variants = [trimmed];
  if (!trimmed.includes(',')) {
    const words = trimmed.split(' ');
    if (words.length >= 2) {
      variants.push(`${words.slice(1).join(' ')}, ${words[0]}`);
      variants.push(`${words[words.length - 1]}, ${words.slice(0, -1).join(' ')}`);
    }
  }
  return [...new Set(variants)];
}

async function triggerFullSearchCapture(page: any, isCaptured: () => boolean): Promise<void> {
  for (let i = 0; i < 12 && !isCaptured(); i++) {
    await page.locator('[data-testid="property-card"]').last().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await page.mouse.wheel(0, 1500).catch(() => {});
    await page.waitForTimeout(1500);
    const loadMore = page.locator('button:has-text("Load more results")').first();
    if (!isCaptured() && await loadMore.isVisible().catch(() => false)) {
      await loadMore.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
}

interface OpenSessionResult {
  session: LiveSession;
  destination: BookingDestination | null;
}

/**
 * Open a warmed-up booking.com session on a real searchresults page.
 * `resolveLocation` → resolve params.location through AutoComplete first (returns
 * destination=null when Booking has no matching destination).
 */
async function openSession(
  params: BookingSearchParams,
  initialTarget: SearchTarget | null,
  resolveLocation: string | null,
  logger: BookingSearchLogger,
  resolveFallback?: () => Promise<SearchTarget>,
): Promise<OpenSessionResult> {
  const { chromium } = await import('playwright');
  const proxySession = useStickyProxySession() ? `rv${Math.random().toString(36).slice(2, 10)}` : undefined;
  const launchOptions: Record<string, any> = buildPlaywrightLaunchOptionsFromEnv({ proxySession });
  launchOptions.args = [...(launchOptions.args || []), '--disable-blink-features=AutomationControlled'];

  console.log('🔑 Opening Booking.com browser session...');
  logger.log('bootstrap_started', {
    location: params.location ?? null,
    destId: params.destId ?? null,
    boundingBox: params.boundingBox ?? null,
    filters: buildFilterString(params),
    proxy: hasProxyConfigured(),
    proxyCountry: process.env.PROXY_COUNTRY || null,
  });

  const browser = await chromium.launch(launchOptions);
  const close = async () => { await browser.close().catch(() => {}); };

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: 'en-GB',
      viewport: { width: 1400, height: 1000 },
    });
    await context.route('**/*', (route: any) => (
      ['image', 'media', 'font'].includes(route.request().resourceType())
        ? route.abort()
        : route.continue()
    ));
    const page = await context.newPage();

    // BOOKING_SEARCH_TEMPLATE=cache: use the cached FullSearch template when there is one and
    // skip the live capture (debugging aid for the cache / stale-query refresh path).
    const preferCache = process.env.BOOKING_SEARCH_TEMPLATE === 'cache' && !!getCachedFullSearchTemplate();
    let headers: Record<string, string> = {};
    let homeHeaders: Record<string, string> = {};
    let liveTemplate: any = null;
    let liveGraphqlUrl = '';
    page.on('request', (request: any) => {
      if (!request.url().includes('/dml/graphql')) return;
      const requestHeaders = request.headers();
      if (requestHeaders['x-booking-csrf-token']) homeHeaders = requestHeaders;
      const onSearchPage = page.url().includes('/searchresults');
      if (onSearchPage && requestHeaders['x-booking-csrf-token']) {
        headers = requestHeaders;
      }
      try {
        const body = JSON.parse(request.postData() || '{}');
        if (body.operationName === 'FullSearch' && isUsableFullSearchTemplate(body) && !preferCache) {
          liveTemplate = body;
          liveGraphqlUrl = request.url();
          headers = requestHeaders;
        }
      } catch { /* ignore */ }
    });

    await page.goto('https://www.booking.com/index.en-gb.html', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitOutWafChallenge(page);
    await page.waitForTimeout(3000 + Math.random() * 2000);
    await page.click('#onetrust-accept-btn-handler', { timeout: 3000 }).catch(() => {});

    let destination: BookingDestination | null = null;
    let target = initialTarget;
    if (resolveLocation) {
      destination = await resolveDestinationViaAutocomplete(page, resolveLocation, () => homeHeaders, logger);
      if (destination) {
        console.log(`📍 Booking destination: ${destination.label} (${destination.destType.toLowerCase()} ${destination.destId})`);
        target = { kind: 'destination', destination };
      } else if (!target && resolveFallback) {
        target = await resolveFallback();
      }
    }
    if (!target) throw new Error('No Booking search target');

    const searchUrl = buildSearchUrl(params, target);
    console.log(`  Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitOutWafChallenge(page);
    await page.waitForSelector('[data-testid="property-card"]', { timeout: 30000 }).catch(() => {});

    const finalUrl = page.url();
    const cardCount = await page.locator('[data-testid="property-card"]').count().catch(() => 0);
    const heading = await page.locator('h1').first().innerText({ timeout: 3000 }).catch(() => '');
    logger.log('bootstrap_serp_loaded', { finalUrl, cardCount, heading });
    if (!finalUrl.includes('/searchresults')) {
      throw new BookingSessionError(`searchresults bounced to ${finalUrl}`);
    }
    if (heading) console.log(`  ${heading}`);

    if (cardCount > 0 && !preferCache) {
      await triggerFullSearchCapture(page, () => !!liveTemplate);
    }

    let template: FullSearchTemplate | null = null;
    let templateSource: LiveSession['templateSource'] = null;
    if (liveTemplate) {
      template = liveTemplate;
      templateSource = 'live';
      saveFullSearchTemplate(liveTemplate);
    } else {
      template = getCachedFullSearchTemplate();
      templateSource = template ? 'cache' : null;
    }

    const hasCsrf = !!headers['x-booking-csrf-token'];
    logger.log('bootstrap_completed', {
      success: hasCsrf,
      hasCsrfToken: hasCsrf,
      templateSource,
      templateHasQueryText: typeof template?.query === 'string',
      destination,
    });
    console.log(`  ✅ Session ready (FullSearch template: ${templateSource ?? 'none'}${hasCsrf ? '' : ', no CSRF header'})`);

    return {
      session: {
        browser,
        page,
        searchUrl,
        graphqlUrl: liveGraphqlUrl || buildGraphqlUrl(searchUrl),
        headers: pickGraphqlHeaders(headers['x-booking-csrf-token'] ? headers : { ...homeHeaders, ...headers }),
        template,
        templateSource,
        close,
      },
      destination,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

// --- Response parsing ---

function parseSearchResult(r: any, params: BookingSearchParams): SearchResult | null {
  const hotelId = r?.basicPropertyData?.id;
  if (!hotelId) return null;

  const pageName = r?.basicPropertyData?.pageName || '';
  const countryCode = (r?.basicPropertyData?.location?.countryCode || '').toLowerCase();

  const priceInfo = r?.priceDisplayInfoIrene?.displayPrice;
  const pricing = parseBookingGraphQLPricing(
    priceInfo,
    params.currency,
    getStayNights(params.checkin, params.checkout),
  );

  const reviewScore = r?.basicPropertyData?.reviewScore;
  const legacyReviews = r?.basicPropertyData?.reviews;
  const location = r?.basicPropertyData?.location;
  const unitConfigurations = getMatchingUnitConfigurations(r);
  const bedroomCounts = unitConfigurations
    .map((config: any) => toFiniteNumber(config?.nbBedrooms ?? config?.bedrooms))
    .filter((value: number | null): value is number => value != null);
  const bedCounts = unitConfigurations
    .map((config: any) => toFiniteNumber(config?.nbAllBeds ?? config?.beds))
    .filter((value: number | null): value is number => value != null);
  const bathroomCounts = unitConfigurations
    .map((config: any) => toFiniteNumber(config?.nbBathrooms ?? config?.bathrooms))
    .filter((value: number | null): value is number => value != null);

  const rating = toFiniteNumber(reviewScore?.score) ?? toFiniteNumber(legacyReviews?.totalScore);
  const reviewCount = toFiniteNumber(reviewScore?.reviewCount) ?? toFiniteNumber(legacyReviews?.reviewsCount) ?? 0;

  return {
    id: String(hotelId),
    platform: 'booking',
    name: r?.displayName?.text || r?.basicPropertyData?.name || '',
    url: `https://www.booking.com/hotel/${countryCode}/${pageName}.html`,
    rating: rating && rating > 0 ? rating : null,
    reviewCount,
    pricing,
    coordinates: location?.latitude != null && location?.longitude != null
      ? { lat: location.latitude, lng: location.longitude }
      : null,
    propertyType: r?.basicPropertyData?.accommodationTypeId != null
      ? String(r.basicPropertyData.accommodationTypeId)
      : null,
    photoUrl: r?.basicPropertyData?.photos?.main?.highResUrl?.relativeUrl
      ? `https://cf.bstatic.com${r.basicPropertyData.photos.main.highResUrl.relativeUrl}`
      : null,
    bedrooms: bedroomCounts.length > 0 ? Math.max(...bedroomCounts) : undefined,
    beds: bedCounts.length > 0 ? Math.max(...bedCounts) : undefined,
    bathrooms: bathroomCounts.length > 0 ? Math.max(...bathroomCounts) : undefined,
    stars: r?.basicPropertyData?.starRating?.value ?? undefined,
    freeCancellation: r?.policies?.showFreeCancellation ?? undefined,
    hostType: typeof r?.hostTraderLabel === 'string' && r.hostTraderLabel ? r.hostTraderLabel : undefined,
  };
}

function isInsideBbox(result: SearchResult, bbox: BoundingBox): boolean {
  if (!result.coordinates) return false;
  const { lat, lng } = result.coordinates;
  return lat <= bbox.neLat && lat >= bbox.swLat && lng <= bbox.neLng && lng >= bbox.swLng;
}

interface ParsedPage {
  results: SearchResult[];
  rawResultsCount: number;
  totalResults: number;
}

function parseFullSearchPayload(data: any, params: BookingSearchParams, bbox?: BoundingBox): ParsedPage {
  const search = data?.data?.searchQueries?.search;
  const rawResults = Array.isArray(search?.results) ? search.results : [];
  const total = toFiniteNumber(search?.pagination?.nbResultsTotal) ?? 0;

  const parsed: SearchResult[] = [];
  for (const raw of rawResults) {
    const result = parseSearchResult(raw, params);
    if (result) parsed.push(result);
  }
  // Booking pads bbox searches with a few nearby properties; keep the box strict.
  const inArea = bbox ? parsed.filter(result => isInsideBbox(result, bbox)) : parsed;
  return {
    results: filterSearchResults(inArea, params),
    rawResultsCount: parsed.length,
    totalResults: total,
  };
}

/** Collect FullSearch-style result objects (anything with basicPropertyData) from a JSON tree. */
function harvestResultObjects(node: any, out: Map<string, any>, depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 40) return;
  if (Array.isArray(node)) {
    for (const item of node) harvestResultObjects(item, out, depth + 1);
    return;
  }
  const id = node.basicPropertyData?.id;
  if (id != null && node.basicPropertyData?.pageName && !out.has(String(id))) {
    out.set(String(id), node);
  }
  for (const value of Object.values(node)) harvestResultObjects(value, out, depth + 1);
}

// --- Main entry point ---

export async function searchBooking(
  params: BookingSearchParams,
  onProgress?: ProgressCallback,
): Promise<{ results: SearchResult[]; pagesScanned: number }> {
  if (!params.boundingBox && !params.location && !params.destId) {
    throw new Error('Booking search requires --location, --bbox, or --dest-id');
  }
  assertProxyPolicy();

  const logger = createBookingSearchLogger({
    params,
    mode: params.exhaustive ? 'exhaustive' : 'quick',
    useBboxSearch: !!params.boundingBox,
  });
  if (logger.filePath) {
    console.log(`🧾 Booking search log: ${logger.filePath}`);
  }

  // Decide the initial target. --dest-id is used as given; --location (without bbox) is
  // resolved through Booking AutoComplete inside the session; districts Booking does not
  // know (e.g. "Gdańsk Śródmieście") fall back to the geocoded bounding box.
  let bbox = params.boundingBox;
  let initialTarget: SearchTarget | null = null;
  let resolveLocation: string | null = null;
  if (params.destId) {
    initialTarget = {
      kind: 'destination',
      destination: {
        destId: String(params.destId),
        destType: (params.destType || 'city').toUpperCase(),
        label: params.location || String(params.destId),
      },
    };
  } else if (bbox) {
    initialTarget = { kind: 'bbox', bbox };
  } else if (params.location) {
    resolveLocation = params.location;
  }

  let session: LiveSession | null = null;
  let target: SearchTarget | null = initialTarget;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_SESSION_ATTEMPTS && !session; attempt++) {
    try {
      const locationQuery = resolveLocation;
      const opened = await openSession(params, target, resolveLocation, logger, async () => {
        console.log(`🌍 Booking has no destination matching "${locationQuery}" — searching its geocoded area instead`);
        logger.log('destination_fallback_geocode', { location: locationQuery });
        bbox = ensureMinBbox(await geocodeLocation(locationQuery!), 1000);
        target = { kind: 'bbox', bbox };
        return target;
      });
      if (opened.destination) {
        target = { kind: 'destination', destination: opened.destination };
      }
      resolveLocation = null;
      session = opened.session;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      logger.log('bootstrap_failed', { attempt, error: message });
      console.log(`  ⚠️  Session attempt ${attempt} failed: ${message}`);
      if (attempt < MAX_SESSION_ATTEMPTS) await sleep(politeDelay(5000));
    }
  }

  if (!session || !target) {
    logger.log('search_completed', { totalResults: 0, pagesScanned: 0, error: String(lastError) });
    await logger.flush().catch(() => {});
    throw lastError instanceof Error ? lastError : new Error('Could not open a Booking.com search session');
  }

  const seenIds = new Set<string>();
  const allResults: SearchResult[] = [];
  let pagesScanned = 0;
  const maxReached = () => !!params.maxResults && allResults.length >= params.maxResults;

  const addUniqueResults = (results: SearchResult[]): SearchResult[] => {
    const fresh: SearchResult[] = [];
    for (const result of results) {
      if (!seenIds.has(result.id)) {
        seenIds.add(result.id);
        fresh.push(result);
      }
    }
    allResults.push(...fresh);
    return fresh;
  };

  let templateRefreshed = false;
  let sessionReopened = false;

  /** One FullSearch page, with one template refresh and one session re-open on failure. */
  const fetchPage = async (pageTarget: SearchTarget, offset: number): Promise<any> => {
    for (;;) {
      if (!session!.template) {
        throw new Error('No FullSearch template captured from booking.com (and none cached)');
      }
      const body = buildFullSearchBody(session!.template, params, pageTarget, offset, ROWS_PER_PAGE, session!.searchUrl);
      const response = await pageFetchJson(session!.page, session!.graphqlUrl, session!.headers, body);
      const payload = response.json;
      const hasResults = Array.isArray(payload?.data?.searchQueries?.search?.results);

      if (response.status === 200 && hasResults) return payload;

      if (payload && isStaleQueryError(payload) && !templateRefreshed) {
        templateRefreshed = true;
        console.log('  🔄 FullSearch query outdated — refreshing it from booking.com...');
        logger.log('template_refresh', { source: session!.templateSource, errors: payload.errors?.map((e: any) => e.message) });
        forgetFullSearchTemplate();
        await session!.close();
        session = (await openSession(params, target, null, logger)).session;
        continue;
      }

      if (!sessionReopened && (response.status === 0 || response.status === 403 || response.status >= 500 || !payload)) {
        sessionReopened = true;
        console.log(`  🔄 GraphQL HTTP ${response.status} — reopening session...`);
        logger.log('session_reopen', { status: response.status, snippet: response.text.slice(0, 200) });
        await session!.close();
        await sleep(politeDelay(3000));
        session = (await openSession(params, target, null, logger)).session;
        continue;
      }

      const message = payload?.errors?.map((e: any) => e.message).join('; ') || `HTTP ${response.status}`;
      throw new Error(`Booking FullSearch failed: ${message}`);
    }
  };

  /** Paginate one target (destination or bbox cell). */
  const searchTarget = async (pageTarget: SearchTarget, label: string): Promise<ParsedPage> => {
    const cellBbox = pageTarget.kind === 'bbox' ? pageTarget.bbox : undefined;
    const cellResults: SearchResult[] = [];
    const cellIds = new Set<string>();
    let totalResults = 0;
    let rawResultsCount = 0;
    let staleRows = 0;

    for (let offset = 0, pageIndex = 0; offset < MAX_OFFSET; offset += ROWS_PER_PAGE, pageIndex++) {
      logger.log('full_search_request', { label, pageIndex, offset, target: pageTarget });
      const payload = await fetchPage(pageTarget, offset);
      const page = parseFullSearchPayload(payload, params, cellBbox);
      if (pageIndex === 0) totalResults = page.totalResults;
      rawResultsCount += page.rawResultsCount;

      const freshInCell = page.results.filter(result => !cellIds.has(result.id));
      freshInCell.forEach(result => cellIds.add(result.id));
      cellResults.push(...freshInCell);
      const fresh = addUniqueResults(freshInCell);
      pagesScanned++;
      const hasNextPage = page.rawResultsCount > 0 && offset + ROWS_PER_PAGE < Math.min(page.totalResults, MAX_OFFSET);
      onProgress?.({ results: fresh, hasNextPage, pageIndex });
      logger.log('full_search_page', {
        label,
        pageIndex,
        offset,
        rawResultsCount: page.rawResultsCount,
        filteredResultsCount: page.results.length,
        newUniqueResultsCount: fresh.length,
        totalResults: page.totalResults,
        hasNextPage,
      });

      staleRows = freshInCell.length === 0 ? staleRows + 1 : 0;
      if (!hasNextPage || staleRows >= 2 || maxReached()) break;
      await sleep(politeDelay(PAGE_DELAY_MS));
    }

    return { results: cellResults, totalResults, rawResultsCount };
  };

  /** Server-rendered fallback: walk `&offset=N` pages of the searchresults URL. */
  const searchViaSsr = async (): Promise<void> => {
    console.log('  📄 No FullSearch template — harvesting server-rendered result pages');
    const page = session!.page;
    const areaBbox = target!.kind === 'bbox' ? target!.bbox : undefined;
    for (let offset = 0, pageIndex = 0; offset < MAX_OFFSET; offset += 25, pageIndex++) {
      const url = new URL(session!.searchUrl);
      if (offset > 0) url.searchParams.set('offset', String(offset));
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForSelector('[data-testid="property-card"]', { timeout: 20000 }).catch(() => {});
      const blobs: string[] = await page.$$eval('script[type="application/json"]', (els: any[]) => els.map(el => el.textContent || ''));
      const found = new Map<string, any>();
      for (const blob of blobs) {
        try { harvestResultObjects(JSON.parse(blob), found); } catch { /* ignore */ }
      }
      const parsed = [...found.values()]
        .map(raw => parseSearchResult(raw, params))
        .filter((r): r is SearchResult => !!r)
        .filter(r => !areaBbox || isInsideBbox(r, areaBbox));
      const fresh = addUniqueResults(filterSearchResults(parsed, params));
      pagesScanned++;
      onProgress?.({ results: fresh, hasNextPage: found.size > 0, pageIndex });
      logger.log('ssr_page', { pageIndex, offset, harvested: found.size, newUniqueResultsCount: fresh.length });
      if (found.size === 0 || maxReached()) break;
      await sleep(politeDelay(2000));
    }
  };

  try {
    if (!session.template) {
      await searchViaSsr();
    } else if (!params.exhaustive || target.kind === 'destination') {
      const label = target.kind === 'destination'
        ? `${target.destination.destType.toLowerCase()} ${target.destination.destId}`
        : 'bbox';
      console.log(`🔍 Booking FullSearch (${label}, ${ROWS_PER_PAGE}/page, max ${params.maxResults || 'unlimited'} results)...`);
      const out = await searchTarget(target, label);
      console.log(`  ↳ Booking reports ${out.totalResults} properties`);
    } else {
      // Exhaustive: bbox quadrant subdivision (Booking caps one query at ~1000 rows).
      console.log('🔍 Exhaustive Booking search via FullSearch + bbox subdivision...');
      let visitedCells = 0;
      const visitCell = async (cell: BoundingBox, depth: number, seeded?: ParsedPage): Promise<void> => {
        visitedCells++;
        const label = `Cell ${visitedCells} (depth ${depth})`;
        console.log(`  📍 ${label}`);
        try {
          const cellOut = seeded ?? await searchTarget({ kind: 'bbox', bbox: cell }, label);
          const signal = Math.max(cellOut.results.length, cellOut.rawResultsCount, cellOut.totalResults);
          console.log(`    ↳ ${cellOut.results.length} filtered / ${cellOut.rawResultsCount} raw / ${cellOut.totalResults} reported`);
          logger.log('subdivision_cell_evaluated', {
            label, depth, boundingBox: cell,
            filteredResultsCount: cellOut.results.length,
            rawResultsCount: cellOut.rawResultsCount,
            totalResults: cellOut.totalResults,
          });
          // Only subdivide when the cell hit Booking's per-query cap.
          const capped = cellOut.totalResults > cellOut.rawResultsCount + 5;
          if (!capped || maxReached() || !shouldProbeChildren({
            bbox: cell, depth, resultCount: signal, config: BOOKING_SUBDIVISION_CONFIG,
          })) {
            return;
          }
          const children = subdivideBbox(cell).filter(child => !params.circle || bboxIntersectsCircle(child, params.circle));
          const parentIds = new Set(cellOut.results.map(r => r.id));
          const childOuts: Array<{ cell: BoundingBox; out: ParsedPage }> = [];
          const childIds = new Set<string>();
          for (const child of children) {
            await sleep(politeDelay(CELL_DELAY_MS));
            const out = await searchTarget({ kind: 'bbox', bbox: child }, `${label} -> probe`);
            childOuts.push({ cell: child, out });
            out.results.forEach(r => childIds.add(r.id));
            if (maxReached()) break;
          }
          const newIdCount = countNewChildIds(parentIds, childIds);
          const gain = hasMeaningfulChildGain({ parentCount: parentIds.size, newIdCount, config: BOOKING_SUBDIVISION_CONFIG });
          const recurse = shouldRecurseIntoChildren({ depth, parentCount: parentIds.size, newIdCount, config: BOOKING_SUBDIVISION_CONFIG });
          logger.log('subdivision_children_probed', { label, depth, newChildIdCount: newIdCount, gain, shouldRecurse: recurse });
          if (!recurse || maxReached()) return;
          for (const child of childOuts) {
            await visitCell(child.cell, depth + 1, child.out);
            if (maxReached()) break;
          }
        } catch (error: any) {
          logger.log('subdivision_error', { label, depth, boundingBox: cell, error: error?.message ?? String(error) });
          console.log(`  ⚠️  ${label} error: ${error?.message ?? error}`);
        }
      };
      await visitCell(target.bbox, 0);
    }
  } catch (error: any) {
    logger.log('search_error', { error: error?.message ?? String(error), resultsSoFar: allResults.length });
    if (allResults.length === 0) {
      await session.close();
      await logger.flush().catch(() => {});
      throw error;
    }
    console.log(`  ⚠️  ${error?.message ?? error} — returning ${allResults.length} results collected so far`);
  } finally {
    await session?.close();
  }

  logger.log('search_completed', {
    totalResults: allResults.length,
    pagesScanned,
    mode: params.exhaustive ? 'exhaustive' : 'quick',
    target,
  });
  await logger.flush().catch(() => {});
  console.log(`✅ Booking search complete: ${allResults.length} unique results, ${pagesScanned} pages scanned`);
  return { results: allResults, pagesScanned };
}

export const __bookingSearchTestUtils = {
  buildFilterString,
  buildFullSearchBody,
  buildSearchUrl,
  parseFullSearchPayload,
  pickAutocompleteDestination,
  parseAutocompleteResponse,
  autocompleteQueryVariants,
  ensureMinBbox,
  assertProxyPolicy,
};
