import {
  detectCurrencyFromText,
  getStayNights,
} from '../search/pricing.js';
import { parseAirbnbStructuredDisplayPrice } from './pricing.js';
import {
  STAY_SNAPSHOT_SCHEMA_VERSION,
  type StayDateRange,
  type StayRequestFingerprint,
  type StaySnapshot,
} from '../stay-snapshot.js';

function findSection(sections: any[], sectionId: string): any | null {
  const match = sections.find((item) => item?.sectionId === sectionId);
  return match?.section ?? null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function collectStrings(
  value: unknown,
  output: string[],
  depth = 0,
): void {
  if (depth > 8 || value == null) return;
  if (typeof value === 'string') {
    const cleaned = cleanText(value);
    if (cleaned) output.push(cleaned);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStrings(item, output, depth + 1);
    }
  }
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  );
}

function collectVolunteeredDateRanges(
  value: unknown,
  output: StayDateRange[],
  depth = 0,
  volunteered = false,
): void {
  if (depth > 8 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectVolunteeredDateRanges(item, output, depth + 1, volunteered);
    }
    return;
  }
  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const checkIn = record.checkIn ?? record.check_in;
  const checkOut = record.checkOut ?? record.check_out;
  if (volunteered && isIsoDate(checkIn) && isIsoDate(checkOut)) {
    output.push({ checkIn, checkOut });
  }
  for (const [key, item] of Object.entries(record)) {
    const normalizedKey = key.replace(/[_-]/g, '');
    const isVolunteeredRange =
      volunteered
      || /(?:suggest|alternative|alternate|recommend|availablerange|dateoption)/i
        .test(normalizedKey);
    collectVolunteeredDateRanges(
      item,
      output,
      depth + 1,
      isVolunteeredRange,
    );
  }
}

function uniqueRanges(
  ranges: StayDateRange[],
  request: StayRequestFingerprint,
): StayDateRange[] {
  const requestedKey = `${request.checkIn ?? ''}/${request.checkOut ?? ''}`;
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.checkIn}/${range.checkOut}`;
    if (key === requestedKey || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectAlternativeRange(
  ranges: StayDateRange[],
  request: StayRequestFingerprint,
): StayDateRange | undefined {
  const requestedNights = getStayNights(request.checkIn, request.checkOut) ?? 0;
  return [...ranges].sort((left, right) => {
    const leftSameCheckout = left.checkOut === request.checkOut ? 1 : 0;
    const rightSameCheckout = right.checkOut === request.checkOut ? 1 : 0;
    if (leftSameCheckout !== rightSameCheckout) {
      return rightSameCheckout - leftSameCheckout;
    }
    const leftNights = getStayNights(left.checkIn, left.checkOut) ?? 0;
    const rightNights = getStayNights(right.checkIn, right.checkOut) ?? 0;
    const leftCovers = leftNights >= requestedNights ? 1 : 0;
    const rightCovers = rightNights >= requestedNights ? 1 : 0;
    if (leftCovers !== rightCovers) return rightCovers - leftCovers;
    return rightNights - leftNights
      || left.checkIn.localeCompare(right.checkIn);
  })[0];
}

function getStructuredPriceEvidence(structuredDisplayPrice: any): {
  text: string;
  chargesText: string;
  mandatoryChargesResolved: boolean;
} {
  const strings: string[] = [];
  collectStrings(structuredDisplayPrice?.primaryLine, strings);
  collectStrings(structuredDisplayPrice?.secondaryLine, strings);

  const details =
    structuredDisplayPrice?.explanationData?.priceDetails
    ?? structuredDisplayPrice?.explanation_data?.price_details
    ?? [];
  const chargeLabels: string[] = [];
  if (Array.isArray(details)) {
    for (const group of details) {
      const items = Array.isArray(group?.items) ? group.items : [];
      for (const item of items) {
        const description =
          typeof item?.description === 'string'
            ? cleanText(item.description)
            : '';
        if (description) chargeLabels.push(description);
      }
    }
  }

  const exactTotal = chargeLabels.find(
    (label) => /^total$/i.test(label),
  );
  return {
    text: [...new Set(strings)].join(' · '),
    chargesText: [...new Set(chargeLabels)].join(' · '),
    mandatoryChargesResolved: !!exactTotal,
  };
}

export function parseAirbnbStaySnapshot(input: {
  sections: any[];
  request: StayRequestFingerprint;
  capturedAt?: string;
  currency?: string;
}): StaySnapshot {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const hasExactDates = !!(input.request.checkIn && input.request.checkOut);
  const bookItSection = findSection(input.sections, 'BOOK_IT_SIDEBAR');
  const relevantSections = input.sections.filter((item) =>
    /BOOK_IT|AVAILABILITY|CALENDAR|URGENCY_COMMITMENT/i.test(
      String(item?.sectionId ?? item?.section?.__typename ?? ''),
    ));
  const providerStrings: string[] = [];
  collectStrings(relevantSections, providerStrings);
  const providerText = [...new Set(providerStrings)].join(' · ');
  const explicitNoText = providerStrings.find((text) =>
    /(?:dates? (?:are|is) not available|not available for (?:these|your) dates|unavailable for (?:these|your) dates|no longer available|sold out)/i
      .test(text));
  const explicitPartialText = providerStrings.find((text) =>
    /(?:some dates? (?:are|is) not available|choose different dates|available for part of)/i
      .test(text));

  const rawRanges: StayDateRange[] = [];
  for (const section of relevantSections) {
    collectVolunteeredDateRanges(section, rawRanges);
  }
  const alternativeRanges = uniqueRanges(rawRanges, input.request);
  const availableRange = selectAlternativeRange(
    alternativeRanges,
    input.request,
  );

  const structuredDisplayPrice = bookItSection?.structuredDisplayPrice;
  const priceEvidence = getStructuredPriceEvidence(structuredDisplayPrice);
  const detectedCurrency = detectCurrencyFromText(
    priceEvidence.text,
    input.currency?.toUpperCase() || 'USD',
  );
  const pricing = hasExactDates
    ? parseAirbnbStructuredDisplayPrice(
        structuredDisplayPrice,
        detectedCurrency,
        getStayNights(input.request.checkIn, input.request.checkOut),
      )
    : null;
  const total = pricing?.total;
  const priceForStay =
    total && /^[A-Z]{3}$/.test(total.currency)
      ? {
          amount: total.amount,
          currency: total.currency,
          basis: 'stay' as const,
          capturedAt,
          source: 'airbnb_pdp',
          rateType: 'public' as const,
          mandatoryChargesResolved:
            priceEvidence.mandatoryChargesResolved,
        }
      : null;

  let availability: StaySnapshot['availability'];
  if (!hasExactDates) {
    availability = {
      status: 'unknown',
      capturedAt,
      reasonCode: 'dates_not_requested',
    };
  } else if ((explicitNoText || explicitPartialText) && availableRange) {
    availability = {
      status: 'partial',
      capturedAt,
      reasonCode: 'provider_alternative_range',
      availableRange,
    };
  } else if (explicitPartialText) {
    availability = {
      status: 'partial',
      capturedAt,
      reasonCode: 'provider_partial_inventory',
    };
  } else if (explicitNoText) {
    availability = {
      status: 'no',
      capturedAt,
      reasonCode: 'provider_unavailable',
    };
  } else {
    availability = {
      status: 'unknown',
      capturedAt,
      reasonCode: priceForStay
        ? 'airbnb_inventory_not_verified'
        : 'availability_extraction_failed',
    };
  }

  return {
    schemaVersion: STAY_SNAPSHOT_SCHEMA_VERSION,
    request: input.request,
    priceForStay,
    availability,
    providerEvidence: {
      ...((explicitNoText || explicitPartialText)
        ? { availabilityText: explicitNoText ?? explicitPartialText }
        : providerText
          ? { availabilityText: providerText.slice(0, 1_000) }
          : {}),
      ...(priceEvidence.text ? { priceText: priceEvidence.text } : {}),
      ...(priceEvidence.chargesText
        ? { chargesText: priceEvidence.chargesText }
        : {}),
      ...(alternativeRanges.length > 0 ? { alternativeRanges } : {}),
    },
  };
}
