import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseListingUrl,
  parseListingUrls,
} from '../src/listing-url.js';

test('listing URL parsing normalizes Airbnb and Booking identities', () => {
  assert.deepEqual(
    parseListingUrl(
      'https://www.airbnb.co.uk/rooms/12345678?check_in=2026-08-01',
    ),
    {
      platform: 'airbnb',
      listingId: '12345678',
      normalizedUrl: 'https://www.airbnb.com/rooms/12345678',
      matchKey: 'airbnb:12345678',
      displayName: 'Airbnb 12345678',
    },
  );

  assert.deepEqual(
    parseListingUrl(
      'www.booking.com/hotel/US/hotel-hugo.en-gb.html'
      + '?aid=1&highlighted_blocks=123_456',
    ),
    {
      platform: 'booking',
      listingId: 'us/hotel-hugo',
      normalizedUrl:
        'https://www.booking.com/hotel/us/hotel-hugo.en-gb.html'
        + '?matching_block_id=123_456',
      matchKey: 'booking:us/hotel-hugo',
      displayName: 'Hotel Hugo',
    },
  );
});

test('listing URL batches reject unsupported inputs and deduplicate by identity', () => {
  const parsed = parseListingUrls([
    'https://www.airbnb.com/rooms/123',
    'https://airbnb.pl/rooms/123?source=map',
    'https://www.booking.com/hotel/us/hotel-hugo.html',
    'https://example.com/rooms/999',
    'not a URL',
  ]);

  assert.deepEqual(
    parsed.listings.map((listing) => listing.matchKey),
    ['airbnb:123', 'booking:us/hotel-hugo'],
  );
  assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.invalid.length, 2);
  assert.match(parsed.invalid[0].error, /Only Airbnb and Booking/);
  assert.match(parsed.invalid[1].error, /Only Airbnb and Booking|malformed/);
});

test('listing URL parsing rejects lookalike hosts and non-listing paths', () => {
  assert.throws(
    () => parseListingUrl('https://evil-airbnb.com/rooms/123'),
    /Only Airbnb and Booking/,
  );
  assert.throws(
    () => parseListingUrl('https://www.booking.com/searchresults.html'),
    /must contain/,
  );
  assert.throws(
    () => parseListingUrl('javascript://www.airbnb.com/rooms/123'),
    /http or https/,
  );
});
