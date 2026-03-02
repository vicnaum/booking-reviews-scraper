import type { SearchResult } from '@/types';

export type PriceDisplay = 'perNight' | 'total';

function currencySymbol(code: string): string {
  if (code === 'USD') return '$';
  if (code === 'EUR') return '\u20AC';
  if (code === 'GBP') return '\u00A3';
  return code + '\u00A0';
}

export function formatPrice(
  result: SearchResult,
  mode: PriceDisplay,
): string {
  if (mode === 'total' && result.totalPrice) {
    return `${currencySymbol(result.totalPrice.currency)}${Math.round(result.totalPrice.amount)}`;
  }
  if (result.price) {
    return `${currencySymbol(result.price.currency)}${Math.round(result.price.amount)}`;
  }
  return '?';
}

export function formatPriceLabel(
  result: SearchResult,
  mode: PriceDisplay,
): string {
  const price = formatPrice(result, mode);
  if (price === '?') return price;
  return mode === 'total' ? price : `${price}/n`;
}

export function formatRating(result: SearchResult): string {
  if (result.rating == null) return '';
  if (result.platform === 'airbnb') return `\u2605 ${result.rating}`;
  return `${result.rating}/10`;
}
