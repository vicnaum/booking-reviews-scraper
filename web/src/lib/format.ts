import type { PriceDisplayMode, SearchResult } from '@/types';
export type { PriceDisplayInfo } from './pricing';
export {
  currencySymbol,
  formatAmount,
  getNightCount,
  getPriceDisplayInfo,
} from './pricing';

export type PriceDisplay = PriceDisplayMode;

export function formatRating(result: SearchResult): string {
  if (result.rating == null) return '';
  if (result.platform === 'airbnb') return `\u2605 ${result.rating}`;
  return `${result.rating}/10`;
}
