import type {
  CircleFilter,
  PriceDisplayMode,
  QuickSearchRequest,
  SearchResult,
} from '@/types';

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

function getNightCount(
  checkin?: string,
  checkout?: string,
): number | null {
  if (!checkin || !checkout) {
    return null;
  }

  const start = new Date(`${checkin}T00:00:00Z`);
  const end = new Date(`${checkout}T00:00:00Z`);
  const diffMs = end.getTime() - start.getTime();

  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return null;
  }

  const nights = Math.round(diffMs / 86400000);
  return nights > 0 ? nights : null;
}

function getComparablePriceAmount(
  result: SearchResult,
  mode: PriceDisplayMode,
  checkin?: string,
  checkout?: string,
): number | null {
  const nights = getNightCount(checkin, checkout);

  if (mode === 'total') {
    if (result.totalPrice) {
      return result.totalPrice.amount;
    }

    if (result.price) {
      return nights ? result.price.amount * nights : result.price.amount;
    }

    return null;
  }

  if (result.price) {
    return result.price.amount;
  }

  if (result.totalPrice) {
    return nights ? result.totalPrice.amount / nights : result.totalPrice.amount;
  }

  return null;
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
