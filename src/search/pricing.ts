import type {
  SearchDisplayPriceValue,
  SearchPriceBasis,
  SearchPriceSource,
  SearchPriceValue,
  SearchPricing,
} from './types.js';

function normalizeNumberString(value: string): string | null {
  const cleaned = value.replace(/[^\d,.-]/g, '');
  if (!cleaned) {
    return null;
  }

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    const decimalSeparator =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? ',' : '.';
    if (decimalSeparator === ',') {
      return cleaned.replace(/\./g, '').replace(',', '.');
    }
    return cleaned.replace(/,/g, '');
  }

  if (hasComma) {
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
      return `${parts[0]}.${parts[1]}`;
    }
    return cleaned.replace(/,/g, '');
  }

  if (hasDot) {
    const parts = cleaned.split('.');
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
      return cleaned;
    }
    return cleaned.replace(/\./g, '');
  }

  return cleaned;
}

export function parsePriceAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const normalized = normalizeNumberString(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function detectCurrencyFromText(
  value: unknown,
  fallback: string,
): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  if (value.includes('zł') || value.includes('PLN')) {
    return 'PLN';
  }
  if (value.includes('£') || value.includes('GBP')) {
    return 'GBP';
  }
  if (value.includes('€') || value.includes('EUR')) {
    return 'EUR';
  }
  if (value.includes('$') || value.includes('USD')) {
    return 'USD';
  }

  return fallback;
}

export function makePriceValue(
  amount: number | null | undefined,
  currency: string,
  source: SearchPriceSource,
): SearchPriceValue | null {
  if (amount == null || !Number.isFinite(amount)) {
    return null;
  }

  return {
    amount,
    currency,
    source,
  };
}

export function makeDisplayPriceValue(
  amount: number | null | undefined,
  currency: string,
  basis: SearchPriceBasis,
  source: SearchPriceSource = 'displayed',
): SearchDisplayPriceValue | null {
  if (amount == null || !Number.isFinite(amount)) {
    return null;
  }

  return {
    amount,
    currency,
    basis,
    source,
  };
}

export function makeSearchPricing(pricing: {
  nightly?: SearchPriceValue | null;
  total?: SearchPriceValue | null;
  display?: SearchDisplayPriceValue | null;
}): SearchPricing | null {
  const normalized: SearchPricing = {
    nightly: pricing.nightly ?? null,
    total: pricing.total ?? null,
    display: pricing.display ?? null,
  };

  if (!normalized.nightly && !normalized.total && !normalized.display) {
    return null;
  }

  return normalized;
}

export function extractNightlyRateFromDescription(
  description: unknown,
): number | null {
  if (typeof description !== 'string') {
    return null;
  }

  const match = description.match(/x\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return parsePriceAmount(match[1]);
}
