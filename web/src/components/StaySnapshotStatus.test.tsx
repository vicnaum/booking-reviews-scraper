import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StaySnapshotReadModel } from '@cli/stay-snapshot';
import StaySnapshotStatus, { formatSnapshotAge } from './StaySnapshotStatus.js';

function snapshot(
  overrides: Partial<StaySnapshotReadModel> = {},
): StaySnapshotReadModel {
  return {
    schemaVersion: 1,
    request: {
      platform: 'booking',
      listingId: 'us/example',
      checkIn: '2026-07-29',
      checkOut: '2026-08-11',
      adults: 2,
      linkedRoomId: null,
    },
    priceForStay: {
      amount: 18627,
      currency: 'PLN',
      basis: 'stay',
      capturedAt: '2026-07-26T18:00:00.000Z',
      source: 'booking_property_page',
      rateType: 'public',
      mandatoryChargesResolved: true,
    },
    availability: {
      status: 'yes',
      capturedAt: '2026-07-26T18:00:00.000Z',
      reasonCode: 'provider_room_inventory',
    },
    providerEvidence: {},
    legacy: false,
    freshness: {
      price: 'fresh',
      availability: 'fresh',
    },
    bookingEligibility: {
      status: 'eligible',
      actionable: true,
      reasonCode: 'available',
      reason: 'Available for the recorded dates and guest count.',
    },
    refreshAttempt: null,
    ...overrides,
  };
}

test('stay snapshot shows exact dates, public total, availability, and disclaimer', () => {
  const html = renderToStaticMarkup(
    <StaySnapshotStatus snapshot={snapshot()} />,
  );

  assert.match(html, /2026-07-29/);
  assert.match(html, /2026-08-11/);
  assert.match(html, /2 adults/);
  assert.match(html, /PLN/);
  assert.match(html, /18,627/);
  assert.match(html, /public rate/);
  assert.match(html, /Availability:/);
  assert.match(html, /Signed-in or Genius prices may be lower/);
});

test('failed refresh explains that the last known stale snapshot was preserved', () => {
  const html = renderToStaticMarkup(
    <StaySnapshotStatus
      snapshot={snapshot({
        freshness: {
          price: 'stale',
          availability: 'stale',
        },
        bookingEligibility: {
          status: 'conditional',
          actionable: false,
          reasonCode: 'availability_stale',
          reason: 'Last known availability (yes) is stale.',
        },
        refreshAttempt: {
          attemptedAt: '2026-07-26T19:00:00.000Z',
          status: 'failed',
          error: 'provider timeout',
        },
      })}
    />,
  );

  assert.match(html, /Last known price/);
  assert.match(html, /Latest refresh failed/);
  assert.match(html, /provider timeout/);
  assert.match(html, /last known snapshot preserved/i);
});

test('snapshot age uses compact user-facing units', () => {
  assert.equal(
    formatSnapshotAge(
      '2026-07-26T18:00:00.000Z',
      Date.parse('2026-07-26T21:00:00.000Z'),
    ),
    '3h ago',
  );
  assert.equal(formatSnapshotAge(null), null);
});
