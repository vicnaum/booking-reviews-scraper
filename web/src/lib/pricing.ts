import type {
  PriceDisplayMode,
  SearchPriceSource,
  SearchResult,
} from '@/types';

interface ResolvePriceOptions {
  checkin?: string | null;
  checkout?: string | null;
}

export interface ResolvedPriceValue {
  amount: number;
  currency: string;
  source: SearchPriceSource;
  basis: 'night' | 'stay';
  approximate: boolean;
}

export interface PriceDisplayInfo {
  primary: string;
  secondary: string | null;
  marker: string;
  source: SearchPriceSource | null;
  basis: 'night' | 'stay' | null;
}

export function currencySymbol(code: string): string {
  if (code === 'USD') return '$';
  if (code === 'EUR') return '\u20AC';
  if (code === 'GBP') return '\u00A3';
  return `${code}\u00A0`;
}

export function formatAmount(amount: number, currency: string): string {
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

function makeResolvedPrice(
  amount: number | null,
  currency: string | null,
  source: SearchPriceSource,
  basis: 'night' | 'stay',
): ResolvedPriceValue | null {
  if (amount == null || !Number.isFinite(amount) || !currency) {
    return null;
  }

  return {
    amount,
    currency,
    source,
    basis,
    approximate: source !== 'upstream',
  };
}

export function resolveComparablePrice(
  result: SearchResult,
  mode: PriceDisplayMode,
  options: ResolvePriceOptions = {},
): ResolvedPriceValue | null {
  const pricing = result.pricing;
  if (!pricing) {
    return null;
  }

  const nights = getNightCount(options.checkin, options.checkout);

  if (mode === 'total') {
    if (pricing.total) {
      return makeResolvedPrice(
        pricing.total.amount,
        pricing.total.currency,
        pricing.total.source,
        'stay',
      );
    }

    if (pricing.nightly && nights) {
      return makeResolvedPrice(
        pricing.nightly.amount * nights,
        pricing.nightly.currency,
        'derived',
        'stay',
      );
    }

    if (pricing.display?.basis === 'stay') {
      return makeResolvedPrice(
        pricing.display.amount,
        pricing.display.currency,
        pricing.display.source,
        'stay',
      );
    }

    return null;
  }

  if (pricing.nightly) {
    return makeResolvedPrice(
      pricing.nightly.amount,
      pricing.nightly.currency,
      pricing.nightly.source,
      'night',
    );
  }

  if (pricing.total && nights) {
    return makeResolvedPrice(
      pricing.total.amount / nights,
      pricing.total.currency,
      'derived',
      'night',
    );
  }

  if (pricing.display?.basis === 'night') {
    return makeResolvedPrice(
      pricing.display.amount,
      pricing.display.currency,
      pricing.display.source,
      'night',
    );
  }

  return null;
}

function formatResolvedPrice(value: ResolvedPriceValue): string {
  const suffix = value.basis === 'stay' ? ' total' : ' per night';
  return `${formatAmount(value.amount, value.currency)}${suffix}`;
}

export function getPriceDisplayInfo(
  result: SearchResult,
  mode: PriceDisplayMode,
  options: ResolvePriceOptions = {},
): PriceDisplayInfo {
  const primary = resolveComparablePrice(result, mode, options);
  const secondary = resolveComparablePrice(
    result,
    mode === 'total' ? 'perNight' : 'total',
    options,
  );

  if (!primary) {
    return {
      primary: '?',
      secondary: null,
      marker: '?',
      source: null,
      basis: null,
    };
  }

  return {
    primary: formatResolvedPrice(primary),
    secondary: secondary ? formatResolvedPrice(secondary) : null,
    marker: formatAmount(primary.amount, primary.currency),
    source: primary.source,
    basis: primary.basis,
  };
}
