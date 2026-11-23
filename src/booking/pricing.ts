import {
  detectCurrencyFromText,
  makeDisplayPriceValue,
  makePriceValue,
  makeSearchPricing,
  parsePriceAmount,
} from '../search/pricing.js';
import type { SearchPricing } from '../search/types.js';

export function parseBookingGraphQLPricing(
  displayPrice: any,
  currency: string,
  nights: number | null,
): SearchPricing | null {
  if (!displayPrice) {
    return null;
  }

  const unformatted = Number(displayPrice?.amountPerStay?.amountUnformatted);
  const totalAmount = Number.isFinite(unformatted) && unformatted > 0
    ? unformatted
    : parsePriceAmount(
      displayPrice?.amountPerStay?.amount
      ?? displayPrice?.amountPerStay?.amountRounded,
    );
  const detectedCurrency = displayPrice?.amountPerStay?.currency || detectCurrencyFromText(
    displayPrice?.amountPerStay?.amount
    ?? displayPrice?.amountPerStay?.amountRounded,
    currency,
  );
  const nightlyAmount =
    totalAmount != null && nights && nights > 0
      ? totalAmount / nights
      : null;

  return makeSearchPricing({
    nightly: makePriceValue(nightlyAmount, detectedCurrency, nightlyAmount != null ? 'derived' : 'upstream'),
    total: makePriceValue(totalAmount, detectedCurrency, 'upstream'),
    display: makeDisplayPriceValue(totalAmount, detectedCurrency, 'stay', 'upstream'),
  });
}

export function parseBookingCardPricing(
  rawDisplayPrice: string,
  currency: string,
): SearchPricing | null {
  const amount = parsePriceAmount(rawDisplayPrice);
  const detectedCurrency = detectCurrencyFromText(rawDisplayPrice, currency);
  return makeSearchPricing({
    display: makeDisplayPriceValue(amount, detectedCurrency, 'stay'),
    total: makePriceValue(amount, detectedCurrency, 'displayed'),
  });
}
