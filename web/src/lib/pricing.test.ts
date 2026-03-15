import test from 'node:test';
import assert from 'node:assert/strict';
import type { SearchResult } from '@/types';
import { getPriceDisplayInfo, resolveComparablePrice } from './pricing';

function makeResult(pricing: SearchResult['pricing']): SearchResult {
  return {
    id: 'listing-1',
    platform: 'airbnb',
    name: 'Test listing',
    url: 'https://example.com',
    rating: 4.9,
    reviewCount: 12,
    pricing,
    coordinates: null,
    propertyType: 'Entire place',
    photoUrl: null,
  };
}

test('exact nightly and total prices stay explicit in both display modes', () => {
  const result = makeResult({
    nightly: { amount: 167.53, currency: 'USD', source: 'upstream' },
    total: { amount: 1413.21, currency: 'USD', source: 'upstream' },
    display: { amount: 1414, currency: 'USD', basis: 'stay', source: 'displayed' },
  });

  const total = getPriceDisplayInfo(result, 'total', {
    checkin: '2026-03-20',
    checkout: '2026-03-29',
  });
  const nightly = getPriceDisplayInfo(result, 'perNight', {
    checkin: '2026-03-20',
    checkout: '2026-03-29',
  });

  assert.equal(total.primary, '$1413 total');
  assert.equal(total.secondary, '$168 per night');
  assert.equal(nightly.primary, '$168 per night');
  assert.equal(nightly.secondary, '$1413 total');
});

test('derived nightly prices stay clear without prefix noise', () => {
  const result = makeResult({
    nightly: null,
    total: { amount: 8454.61, currency: 'PLN', source: 'upstream' },
    display: { amount: 8455, currency: 'PLN', basis: 'stay', source: 'upstream' },
  });

  const nightly = getPriceDisplayInfo(result, 'perNight', {
    checkin: '2026-03-20',
    checkout: '2026-03-29',
  });
  const total = getPriceDisplayInfo(result, 'total', {
    checkin: '2026-03-20',
    checkout: '2026-03-29',
  });

  assert.equal(nightly.primary, 'PLN 939 per night');
  assert.equal(nightly.secondary, 'PLN 8455 total');
  assert.equal(total.primary, 'PLN 8455 total');
  assert.equal(total.secondary, 'PLN 939 per night');
});

test('total-only displayed prices no longer show the same amount as both total and per-night', () => {
  const result = makeResult({
    nightly: null,
    total: { amount: 1554, currency: 'USD', source: 'displayed' },
    display: { amount: 1554, currency: 'USD', basis: 'stay', source: 'displayed' },
  });

  const total = getPriceDisplayInfo(result, 'total', {
    checkin: '2026-03-20',
    checkout: '2026-03-29',
  });
  const nightly = getPriceDisplayInfo(result, 'perNight', {
    checkin: '2026-03-20',
    checkout: '2026-03-29',
  });

  assert.equal(total.primary, '$1554 total');
  assert.equal(total.secondary, '$173 per night');
  assert.equal(nightly.primary, '$173 per night');
  assert.equal(nightly.secondary, '$1554 total');
  assert.equal(
    resolveComparablePrice(result, 'perNight', {
      checkin: '2026-03-20',
      checkout: '2026-03-29',
    })?.amount,
    172.66666666666666,
  );
});
