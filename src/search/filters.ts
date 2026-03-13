import type { SearchParams, SearchResult } from './types.js';

type SearchResultFilterParams = Pick<SearchParams, 'minBedrooms' | 'minBeds'>;

export function matchesSearchResultFilters(
  result: SearchResult,
  params: SearchResultFilterParams,
): boolean {
  if (params.minBedrooms != null) {
    if (result.bedrooms == null || result.bedrooms < params.minBedrooms) {
      return false;
    }
  }

  if (params.minBeds != null) {
    if (result.beds == null || result.beds < params.minBeds) {
      return false;
    }
  }

  return true;
}

export function filterSearchResults<T extends SearchResult>(
  results: T[],
  params: SearchResultFilterParams,
): T[] {
  return results.filter((result) => matchesSearchResultFilters(result, params));
}
