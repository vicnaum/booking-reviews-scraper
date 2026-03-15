import {
  extractNightlyRateFromDescription,
  makeDisplayPriceValue,
  makePriceValue,
  makeSearchPricing,
  parsePriceAmount,
} from '../search/pricing.js';
import type { SearchPriceBasis, SearchPricing } from '../search/types.js';

function getAirbnbDisplayBasis(qualifier: unknown): SearchPriceBasis {
  if (typeof qualifier !== 'string') {
    return 'unknown';
  }

  if (qualifier.includes('total') || qualifier.includes('stay')) {
    return 'stay';
  }

  if (qualifier.includes('night')) {
    return 'night';
  }

  return 'unknown';
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
  const displayText =
    primaryLine?.price
    ?? primaryLine?.discountedPrice
    ?? primaryLine?.originalPrice
    ?? primaryLine?.accessibility_label
    ?? primaryLine?.accessibilityLabel;
  const displayAmount = parsePriceAmount(displayText);
  const displayBasis = getAirbnbDisplayBasis(
    primaryLine?.qualifier ?? primaryLine?.priceQualifier,
  );

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
): SearchPricing | null {
  if (!structuredDisplayPrice) {
    return null;
  }

  const primaryLine =
    structuredDisplayPrice?.primaryLine ?? structuredDisplayPrice?.primary_line;
  const displayText =
    primaryLine?.discountedPrice
    ?? primaryLine?.originalPrice
    ?? primaryLine?.price
    ?? primaryLine?.accessibilityLabel
    ?? primaryLine?.accessibility_label;
  const displayAmount = parsePriceAmount(displayText);
  const displayBasis = getAirbnbDisplayBasis(
    primaryLine?.qualifier ?? primaryLine?.priceQualifier,
  );
  const priceDetails =
    structuredDisplayPrice?.explanationData?.priceDetails
    ?? structuredDisplayPrice?.explanation_data?.price_details;
  const { nightly, total } = extractAirbnbBreakdownAmounts(priceDetails, currency);

  return makeSearchPricing({
    nightly,
    total:
      total
      ?? makePriceValue(
        displayBasis === 'stay' ? displayAmount : null,
        currency,
        'displayed',
      ),
    display: makeDisplayPriceValue(displayAmount, currency, displayBasis),
  });
}
