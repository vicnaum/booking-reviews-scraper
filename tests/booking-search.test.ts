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

test('Booking filter string forwards minBedrooms to Booking bedroom filters', () => {
  const filters = buildFilterString(
    makeParams({
      minBedrooms: 2,
    }),
  );

  assert.match(filters, /(^|;)privacy_type=3($|;)/);
  assert.match(filters, /(^|;)entire_place_bedroom_count=2($|;)/);
});

test('Booking filter string keeps only-available properties when other filters are present', () => {
  const filters = buildFilterString(
    makeParams({
      priceMin: 100,
      priceMax: 5800,
      minBedrooms: 2,
      propertyType: 'entire',
      freeCancellation: true,
      stars: [4, 5],
    }),
  );

  assert.match(filters, /(^|;)oos=1($|;)/);
  assert.match(filters, /(^|;)entire_place_bedroom_count=2($|;)/);
  assert.match(filters, /(^|;)privacy_type=3($|;)/);
  assert.match(filters, /(^|;)fc=2($|;)/);
  assert.match(filters, /(^|;)class=4($|;)/);
  assert.match(filters, /(^|;)class=5($|;)/);
  assert.match(filters, /(^|;)price=USD-100-5800-1($|;)/);
});

test('Booking bedroom filter does not override explicit private-room searches', () => {
  const filters = buildFilterString(
    makeParams({
      propertyType: 'private',
      minBedrooms: 2,
    }),
  );

  assert.match(filters, /(^|;)privacy_type=1($|;)/);
  assert.doesNotMatch(filters, /(^|;)privacy_type=3($|;)/);
  assert.doesNotMatch(filters, /(^|;)entire_place_bedroom_count=2($|;)/);
});

// --- FullSearch / AutoComplete (2026-11 rework) ---

import { __bookingSearchTestUtils as utils } from '../src/booking/search.js';

function suggestion(destType: string, destId: string, title: string, components: Array<[string, string]>) {
  return {
    destType,
    destId,
    title,
    label: [title, ...components.slice(1).map(([name]) => name)].join(', '),
    components: components.map(([name, type]) => ({ name, type })),
  };
}

test('AutoComplete picks a destination matching every query word, ignoring region names', () => {
  const gdyniaDistrict = suggestion('DISTRICT', '4713', 'Śródmieście', [
    ['Śródmieście', 'DISTRICT'], ['Gdynia', 'CITY'], ['Pomerania (Gulf of Gdansk)', 'REGION'], ['Poland', 'COUNTRY'],
  ]);
  const hotel = suggestion('HOTEL', '16294984', 'Studio Gdańsk Śródmieście', [
    ['Studio Gdańsk Śródmieście', 'HOTEL'], ['Gdańsk', 'CITY'], ['Pomerania', 'REGION'], ['Poland', 'COUNTRY'],
  ]);
  assert.equal(utils.pickAutocompleteDestination('Gdańsk Śródmieście', [gdyniaDistrict, hotel]), null);

  const oldTown = suggestion('DISTRICT', '6744', 'Old Town', [
    ['Old Town', 'DISTRICT'], ['Gdańsk', 'CITY'], ['Pomerania', 'REGION'], ['Poland', 'COUNTRY'],
  ]);
  const picked = utils.pickAutocompleteDestination('gdansk old town', [hotel, oldTown]);
  assert.equal(picked?.destId, '6744');
  assert.equal(picked?.destType, 'DISTRICT');
});

test('AutoComplete response parsing and query variants', () => {
  const parsed = utils.parseAutocompleteResponse({
    data: { autoCompleteSuggestions: { results: [{
      destination: { destId: '-501400', destType: 'CITY', latitude: 54.35, longitude: 18.65 },
      displayInfo: { title: 'Gdańsk', label: 'Gdańsk, Pomerania, Poland', labelComponents: [{ name: 'Gdańsk', type: 'CITY' }] },
    }] } },
  });
  assert.equal(parsed[0].destId, '-501400');
  assert.equal(utils.pickAutocompleteDestination('Gdansk', parsed)?.destType, 'CITY');
  assert.deepEqual(utils.autocompleteQueryVariants('Gdańsk Old Town'), [
    'Gdańsk Old Town', 'Old Town, Gdańsk', 'Town, Gdańsk Old',
  ]);
  assert.deepEqual(utils.autocompleteQueryVariants('Old Town, Gdańsk'), ['Old Town, Gdańsk']);
});

const TEMPLATE = {
  operationName: 'FullSearch' as const,
  query: 'query FullSearch($input: SearchQueryInput!) { searchQueries { search(input: $input) { __typename } } }',
  extensions: {},
  variables: {
    input: {
      dates: { checkin: '2026-01-01', checkout: '2026-01-02' },
      flexibleDatesConfig: { dateRangeCalendar: { checkin: ['2026-01-01'], checkout: ['2026-01-02'] } },
      location: { searchString: 'Old Town', destType: 'DISTRICT', destId: 6744 },
      pagination: { rowsPerPage: 15, offset: 15 },
      filters: {},
      sorters: { selectedSorter: null },
      nbAdults: 1,
    },
  },
};

test('FullSearch body keeps the captured query text and applies location, dates, filters, paging', () => {
  const params = makeParams({ checkin: '2026-12-08', checkout: '2026-12-10', currency: 'PLN', maxResults: 300 });
  const body = utils.buildFullSearchBody(
    TEMPLATE,
    params,
    { kind: 'destination', destination: { destId: '-501400', destType: 'CITY', label: 'Gdańsk' } },
    200,
  );
  assert.equal(body.query, TEMPLATE.query);
  assert.deepEqual(body.variables.input.location, { searchString: 'Gdańsk', destType: 'CITY', destId: -501400 });
  assert.deepEqual(body.variables.input.dates, { checkin: '2026-12-08', checkout: '2026-12-10' });
  assert.deepEqual(body.variables.input.pagination, { rowsPerPage: 100, offset: 200 });
  assert.equal(body.variables.input.nbAdults, 2);
  assert.match(body.variables.input.filters.selectedFilters, /(^|;)oos=1($|;)/);
  assert.equal(TEMPLATE.variables.input.pagination.offset, 15, 'template is not mutated');
});

test('FullSearch bbox body uses BOUNDING_BOX with the template destination as initialDestination', () => {
  const bbox = { neLat: 54.3545, neLng: 18.67, swLat: 54.3345, swLng: 18.65 };
  const body = utils.buildFullSearchBody(TEMPLATE, makeParams(), { kind: 'bbox', bbox }, 0);
  assert.equal(body.variables.input.location.destType, 'BOUNDING_BOX');
  assert.deepEqual(body.variables.input.location.boundingBox, {
    neLat: 54.3545, neLon: 18.67, swLat: 54.3345, swLon: 18.65, precision: 1,
  });
  assert.deepEqual(body.variables.input.location.initialDestination, { destType: 'DISTRICT', destId: 6744 });
});

test('FullSearch payload parsing keeps bbox strict and extracts price, score, host type', () => {
  const bbox = { neLat: 54.3545, neLng: 18.67, swLat: 54.3345, swLng: 18.65 };
  const result = (id: number, lat: number, lng: number) => ({
    basicPropertyData: {
      id,
      pageName: `p${id}`,
      location: { countryCode: 'pl', latitude: lat, longitude: lng },
      reviewScore: { score: 8.8, reviewCount: 3867 },
      accommodationTypeId: 201,
    },
    displayName: { text: `Property ${id}` },
    hostTraderLabel: 'PRIVATE',
    priceDisplayInfoIrene: { displayPrice: { amountPerStay: { amount: '523.84 zł', amountUnformatted: 523.84, currency: 'PLN' } } },
  });
  const page = utils.parseFullSearchPayload({
    data: { searchQueries: { search: {
      pagination: { nbResultsTotal: 987 },
      results: [result(1, 54.344, 18.66), result(2, 54.40, 18.66)],
    } } },
  }, makeParams({ checkin: '2026-12-08', checkout: '2026-12-10', currency: 'PLN' }), bbox);
  assert.equal(page.totalResults, 987);
  assert.equal(page.rawResultsCount, 2);
  assert.equal(page.results.length, 1);
  const [first] = page.results;
  assert.equal(first.url, 'https://www.booking.com/hotel/pl/p1.html');
  assert.equal(first.rating, 8.8);
  assert.equal(first.reviewCount, 3867);
  assert.equal(first.hostType, 'PRIVATE');
  assert.equal(first.pricing?.total?.amount, 523.84);
  assert.equal(first.pricing?.nightly?.amount, 261.92);
});

test('Booking search URLs keep dest_type and use lat/long pages for bbox searches', () => {
  const params = makeParams({ checkin: '2026-12-08', checkout: '2026-12-10', currency: 'PLN' });
  const district = new URL(utils.buildSearchUrl(params, {
    kind: 'destination', destination: { destId: '6744', destType: 'DISTRICT', label: 'Old Town' },
  }));
  assert.equal(district.searchParams.get('dest_type'), 'district');
  assert.equal(district.searchParams.get('dest_id'), '6744');
  const box = new URL(utils.buildSearchUrl(params, {
    kind: 'bbox', bbox: { neLat: 54.3545, neLng: 18.67, swLat: 54.3345, swLng: 18.65 },
  }));
  assert.equal(box.searchParams.get('dest_type'), 'latlong');
  assert.equal(box.searchParams.get('latitude'), '54.34450');
});

test('ensureMinBbox grows point-like geocodes', () => {
  const grown = utils.ensureMinBbox({ neLat: 54.3469, neLng: 18.6444, swLat: 54.3468, swLng: 18.6443 }, 1000);
  assert.ok(grown.neLat - grown.swLat > 0.008);
  assert.ok(grown.neLng - grown.swLng > 0.014);
});

test('FullSearch body points rawQueryForSession at the current session URL', () => {
  const sessionUrl = 'https://www.booking.com/searchresults.en-gb.html?dest_id=-501400&dest_type=city&checkin=2026-12-08';
  const body = utils.buildFullSearchBody(
    { ...TEMPLATE, variables: { input: { ...TEMPLATE.variables.input, rawQueryForSession: '/searchresults.html?dest_id=6744' } } },
    makeParams(),
    { kind: 'destination', destination: { destId: '-501400', destType: 'CITY', label: 'Gdańsk' } },
    0,
    100,
    sessionUrl,
  );
  assert.equal(body.variables.input.rawQueryForSession, '/searchresults.en-gb.html?dest_id=-501400&dest_type=city&checkin=2026-12-08');
});

test('Booking search fails closed without a proxy unless explicitly opted out', () => {
  assert.throws(() => utils.assertProxyPolicy({ USE_PROXY: 'false' }), /needs a proxy/);
  assert.throws(() => utils.assertProxyPolicy({}), /needs a proxy/);
  assert.doesNotThrow(() => utils.assertProxyPolicy({ USE_PROXY: 'false', REVIEWR_NO_PROXY: 'true' }));
  assert.doesNotThrow(() => utils.assertProxyPolicy({ BOOKING_ALLOW_NO_PROXY: 'true' }));
  assert.doesNotThrow(() => utils.assertProxyPolicy({ PROXY_HOST: 'proxy.example' }));
});
