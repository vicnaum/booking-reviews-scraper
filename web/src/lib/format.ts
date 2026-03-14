import type { SearchResult } from '@/types';

export type PriceDisplay = 'perNight' | 'total';

interface PriceDisplayInfoOptions {
  checkin?: string | null;
  checkout?: string | null;
}

export interface PriceDisplayInfo {
  primary: string;
  secondary: string | null;
}

export function currencySymbol(code: string): string {
  if (code === 'USD') return '$';
  if (code === 'EUR') return '\u20AC';
  if (code === 'GBP') return '\u00A3';
  return code + '\u00A0';
}

function formatAmount(amount: number, currency: string): string {
  return `${currencySymbol(currency)}${Math.round(amount)}`;
}

export function getNightCount(
  checkin?: string | null,
  checkout?: string | null,
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

export function formatPrice(
  result: SearchResult,
  mode: PriceDisplay,
): string {
  if (mode === 'total' && result.totalPrice) {
    return formatAmount(result.totalPrice.amount, result.totalPrice.currency);
  }
  if (result.price) {
    return formatAmount(result.price.amount, result.price.currency);
  }
  return '?';
}

export function formatPriceLabel(
  result: SearchResult,
  mode: PriceDisplay,
): string {
  const price = formatPrice(result, mode);
  if (price === '?') return price;
  return mode === 'total' ? price : `${price} per night`;
}

export function getPriceDisplayInfo(
  result: SearchResult,
  mode: PriceDisplay,
  options: PriceDisplayInfoOptions = {},
): PriceDisplayInfo {
  const nightly = result.price
    ? formatAmount(result.price.amount, result.price.currency)
    : null;
  const total = result.totalPrice
    ? formatAmount(result.totalPrice.amount, result.totalPrice.currency)
    : null;
  const nights = getNightCount(options.checkin, options.checkout);
  const estimatedNightly =
    !nightly && result.totalPrice && nights
      ? formatAmount(result.totalPrice.amount / nights, result.totalPrice.currency)
      : null;

  if (mode === 'total') {
    if (total) {
      return {
        primary: total,
        secondary: nightly ? `${nightly} per night` : null,
      };
    }

    if (nightly) {
      return {
        primary: nightly,
        secondary: null,
      };
    }

    return { primary: '?', secondary: null };
  }

  if (nightly) {
    return {
      primary: `${nightly} per night`,
      secondary: total,
    };
  }

  if (estimatedNightly) {
    return {
      primary: `${estimatedNightly} est. per night`,
      secondary: total,
    };
  }

  if (total) {
    return { primary: total, secondary: null };
  }

  return { primary: '?', secondary: null };
}

export function formatRating(result: SearchResult): string {
  if (result.rating == null) return '';
  if (result.platform === 'airbnb') return `\u2605 ${result.rating}`;
  return `${result.rating}/10`;
}
