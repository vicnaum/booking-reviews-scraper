import test from 'node:test';
import assert from 'node:assert/strict';

import { __bookingSearchTestUtils } from '../src/booking/search.js';
import type { BookingSearchParams } from '../src/search/types.js';

const baseParams: BookingSearchParams = {
  platform: 'booking',
  location: 'London',
  adults: 2,
  currency: 'USD',
};

test('Booking filter string always enforces only-available properties', () => {
  const filters = __bookingSearchTestUtils.buildFilterString({
    ...baseParams,
    propertyType: 'entire',
    priceMax: 5800,
  });

  assert.match(filters, /^oos=1(?:;|$)/);
  assert.match(filters, /privacy_type=3/);
  assert.match(filters, /price=USD-min-5800-1/);
});

test('MapMarkers template search clears carried hotelIds for fresh bbox searches', () => {
  const body = __bookingSearchTestUtils.buildMapMarkersBody(
    {
      ...baseParams,
      boundingBox: { neLat: 51.52, neLng: -0.12, swLat: 51.50, swLng: -0.16 },
    },
    {
      cookies: 'a=b',
      headers: {},
      destId: -2601889,
      graphqlUrl: 'https://www.booking.com/dml/graphql',
      refererUrl: 'https://www.booking.com/searchresults.en-gb.html',
      mapMarkersTemplate: {
        operationName: 'MapMarkersDesktop',
        variables: {
          input: {
            filters: { selectedFilters: 'review_score=70' },
            location: {
              destType: 'BOUNDING_BOX',
              hotelIds: [111, 222, 333],
              initialDestination: { destType: 'CITY', destId: -2601889 },
            },
            pagination: { rowsPerPage: 100, offset: 0 },
          },
          markersInput: {
            boundingBox: {
              northEast: { latitude: 0, longitude: 0 },
              southWest: { latitude: 0, longitude: 0 },
              precision: 1,
            },
          },
        },
      },
    },
    { neLat: 51.52, neLng: -0.12, swLat: 51.50, swLng: -0.16 },
    0,
  );

  assert.deepEqual(body.variables.input.location.hotelIds, []);
  assert.match(body.variables.input.filters.selectedFilters, /^oos=1(?:;|$)/);
});

test('Subdivision signal uses raw and reported density, not only filtered counts', () => {
  assert.equal(__bookingSearchTestUtils.getSubdivisionSignal(4, 17, 64), 64);
  assert.equal(__bookingSearchTestUtils.getSubdivisionSignal(12, 0, 0), 12);
});
