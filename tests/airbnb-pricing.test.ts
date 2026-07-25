import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAirbnbPricingQuote,
  parseAirbnbStructuredDisplayPrice,
} from '../src/airbnb/pricing.js';

const apiPricingQuoteFixture = {
  rate: { amount: 1414, is_micros_accuracy: false },
  structured_stay_display_price: {
    primary_line: {
      price: '$1,414',
      qualifier: 'total',
      accessibility_label: '$1,414 total',
    },
    explanation_data: {
      price_details: [
        {
          items: [
            {
              description: '9 nights x $167.53',
              price_string: '$1,507.74',
            },
            {
              description: 'Weekly stay discount',
              price_string: '-$94.53',
            },
          ],
        },
        {
          items: [
            {
              description: 'Total',
              price_string: '$1,413.21',
              accessibility_label: '$1,413.21 total',
            },
          ],
          render_border_top: true,
        },
      ],
    },
  },
};

const ssrStructuredDisplayPriceFixture = {
  primaryLine: {
    accessibilityLabel: '$1,414 total',
    price: '$1,414',
    qualifier: 'total',
  },
  explanationData: {
    priceDetails: [
      {
        items: [
          {
            description: '9 nights x $167.53',
            priceString: '$1,507.74',
          },
          {
            description: 'Weekly stay discount',
            priceString: '-$94.53',
          },
        ],
      },
      {
        items: [
          {
            description: 'Total',
            priceString: '$1,413.21',
            accessibilityLabel: '$1,413.21 total',
          },
        ],
      },
    ],
  },
};

test('Airbnb API pricing quote stays total-first and extracts nightly from breakdown', () => {
  const pricing = parseAirbnbPricingQuote(apiPricingQuoteFixture, 'USD');
  assert.ok(pricing);
  assert.equal(pricing.total?.amount, 1413.21);
  assert.equal(pricing.total?.currency, 'USD');
  assert.equal(pricing.total?.source, 'upstream');
  assert.equal(pricing.nightly?.amount, 167.53);
  assert.equal(pricing.nightly?.source, 'upstream');
  assert.equal(pricing.display?.amount, 1414);
  assert.equal(pricing.display?.basis, 'stay');
  assert.equal(pricing.display?.source, 'displayed');
});

test('Airbnb SSR structured display price keeps total and nightly semantics distinct', () => {
  const pricing = parseAirbnbStructuredDisplayPrice(
    ssrStructuredDisplayPriceFixture,
    'USD',
  );
  assert.ok(pricing);
  assert.equal(pricing.total?.amount, 1413.21);
  assert.equal(pricing.nightly?.amount, 167.53);
  assert.equal(pricing.display?.amount, 1414);
  assert.equal(pricing.display?.basis, 'stay');
});

test('Airbnb SSR derives a stay total from nightly pricing when dates are known', () => {
  const pricing = parseAirbnbStructuredDisplayPrice(
    {
      primaryLine: {
        accessibilityLabel: '$156 per night',
        price: '$156',
        qualifier: 'night',
      },
      explanationData: {
        priceDetails: [
          {
            items: [
              {
                description: '12 nights x $156.46',
                priceString: '$1,877.52',
              },
            ],
          },
        ],
      },
    },
    'USD',
    12,
  );

  assert.ok(pricing);
  assert.equal(pricing.nightly?.amount, 156.46);
  assert.equal(pricing.total?.amount, 1877.52);
  assert.equal(pricing.total?.source, 'derived');
  assert.equal(pricing.display?.basis, 'night');
});

test('Airbnb SSR treats a multi-night display qualifier as a stay total', () => {
  const pricing = parseAirbnbStructuredDisplayPrice(
    {
      primaryLine: {
        accessibilityLabel: '$1,935 for 12 nights',
        price: '$1,935',
        qualifier: 'for 12 nights',
      },
      explanationData: {
        priceDetails: [
          {
            items: [
              {
                description: '12 nights x $156.46',
                priceString: '$1,877.52',
              },
            ],
          },
        ],
      },
    },
    'USD',
    12,
  );

  assert.ok(pricing);
  assert.equal(pricing.nightly?.amount, 156.46);
  assert.equal(pricing.total?.amount, 1935);
  assert.equal(pricing.total?.source, 'displayed');
  assert.equal(pricing.display?.basis, 'stay');
});

test('Airbnb SSR reads totals from ordered display price components', () => {
  const pricing = parseAirbnbStructuredDisplayPrice(
    {
      primaryLine: {
        accessibilityLabel: '$638 total',
        orderedComponents: [
          {
            discountedPrice: '$638',
          },
          {
            qualifier: 'total',
          },
        ],
      },
      explanationData: {
        priceDetails: [
          {
            items: [
              {
                description: '2 nights x $253.00',
                priceString: '$506.00',
              },
            ],
          },
        ],
      },
    },
    'USD',
    2,
  );

  assert.ok(pricing);
  assert.equal(pricing.nightly?.amount, 253);
  assert.equal(pricing.total?.amount, 638);
  assert.equal(pricing.total?.source, 'displayed');
  assert.equal(pricing.display?.amount, 638);
  assert.equal(pricing.display?.basis, 'stay');
});
