import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFilterString } from '../src/booking/search.js';
import type { BookingSearchParams } from '../src/search/types.js';

function makeParams(overrides: Partial<BookingSearchParams> = {}): BookingSearchParams {
  return {
    platform: 'booking',
    location: 'London',
    adults: 2,
    currency: 'USD',
    ...overrides,
  };
}

test('Booking filter string always enforces only-available properties', () => {
  const filters = buildFilterString(makeParams());
  assert.match(filters, /(^|;)oos=1($|;)/);
});

test('Booking filter string keeps only-available properties when other filters are present', () => {
  const filters = buildFilterString(
    makeParams({
      priceMin: 100,
      priceMax: 5800,
      propertyType: 'entire',
      freeCancellation: true,
      stars: [4, 5],
    }),
  );

  assert.match(filters, /(^|;)oos=1($|;)/);
  assert.match(filters, /(^|;)privacy_type=3($|;)/);
  assert.match(filters, /(^|;)fc=2($|;)/);
  assert.match(filters, /(^|;)class=4($|;)/);
  assert.match(filters, /(^|;)class=5($|;)/);
  assert.match(filters, /(^|;)price=USD-100-5800-1($|;)/);
});
