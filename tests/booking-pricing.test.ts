import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBookingCardPricing,
  parseBookingGraphQLPricing,
} from '../src/booking/pricing.js';

test('Booking GraphQL pricing stores total explicitly and nightly as derived', () => {
  const pricing = parseBookingGraphQLPricing(
    {
      amountPerStay: {
        amount: '8,454.61 zł',
        amountRounded: '8,455 zł',
      },
    },
    'USD',
    9,
  );

  assert.ok(pricing);
  assert.equal(pricing.total?.amount, 8454.61);
  assert.equal(pricing.total?.currency, 'PLN');
  assert.equal(pricing.total?.source, 'upstream');
  assert.ok(pricing.nightly);
  assert.equal(pricing.nightly?.currency, 'PLN');
  assert.equal(pricing.nightly?.source, 'derived');
  assert.ok(Math.abs((pricing.nightly?.amount ?? 0) - 939.4011111111112) < 0.000001);
  assert.equal(pricing.display?.basis, 'stay');
});

test('Booking SSR card pricing stays in the total bucket instead of pretending to be nightly', () => {
  const pricing = parseBookingCardPricing('8,455 zł', 'USD');
  assert.ok(pricing);
  assert.equal(pricing.total?.amount, 8455);
  assert.equal(pricing.total?.currency, 'PLN');
  assert.equal(pricing.total?.source, 'displayed');
  assert.equal(pricing.nightly, null);
  assert.equal(pricing.display?.basis, 'stay');
});
