import type { SearchParams, SearchResult } from './types.js';

type SearchResultFilterParams = Pick<
  SearchParams,
  'circle' | 'minBedrooms' | 'minBeds'
>;

function haversineDistanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const a =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
}

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

  if (params.circle) {
    if (!result.coordinates) {
      return false;
    }

    const distanceMeters = haversineDistanceMeters(
      params.circle.center.lat,
      params.circle.center.lng,
      result.coordinates.lat,
      result.coordinates.lng,
    );

    if (distanceMeters > params.circle.radiusMeters) {
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
