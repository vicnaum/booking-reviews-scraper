import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAirbnb } from '../src/airbnb/search.js';
import type { SearchPage } from '../src/search/types.js';

function makeSsrSearchHtml(): string {
  const listingId = Buffer.from('StayListing:123456789').toString('base64');
  const deferredState = {
    niobeClientData: [
      [
        'StaysSearch',
        {
          data: {
            presentation: {
              staysSearch: {
                mapResults: {
                  mapSearchResults: [
                    {
                      demandStayListing: {
                        id: listingId,
                        roomType: 'Entire home',
                        location: {
                          coordinate: {
                            latitude: 40.758,
                            longitude: -73.9855,
                          },
                        },
                      },
                      title: 'Midtown test stay',
                      avgRatingLocalized: '4.91 (123)',
                      contextualPictures: [{ picture: 'https://example.com/listing.jpg' }],
                      structuredContent: {
                        primaryLine: [{ body: '2 bedrooms' }, { body: '3 beds' }],
                      },
                      badges: [
                        {
                          text: 'Superhost',
                          loggingContext: { badgeType: 'SUPERHOST' },
                        },
                      ],
                    },
                  ],
                },
                results: {
                  paginationInfo: {
                    nextPageCursor: null,
                  },
                },
              },
            },
          },
        },
      ],
    ],
  };

  return `<html><script id="data-deferred-state-0">${JSON.stringify(deferredState)}</script></html>`;
}

test('Airbnb quick search uses SSR staysSearch directly without API-key retries', async () => {
  const requests: Array<{
    url: string;
    maxRetries: number | undefined;
    headers: Record<string, string> | undefined;
  }> = [];
  const pages: SearchPage[] = [];

  const output = await searchAirbnb(
    {
      platform: 'airbnb',
      location: 'New York',
      boundingBox: {
        neLat: 40.78,
        neLng: -73.95,
        swLat: 40.72,
        swLng: -74.01,
      },
      checkin: '2026-08-21',
      checkout: '2026-08-23',
      adults: 2,
      children: 1,
      currency: 'USD',
      priceMin: 100,
      priceMax: 500,
      minBedrooms: 2,
      minBeds: 3,
      propertyType: 'entire',
      superhost: true,
      instantBook: true,
      amenities: [4, 8],
      maxResults: 100,
      exhaustive: false,
    },
    (page) => pages.push(page),
    async (url, options, maxRetries) => {
      requests.push({
        url,
        maxRetries,
        headers: options?.headers,
      });
      return {
        data: makeSsrSearchHtml(),
        status: 200,
        statusText: 'OK',
      };
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].maxRetries, 1);
  assert.match(requests[0].headers?.Accept ?? '', /^text\/html/);

  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.origin, 'https://www.airbnb.com');
  assert.equal(requestUrl.pathname, '/s/New%20York/homes');
  assert.notEqual(requestUrl.pathname, '/api/v2/explore_tabs');
  assert.equal(requestUrl.searchParams.get('key'), null);
  assert.equal(requestUrl.searchParams.get('search_by_map'), 'true');
  assert.equal(requestUrl.searchParams.get('children'), '1');
  assert.equal(requestUrl.searchParams.get('room_types[]'), 'Entire home/apt');
  assert.equal(requestUrl.searchParams.get('superhost'), 'true');
  assert.equal(requestUrl.searchParams.get('ib'), 'true');
  assert.deepEqual(requestUrl.searchParams.getAll('amenities[]'), ['4', '8']);

  assert.equal(output.pagesScanned, 1);
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].id, '123456789');
  assert.equal(output.results[0].rating, 4.91);
  assert.equal(output.results[0].reviewCount, 123);
  assert.deepEqual(output.results[0].coordinates, {
    lat: 40.758,
    lng: -73.9855,
  });
  assert.equal(output.results[0].bedrooms, 2);
  assert.equal(output.results[0].beds, 3);
  assert.equal(output.results[0].superhost, true);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].results.length, 1);
});
