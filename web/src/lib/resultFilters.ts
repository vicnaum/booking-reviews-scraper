import type {
  CircleFilter,
  PriceDisplayMode,
  QuickSearchRequest,
  SearchResult,
} from '@/types';
import { resolveComparablePrice } from './pricing';

type ResultFilterRequest = Pick<
  QuickSearchRequest,
  | 'circle'
  | 'checkin'
  | 'checkout'
  | 'minBedrooms'
  | 'minBeds'
  | 'priceDisplay'
  | 'priceMin'
  | 'priceMax'
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

function getComparablePriceAmount(
  result: SearchResult,
  mode: PriceDisplayMode,
  checkin?: string,
  checkout?: string,
): number | null {
  return resolveComparablePrice(result, mode, { checkin, checkout })?.amount ?? null;
}

function matchesCircleFilter(
  result: SearchResult,
  circle: CircleFilter,
): boolean {
  if (!result.coordinates) {
    return false;
  }

  const distanceMeters = haversineDistanceMeters(
    circle.center.lat,
    circle.center.lng,
    result.coordinates.lat,
    result.coordinates.lng,
  );

  return distanceMeters <= circle.radiusMeters;
}

export function matchesResultFilters(
  result: SearchResult,
  request: ResultFilterRequest,
): boolean {
  if (
    request.minBedrooms != null &&
    (result.bedrooms == null || result.bedrooms < request.minBedrooms)
  ) {
    return false;
  }

  if (request.minBeds != null && (result.beds == null || result.beds < request.minBeds)) {
    return false;
  }

  if (request.circle && !matchesCircleFilter(result, request.circle)) {
    return false;
  }

  if (request.priceMin != null || request.priceMax != null) {
    const comparableAmount = getComparablePriceAmount(
      result,
      request.priceDisplay ?? 'total',
      request.checkin,
      request.checkout,
    );

    if (comparableAmount == null) {
      return false;
    }

    if (request.priceMin != null && comparableAmount < request.priceMin) {
      return false;
    }

    if (request.priceMax != null && comparableAmount > request.priceMax) {
      return false;
    }
  }

  return true;
}

export function filterResultsForRequest<T extends SearchResult>(
  results: T[],
  request: ResultFilterRequest,
): T[] {
  return results.filter((result) => matchesResultFilters(result, request));
}
