import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseAirbnbStaySnapshot } from '../src/airbnb/stay-snapshot.js';
import { parseBookingStaySnapshot } from '../src/booking/stay-snapshot.js';
import {
  deriveStaySnapshotFreshness,
  getStayBookingEligibility,
  getStaySnapshotReadModel,
  isStaySnapshotCacheable,
  type StayRequestFingerprint,
} from '../src/stay-snapshot.js';

const CAPTURED_AT = '2026-07-26T18:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
const fixtureDir = path.resolve('tests/fixtures/booking-stay-snapshots');

function fixture(name: string): string {
  return fs.readFileSync(path.join(fixtureDir, name), 'utf8');
}

function bookingRequest(
  overrides: Partial<StayRequestFingerprint> = {},
): StayRequestFingerprint {
  return {
    platform: 'booking',
    listingId: 'us/example-property',
    checkIn: '2026-07-29',
    checkOut: '2026-08-11',
    adults: 2,
    linkedRoomId: '58743903',
    ...overrides,
  };
}

function airbnbRequest(
  overrides: Partial<StayRequestFingerprint> = {},
): StayRequestFingerprint {
  return {
    platform: 'airbnb',
    listingId: '123456789',
    checkIn: '2026-08-02',
    checkOut: '2026-08-11',
    adults: 2,
    linkedRoomId: null,
    ...overrides,
  };
}

test('Booking fixture records a fresh public stay price and exact request identity', () => {
  const request = bookingRequest({
    listingId: 'us/residence-inn-by-marriott-new-york-manhattan-central-park-new-york',
    checkIn: '2026-07-31',
  });
  const snapshot = parseBookingStaySnapshot({
    html: fixture('residence-inn-available.html'),
    request,
    capturedAt: CAPTURED_AT,
  });

  assert.deepEqual(snapshot.request, request);
  assert.deepEqual(snapshot.priceForStay, {
    amount: 18627,
    currency: 'PLN',
    basis: 'stay',
    capturedAt: CAPTURED_AT,
    source: 'booking_property_page',
    rateType: 'public',
    mandatoryChargesResolved: true,
  });
  assert.deepEqual(snapshot.availability, {
    status: 'yes',
    capturedAt: CAPTURED_AT,
    reasonCode: 'provider_room_inventory',
  });
});

test('Booking fixture distinguishes sold out from extraction failure', () => {
  const soldOut = parseBookingStaySnapshot({
    html: fixture('conrad-sold-out.html'),
    request: bookingRequest({
      listingId: 'us/e-suites-new-york-new-york-new-york',
    }),
    capturedAt: CAPTURED_AT,
  });
  assert.equal(soldOut.availability.status, 'no');
  assert.equal(soldOut.availability.reasonCode, 'provider_unavailable');
  assert.equal(soldOut.priceForStay, null);

  const extractionFailure = parseBookingStaySnapshot({
    html: fixture('extraction-unknown.html'),
    request: bookingRequest(),
    capturedAt: CAPTURED_AT,
  });
  assert.equal(extractionFailure.availability.status, 'unknown');
  assert.equal(
    extractionFailure.availability.reasonCode,
    'availability_extraction_failed',
  );
  assert.equal(isStaySnapshotCacheable(extractionFailure), false);
});

test('Booking partial inventory uses only provider-volunteered alternate ranges', () => {
  const snapshot = parseBookingStaySnapshot({
    html: fixture('residence-inn-partial.html'),
    request: bookingRequest({
      listingId: 'us/residence-inn-by-marriott-new-york-manhattan-central-park-new-york',
      checkIn: '2026-08-02',
    }),
    capturedAt: CAPTURED_AT,
  });

  assert.deepEqual(snapshot.availability, {
    status: 'partial',
    capturedAt: CAPTURED_AT,
    reasonCode: 'provider_alternative_range',
    availableRange: {
      checkIn: '2026-07-31',
      checkOut: '2026-08-11',
    },
  });
  assert.deepEqual(snapshot.providerEvidence.alternativeRanges, [
    { checkIn: '2026-07-31', checkOut: '2026-08-06' },
    { checkIn: '2026-08-01', checkOut: '2026-08-11' },
    { checkIn: '2026-07-31', checkOut: '2026-08-11' },
  ]);
});

test('Airbnb price quote stays availability-unknown and an explicit refusal is unavailable', () => {
  const quoted = parseAirbnbStaySnapshot({
    request: airbnbRequest(),
    capturedAt: CAPTURED_AT,
    currency: 'USD',
    sections: [
      {
        sectionId: 'BOOK_IT_SIDEBAR',
        section: {
          structuredDisplayPrice: {
            primaryLine: {
              price: '$1,234',
              priceQualifier: 'total',
              accessibilityLabel: '$1,234 total',
            },
            explanationData: {
              priceDetails: [
                {
                  items: [
                    { description: '9 nights x $120', priceString: '$1,080' },
                    { description: 'Total', priceString: '$1,234' },
                  ],
                },
              ],
            },
          },
        },
      },
    ],
  });
  assert.equal(quoted.availability.status, 'unknown');
  assert.equal(
    quoted.availability.reasonCode,
    'airbnb_inventory_not_verified',
  );
  assert.deepEqual(quoted.priceForStay, {
    amount: 1234,
    currency: 'USD',
    basis: 'stay',
    capturedAt: CAPTURED_AT,
    source: 'airbnb_pdp',
    rateType: 'public',
    mandatoryChargesResolved: true,
  });
  assert.equal(isStaySnapshotCacheable(quoted), true);
  const quotedReadModel = getStaySnapshotReadModel({
    snapshot: quoted,
    fallbackRequest: airbnbRequest(),
    ttlMs: DAY_MS,
    now: Date.parse(CAPTURED_AT),
  });
  assert.equal(quotedReadModel.bookingEligibility.status, 'unknown');
  assert.match(
    quotedReadModel.bookingEligibility.reason,
    /inventory could not be independently verified/,
  );

  const refused = parseAirbnbStaySnapshot({
    request: airbnbRequest(),
    capturedAt: CAPTURED_AT,
    sections: [
      {
        sectionId: 'AVAILABILITY_CALENDAR',
        section: {
          title: 'These dates are not available',
        },
      },
    ],
  });
  assert.equal(refused.availability.status, 'no');
  assert.equal(refused.availability.reasonCode, 'provider_unavailable');
  assert.equal(refused.priceForStay, null);
});

test('undated details remain cacheable without inventory evidence', () => {
  const snapshot = parseBookingStaySnapshot({
    html: fixture('extraction-unknown.html'),
    request: bookingRequest({
      checkIn: null,
      checkOut: null,
      adults: null,
      linkedRoomId: null,
    }),
    capturedAt: CAPTURED_AT,
  });

  assert.equal(snapshot.availability.status, 'unknown');
  assert.equal(snapshot.priceForStay, null);
  assert.equal(isStaySnapshotCacheable(snapshot), true);
});

test('Airbnb marks partial only when the provider volunteers alternate evidence', () => {
  const volunteered = parseAirbnbStaySnapshot({
    request: airbnbRequest(),
    capturedAt: CAPTURED_AT,
    sections: [
      {
        sectionId: 'AVAILABILITY_CALENDAR',
        section: {
          title: 'Choose different dates',
          suggestedDates: {
            checkIn: '2026-07-31',
            checkOut: '2026-08-11',
          },
        },
      },
    ],
  });
  assert.equal(volunteered.availability.status, 'partial');
  assert.deepEqual(volunteered.availability.availableRange, {
    checkIn: '2026-07-31',
    checkOut: '2026-08-11',
  });

  const rangeWithoutProviderStatement = parseAirbnbStaySnapshot({
    request: airbnbRequest(),
    capturedAt: CAPTURED_AT,
    sections: [
      {
        sectionId: 'AVAILABILITY_CALENDAR',
        section: {
          calendarWindow: {
            checkIn: '2026-07-31',
            checkOut: '2026-08-11',
          },
        },
      },
    ],
  });
  assert.equal(rangeWithoutProviderStatement.availability.status, 'unknown');

  const genericCalendarWindow = parseAirbnbStaySnapshot({
    request: airbnbRequest(),
    capturedAt: CAPTURED_AT,
    sections: [
      {
        sectionId: 'AVAILABILITY_CALENDAR',
        section: {
          title: 'Choose different dates',
          calendarWindow: {
            checkIn: '2026-07-31',
            checkOut: '2026-08-11',
          },
        },
      },
    ],
  });
  assert.equal(genericCalendarWindow.availability.status, 'partial');
  assert.equal(genericCalendarWindow.availability.availableRange, undefined);
  assert.equal(
    genericCalendarWindow.providerEvidence.alternativeRanges,
    undefined,
  );
});

test('freshness and booking eligibility are derived at read time from one TTL', () => {
  assert.equal(
    deriveStaySnapshotFreshness(CAPTURED_AT, DAY_MS, Date.parse(CAPTURED_AT) + DAY_MS),
    'fresh',
  );
  assert.equal(
    deriveStaySnapshotFreshness(
      CAPTURED_AT,
      DAY_MS,
      Date.parse(CAPTURED_AT) + DAY_MS + 1,
    ),
    'stale',
  );

  const unavailable = {
    status: 'no' as const,
    capturedAt: CAPTURED_AT,
    reasonCode: 'provider_unavailable',
  };
  assert.deepEqual(
    getStayBookingEligibility(unavailable, 'fresh'),
    {
      status: 'excluded',
      actionable: false,
      reasonCode: 'provider_unavailable',
      reason: 'Not available for the recorded dates and guest count.',
    },
  );
  assert.equal(
    getStayBookingEligibility(unavailable, 'stale').status,
    'conditional',
  );
});

test('legacy details invent neither capture time nor availability', () => {
  const request = bookingRequest();
  const readModel = getStaySnapshotReadModel({
    snapshot: {
      oldPriceText: '$500',
    },
    fallbackRequest: request,
    ttlMs: DAY_MS,
    now: Date.parse(CAPTURED_AT),
  });

  assert.equal(readModel.legacy, true);
  assert.equal(readModel.priceForStay, null);
  assert.deepEqual(readModel.availability, {
    status: 'unknown',
    capturedAt: null,
    reasonCode: 'legacy_snapshot_missing',
  });
  assert.deepEqual(readModel.freshness, {
    price: 'unknown',
    availability: 'unknown',
  });
  assert.equal(readModel.bookingEligibility.status, 'unknown');
});
