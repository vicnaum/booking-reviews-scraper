import {
  extractNightlyRateFromDescription,
  makeDisplayPriceValue,
  makePriceValue,
  makeSearchPricing,
  parsePriceAmount,
} from '../search/pricing.js';
import type { SearchPriceBasis, SearchPricing } from '../search/types.js';

function getAirbnbDisplayBasis(...labels: unknown[]): SearchPriceBasis {
  const text = labels
    .filter((label): label is string => typeof label === 'string')
    .join(' ')
    .toLowerCase();

  if (
    /\b(?:total|stay)\b/.test(text)
    || /\b(?:for\s+)?\d+\s+nights?\b/.test(text)
  ) {
    return 'stay';
  }

  if (/\bnight\b/.test(text)) {
    return 'night';
  }

  return 'unknown';
}

function getPrimaryLineValue(
  primaryLine: any,
  camelCaseKey: string,
  snakeCaseKey: string,
): unknown {
  const direct = primaryLine?.[camelCaseKey] ?? primaryLine?.[snakeCaseKey];
  if (direct != null) {
    return direct;
  }

  const orderedComponents =
    primaryLine?.orderedComponents ?? primaryLine?.ordered_components;
  if (!Array.isArray(orderedComponents)) {
    return null;
  }

  for (const component of orderedComponents) {
    const value = component?.[camelCaseKey] ?? component?.[snakeCaseKey];
    if (value != null) {
      return value;
    }
  }

  return null;
}

function parseAirbnbPrimaryLine(primaryLine: any): {
  displayAmount: number | null;
  displayBasis: SearchPriceBasis;
} {
  const displayText =
    getPrimaryLineValue(primaryLine, 'discountedPrice', 'discounted_price')
    ?? getPrimaryLineValue(primaryLine, 'price', 'price')
    ?? getPrimaryLineValue(primaryLine, 'originalPrice', 'original_price')
    ?? getPrimaryLineValue(primaryLine, 'accessibilityLabel', 'accessibility_label');
  const qualifier = getPrimaryLineValue(
    primaryLine,
    'priceQualifier',
    'price_qualifier',
  ) ?? getPrimaryLineValue(primaryLine, 'qualifier', 'qualifier');
  const accessibilityLabel = getPrimaryLineValue(
    primaryLine,
    'accessibilityLabel',
    'accessibility_label',
  );

  return {
    displayAmount: parsePriceAmount(displayText),
    displayBasis: getAirbnbDisplayBasis(qualifier, accessibilityLabel),
  };
}

function extractAirbnbBreakdownAmounts(
  priceDetails: unknown,
  currency: string,
) {
  let nightly = null;
  let total = null;

  if (!Array.isArray(priceDetails)) {
    return { nightly, total };
  }

  for (const detail of priceDetails) {
    const items = Array.isArray((detail as { items?: unknown[] })?.items)
      ? (detail as { items: unknown[] }).items
      : [];

    for (const item of items) {
      const description =
        typeof (item as { description?: unknown })?.description === 'string'
          ? (item as { description: string }).description
          : '';
      const rawPrice =
        (item as { priceString?: unknown })?.priceString
        ?? (item as { price_string?: unknown })?.price_string;
      const amount = parsePriceAmount(rawPrice);

      if (amount == null) {
        continue;
      }

      if (description.toLowerCase() === 'total') {
        total = makePriceValue(amount, currency, 'upstream');
        continue;
      }

      if (!nightly && /\bnights?\s+x\b/i.test(description)) {
        const nightlyAmount = extractNightlyRateFromDescription(description);
        nightly = makePriceValue(nightlyAmount, currency, 'upstream');
      }
    }
  }

  return { nightly, total };
}

export function parseAirbnbPricingQuote(
  pricingQuote: any,
  currency: string,
): SearchPricing | null {
  if (!pricingQuote) {
    return null;
  }

  const structuredPrice =
    pricingQuote?.structured_stay_display_price
    ?? pricingQuote?.structuredStayDisplayPrice;
  const primaryLine = structuredPrice?.primary_line ?? structuredPrice?.primaryLine;
  const priceDetails =
    structuredPrice?.explanation_data?.price_details
    ?? structuredPrice?.explanationData?.priceDetails;
  const { displayAmount, displayBasis } = parseAirbnbPrimaryLine(primaryLine);

  const { nightly, total } = extractAirbnbBreakdownAmounts(priceDetails, currency);

  const fallbackTotalAmount =
    total?.amount
    ?? parsePriceAmount(pricingQuote?.price?.total?.amount)
    ?? parsePriceAmount(pricingQuote?.price?.total_price);
  const fallbackNightlyAmount =
    nightly?.amount
    ?? (
      displayBasis === 'night'
        ? parsePriceAmount(pricingQuote?.price?.rate_amount ?? pricingQuote?.rate?.amount)
        : null
    );

  return makeSearchPricing({
    nightly: nightly ?? makePriceValue(fallbackNightlyAmount, currency, 'upstream'),
    total:
      total
      ?? makePriceValue(
        fallbackTotalAmount ?? (displayBasis === 'stay' ? displayAmount : null),
        currency,
        displayBasis === 'stay' && fallbackTotalAmount == null
          ? 'displayed'
          : 'upstream',
      ),
    display: makeDisplayPriceValue(displayAmount, currency, displayBasis),
  });
}

export function parseAirbnbStructuredDisplayPrice(
  structuredDisplayPrice: any,
  currency: string,
  nights: number | null = null,
): SearchPricing | null {
  if (!structuredDisplayPrice) {
    return null;
  }

  const primaryLine =
    structuredDisplayPrice?.primaryLine ?? structuredDisplayPrice?.primary_line;
  const { displayAmount, displayBasis } = parseAirbnbPrimaryLine(primaryLine);
  const priceDetails =
    structuredDisplayPrice?.explanationData?.priceDetails
    ?? structuredDisplayPrice?.explanation_data?.price_details;
  const { nightly, total } = extractAirbnbBreakdownAmounts(priceDetails, currency);
  const displayedTotal = makePriceValue(
    displayBasis === 'stay' ? displayAmount : null,
    currency,
    'displayed',
  );
  const derivedTotal = makePriceValue(
    nightly && nights && nights > 0
      ? nightly.amount * nights
      : null,
    currency,
    'derived',
  );

  return makeSearchPricing({
    nightly,
    total: total ?? displayedTotal ?? derivedTotal,
    display: makeDisplayPriceValue(displayAmount, currency, displayBasis),
  });
}
