import * as cheerio from 'cheerio';
import {
  detectCurrencyFromText,
  parsePriceAmount,
} from '../search/pricing.js';
import {
  STAY_SNAPSHOT_SCHEMA_VERSION,
  type PriceForStaySnapshot,
  type StayDateRange,
  type StayRequestFingerprint,
  type StaySnapshot,
} from '../stay-snapshot.js';

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isIsoDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function uniqueRanges(ranges: StayDateRange[]): StayDateRange[] {
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.checkIn}/${range.checkOut}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getNights(range: StayDateRange): number {
  const checkIn = Date.parse(`${range.checkIn}T00:00:00Z`);
  const checkOut = Date.parse(`${range.checkOut}T00:00:00Z`);
  return Math.max(0, Math.round((checkOut - checkIn) / 86_400_000));
}

function selectAvailableRange(
  ranges: StayDateRange[],
  request: StayRequestFingerprint,
): StayDateRange | undefined {
  if (ranges.length === 0) return undefined;

  const requestedRange =
    request.checkIn && request.checkOut
      ? { checkIn: request.checkIn, checkOut: request.checkOut }
      : null;
  const requestedNights = requestedRange ? getNights(requestedRange) : 0;

  return [...ranges].sort((left, right) => {
    const leftSameCheckout = left.checkOut === request.checkOut ? 1 : 0;
    const rightSameCheckout = right.checkOut === request.checkOut ? 1 : 0;
    if (leftSameCheckout !== rightSameCheckout) {
      return rightSameCheckout - leftSameCheckout;
    }

    const leftCoversRequestedLength = getNights(left) >= requestedNights ? 1 : 0;
    const rightCoversRequestedLength = getNights(right) >= requestedNights ? 1 : 0;
    if (leftCoversRequestedLength !== rightCoversRequestedLength) {
      return rightCoversRequestedLength - leftCoversRequestedLength;
    }

    if (leftSameCheckout && rightSameCheckout) {
      const lengthDifference = getNights(right) - getNights(left);
      if (lengthDifference !== 0) return lengthDifference;
    }

    return left.checkIn.localeCompare(right.checkIn)
      || left.checkOut.localeCompare(right.checkOut);
  })[0];
}

function parseAlternativeRanges($: cheerio.CheerioAPI): StayDateRange[] {
  const ranges: StayDateRange[] = [];
  $('.c-next-available-dates__item').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    try {
      const parsed = new URL(href, 'https://www.booking.com');
      const checkIn = parsed.searchParams.get('checkin');
      const checkOut = parsed.searchParams.get('checkout');
      if (isIsoDate(checkIn) && isIsoDate(checkOut)) {
        ranges.push({ checkIn, checkOut });
      }
    } catch {
      // Ignore malformed provider links.
    }
  });
  return uniqueRanges(ranges);
}

function getFallbackCurrency($: cheerio.CheerioAPI): string {
  const selectedCurrency = cleanText(
    $('input[name="selected_currency"]').first().attr('value') ?? '',
  ).toUpperCase();
  return /^[A-Z]{3}$/.test(selectedCurrency) ? selectedCurrency : '';
}

function extractPriceForStay(
  $: cheerio.CheerioAPI,
  capturedAt: string,
): {
  priceForStay: PriceForStaySnapshot | null;
  priceText?: string;
  chargesText?: string;
} {
  const fallbackCurrency = getFallbackCurrency($);
  const candidates: Array<{
    amount: number;
    currency: string;
    priceText: string;
    chargesText: string;
  }> = [];

  $('tr[data-block-id]').each((_, element) => {
    const rowText = cleanText($(element).text());
    if (/\b(?:genius|member rate|sign(?:ed)? in)\b/i.test(rowText)) {
      return;
    }

    const priceText = cleanText(
      $(element)
        .find(
          '.bui-price-display__value, '
          + '.prco-valign-middle-helper, '
          + '[data-testid="price-and-discounted-price"]',
        )
        .first()
        .text(),
    );
    const amount = parsePriceAmount(priceText);
    const currency = detectCurrencyFromText(priceText, fallbackCurrency);
    if (amount == null || !/^[A-Z]{3}$/.test(currency)) {
      return;
    }

    const chargesText =
      rowText.match(/includes taxes and charges/i)?.[0]
      ?? rowText.match(/excludes taxes and charges/i)?.[0]
      ?? '';
    candidates.push({
      amount,
      currency,
      priceText,
      chargesText,
    });
  });

  candidates.sort((left, right) => left.amount - right.amount);
  const selected = candidates[0];
  if (!selected) {
    return { priceForStay: null };
  }

  return {
    priceForStay: {
      amount: selected.amount,
      currency: selected.currency,
      basis: 'stay',
      capturedAt,
      source: 'booking_property_page',
      rateType: 'public',
      mandatoryChargesResolved: /includes taxes and charges/i.test(
        selected.chargesText,
      ),
    },
    priceText: selected.priceText,
    ...(selected.chargesText ? { chargesText: selected.chargesText } : {}),
  };
}

export function parseBookingStaySnapshot(input: {
  html: string;
  request: StayRequestFingerprint;
  capturedAt?: string;
}): StaySnapshot {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const $ = cheerio.load(input.html);
  const hasExactDates = !!(input.request.checkIn && input.request.checkOut);
  const price = hasExactDates
    ? extractPriceForStay($, capturedAt)
    : { priceForStay: null };
  const roomCount = $('tr[data-block-id]').length;
  const availabilityText = cleanText(
    $('#no_availability_msg .bui-alert__title').first().text(),
  );
  const hasExplicitNo =
    /(?:no availability here between|not available .* for your dates|sold out)/i
      .test(availabilityText);
  const alternativeRanges = hasExactDates ? parseAlternativeRanges($) : [];
  const availableRange = selectAvailableRange(
    alternativeRanges,
    input.request,
  );

  let availability: StaySnapshot['availability'];
  if (!hasExactDates) {
    availability = {
      status: 'unknown',
      capturedAt,
      reasonCode: 'dates_not_requested',
    };
  } else if (roomCount > 0) {
    availability = {
      status: 'yes',
      capturedAt,
      reasonCode: 'provider_room_inventory',
    };
  } else if (hasExplicitNo && availableRange) {
    availability = {
      status: 'partial',
      capturedAt,
      reasonCode: 'provider_alternative_range',
      availableRange,
    };
  } else if (hasExplicitNo) {
    availability = {
      status: 'no',
      capturedAt,
      reasonCode: 'provider_unavailable',
    };
  } else {
    availability = {
      status: 'unknown',
      capturedAt,
      reasonCode: 'availability_extraction_failed',
    };
  }

  return {
    schemaVersion: STAY_SNAPSHOT_SCHEMA_VERSION,
    request: input.request,
    priceForStay: price.priceForStay,
    availability,
    providerEvidence: {
      ...(availabilityText ? { availabilityText } : {}),
      ...(price.priceText ? { priceText: price.priceText } : {}),
      ...(price.chargesText ? { chargesText: price.chargesText } : {}),
      ...(alternativeRanges.length > 0 ? { alternativeRanges } : {}),
    },
  };
}
