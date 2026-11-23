// src/booking/search-hashes.ts
//
// Cache for the Booking.com FullSearch GraphQL request template.
//
// History: Booking used Apollo persisted queries (sha256 hash only) for FullSearch and
// MapMarkersDesktop. By November 2026 those hashes were no longer registered
// (`PersistedQueryNotFound`) and booking.com's own searchresults page now sends FullSearch
// with the full query text inline and empty `extensions`. The query text changes with
// Booking front-end deployments, so it is never hardcoded:
// - every live session captures the FullSearch body booking.com's page sends (search.ts)
//   and stores it here;
// - the cache (~/.config/reviewr/booking-search-template.json) is only used when the page
//   does not fire FullSearch on its own during a session.

import * as fs from 'fs';
import * as path from 'path';
import { getConfigDir } from '../config.js';

export interface FullSearchTemplate {
  operationName: 'FullSearch';
  query?: string;
  extensions?: Record<string, unknown>;
  variables: Record<string, any>;
}

interface TemplateCacheFile {
  fullSearch?: FullSearchTemplate;
  capturedAt?: string;
  /** Booking destination AutoComplete request (query text inline), used to resolve --location. */
  autoComplete?: { operationName: 'AutoComplete'; query: string; variables: Record<string, any> };
}

let memoryCache: TemplateCacheFile | null = null;

function getCachePath(): string {
  return path.join(getConfigDir(), 'booking-search-template.json');
}

function loadCache(): TemplateCacheFile {
  if (memoryCache) return memoryCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(getCachePath(), 'utf-8'));
    memoryCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache!;
}

function writeCache(cache: TemplateCacheFile): void {
  memoryCache = cache;
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(getCachePath(), JSON.stringify(cache, null, 2));
  } catch {
    // The cache is an optimisation only.
  }
}

export function isUsableFullSearchTemplate(body: any): body is FullSearchTemplate {
  return body?.operationName === 'FullSearch'
    && !!body?.variables?.input
    && (typeof body.query === 'string' || !!body.extensions?.persistedQuery);
}

export function getCachedFullSearchTemplate(): FullSearchTemplate | null {
  const cached = loadCache().fullSearch;
  return isUsableFullSearchTemplate(cached) ? cached : null;
}

export function saveFullSearchTemplate(body: any): void {
  if (!isUsableFullSearchTemplate(body)) return;
  const template: FullSearchTemplate = {
    operationName: 'FullSearch',
    query: body.query,
    extensions: body.extensions,
    variables: body.variables,
  };
  const cache = loadCache();
  if (cache.fullSearch?.query === template.query
    && JSON.stringify(cache.fullSearch?.extensions) === JSON.stringify(template.extensions)) {
    return;
  }
  writeCache({ ...cache, fullSearch: template, capturedAt: new Date().toISOString() });
}

export function getCachedAutoCompleteTemplate(): any | null {
  const cached = loadCache().autoComplete;
  return cached?.operationName === 'AutoComplete' && typeof cached.query === 'string' && cached.variables?.input
    ? cached
    : null;
}

export function saveAutoCompleteTemplate(body: any): void {
  if (body?.operationName !== 'AutoComplete' || typeof body.query !== 'string' || !body.variables?.input) return;
  const cache = loadCache();
  if (cache.autoComplete?.query === body.query) return;
  writeCache({ ...cache, autoComplete: { operationName: 'AutoComplete', query: body.query, variables: body.variables } });
}

export function forgetFullSearchTemplate(): void {
  const cache = loadCache();
  if (!cache.fullSearch) return;
  const { fullSearch: _dropped, capturedAt: _at, ...rest } = cache;
  writeCache(rest);
}

/** True for responses that mean "this query document is unknown/outdated" — refresh the template. */
export function isStaleQueryError(payload: any): boolean {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  return errors.some((error: any) => {
    const code = String(error?.extensions?.code || '');
    const message = String(error?.message || '');
    return message === 'PersistedQueryNotFound'
      || code === 'PERSISTED_QUERY_NOT_FOUND'
      || code === 'GRAPHQL_VALIDATION_FAILED'
      || /Cannot query field|Unknown argument|Unknown type/i.test(message);
  });
}
