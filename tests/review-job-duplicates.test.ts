import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectReviewJobDuplicatePairs,
  normalizeDuplicateName,
  REVIEW_JOB_DUPLICATE_CANDIDATE_RADIUS_METERS,
  type DuplicateListingInput,
} from '../web/src/lib/reviewJobDuplicates.js';

const METERS_PER_LONGITUDE_DEGREE_AT_NYC = 84_000;

function coordinate(
  lat: number,
  lng: number,
  eastMeters = 0,
) {
  return {
    lat,
    lng: lng + eastMeters / METERS_PER_LONGITUDE_DEGREE_AT_NYC,
  };
}

function airbnb(
  listingId: string,
  name: string,
  lat: number,
  lng: number,
  options: {
    eastMeters?: number;
    hostName?: string;
    address?: string;
  } = {},
): DuplicateListingInput {
  return {
    listingId,
    platform: 'airbnb',
    name,
    coordinates: coordinate(
      lat,
      lng,
      options.eastMeters,
    ),
    propertyType: 'Hotel room',
    details: {
      host: options.hostName
        ? { name: options.hostName }
        : null,
      address: options.address ?? null,
    },
  };
}

function booking(
  listingId: string,
  name: string,
  lat: number,
  lng: number,
  options: {
    eastMeters?: number;
    address?: string;
  } = {},
): DuplicateListingInput {
  return {
    listingId,
    platform: 'booking',
    name,
    coordinates: coordinate(
      lat,
      lng,
      options.eastMeters,
    ),
    propertyType: 'Hotel',
    details: {
      address: options.address ?? null,
    },
  };
}

test('duplicate name normalization keeps brands and drops lodging boilerplate', () => {
  assert.equal(
    normalizeDuplicateName('  Merchant LES Hotel  '),
    'merchant les',
  );
  assert.equal(
    normalizeDuplicateName('Hôtel Room at NoMo SoHo'),
    'nomo soho',
  );
});

test('real NYC pairs use card or host names despite offset Airbnb coordinates', () => {
  const listings = [
    airbnb('merchant-airbnb', 'Merchant LES', 40.71, -74),
    booking(
      'merchant-booking',
      'Merchant LES Hotel',
      40.71,
      -74,
      { eastMeters: 2.4 },
    ),
    airbnb(
      'nomo-airbnb',
      'Hotel in SoHo',
      40.72,
      -74,
      { hostName: 'NoMo SoHo New York City' },
    ),
    booking(
      'nomo-booking',
      'NoMo SoHo',
      40.72,
      -74,
      { eastMeters: 81.4 },
    ),
    airbnb(
      'untitled-airbnb',
      'Room in Downtown Manhattan',
      40.73,
      -74,
      { hostName: 'Untitled' },
    ),
    booking(
      'untitled-booking',
      'UNTITLED at 3 Freeman Alley',
      40.73,
      -74,
      { eastMeters: 151.1 },
    ),
    airbnb('17john-airbnb', '17John Hotel', 40.74, -74),
    booking(
      'amtd-booking',
      'AMTD Idea Tribeca Hotel',
      40.74,
      -74,
      { eastMeters: 36.8 },
    ),
    airbnb(
      'walker-airbnb',
      'Walker Hotel Tribeca',
      40.75,
      -74,
    ),
    booking(
      'walker-booking',
      'Walker Hotel Tribeca',
      40.75,
      -74,
      { eastMeters: 2 },
    ),
  ];

  const pairs = detectReviewJobDuplicatePairs(listings);
  const byAirbnb = new Map(
    pairs.map((pair) => [pair.airbnbListingId, pair]),
  );

  assert.equal(
    byAirbnb.get('merchant-airbnb')?.confidence,
    'likely_same',
  );
  assert.equal(
    byAirbnb.get('merchant-airbnb')?.nameSource,
    'card',
  );
  assert.ok(
    Math.abs(
      (byAirbnb.get('merchant-airbnb')?.distanceMeters ?? 0)
      - 2.4,
    ) < 1,
  );
  assert.equal(
    byAirbnb.get('nomo-airbnb')?.confidence,
    'likely_same',
  );
  assert.equal(
    byAirbnb.get('nomo-airbnb')?.nameSource,
    'host',
  );
  assert.ok(
    Math.abs(
      (byAirbnb.get('nomo-airbnb')?.distanceMeters ?? 0)
      - 81.4,
    ) < 1,
  );
  assert.equal(
    byAirbnb.get('untitled-airbnb')?.confidence,
    'likely_same',
  );
  assert.equal(
    byAirbnb.get('untitled-airbnb')?.nameSource,
    'host',
  );
  assert.ok(
    Math.abs(
      (byAirbnb.get('untitled-airbnb')?.distanceMeters ?? 0)
      - 151.1,
    ) < 1,
  );
  assert.equal(
    byAirbnb.get('17john-airbnb')?.confidence,
    'possible_same',
  );
  assert.ok(
    Math.abs(
      (byAirbnb.get('17john-airbnb')?.distanceMeters ?? 0)
      - 36.8,
    ) < 1,
  );
  assert.equal(
    byAirbnb.get('walker-airbnb')?.confidence,
    'likely_same',
  );
});

test('strong names outside the 250 meter envelope are not candidates', () => {
  const pairs = detectReviewJobDuplicatePairs([
    airbnb('far-airbnb', 'NoMo SoHo', 40.71, -74),
    booking(
      'far-booking',
      'NoMo SoHo Hotel',
      40.71,
      -74,
      {
        eastMeters:
          REVIEW_JOB_DUPLICATE_CANDIDATE_RADIUS_METERS + 2,
      },
    ),
  ]);

  assert.deepEqual(pairs, []);
});

test('generic locality overlap and private or reseller host names never become likely matches', () => {
  const pairs = detectReviewJobDuplicatePairs([
    airbnb(
      'jeniffer-airbnb',
      'Private room in SoHo',
      40.71,
      -74,
      { hostName: 'Jeniffer' },
    ),
    booking(
      'soho-booking',
      'Jeniffer Hotel',
      40.71,
      -74,
      { eastMeters: 5 },
    ),
    airbnb(
      'roompicks-airbnb',
      'Hotel room in Midtown',
      40.72,
      -74,
      { hostName: 'RoomPicks' },
    ),
    booking(
      'midtown-booking',
      'RoomPicks Renwick Hotel',
      40.72,
      -74,
      { eastMeters: 6 },
    ),
  ]);

  assert.equal(
    pairs.some((pair) => pair.confidence === 'likely_same'),
    false,
  );
  assert.equal(
    pairs.some((pair) =>
      pair.evidence.sharedDistinctiveTokens.includes('jeniffer')),
    false,
  );
  assert.equal(
    pairs.some((pair) =>
      pair.evidence.sharedDistinctiveTokens.includes('roompicks')),
    false,
  );
});

test('one-to-many strong-name ambiguity stays possible until a user confirms', () => {
  const pairs = detectReviewJobDuplicatePairs([
    airbnb(
      'brand-airbnb',
      'Hotel room in Manhattan',
      40.71,
      -74,
      { hostName: 'Example House' },
    ),
    booking(
      'brand-booking-a',
      'Example House',
      40.71,
      -74,
      { eastMeters: 20 },
    ),
    booking(
      'brand-booking-b',
      'Example House Annex',
      40.71,
      -74,
      { eastMeters: 30 },
    ),
  ]);

  assert.equal(pairs.length, 2);
  assert.deepEqual(
    pairs.map((pair) => pair.confidence),
    ['possible_same', 'possible_same'],
  );
  assert.ok(
    pairs.every((pair) =>
      pair.evidence.ambiguousStrongName),
  );
});

test('generic nearby Chinatown candidates stay possible for user review', () => {
  const pairs = detectReviewJobDuplicatePairs([
    airbnb(
      'chinatown-airbnb',
      'Hotel room in Chinatown',
      40.71,
      -74,
    ),
    booking(
      'pacific-booking',
      'U.S. Pacific Hotel',
      40.71,
      -74,
      { eastMeters: 26 },
    ),
    booking(
      'citynest-booking',
      'CityNest New York',
      40.71,
      -74,
      { eastMeters: 51 },
    ),
  ]);

  assert.deepEqual(
    pairs.map((pair) => [
      pair.bookingListingId,
      pair.confidence,
    ]).sort((left, right) =>
      left[0].localeCompare(right[0])),
    [
      ['citynest-booking', 'possible_same'],
      ['pacific-booking', 'possible_same'],
    ],
  );
});

test('an exact captured street address can promote otherwise unrelated names', () => {
  const pairs = detectReviewJobDuplicatePairs([
    airbnb(
      'address-airbnb',
      'Room in Lower Manhattan',
      40.71,
      -74,
      { address: '17 John Street, New York, NY 10038' },
    ),
    booking(
      'address-booking',
      'AMTD Idea Tribeca Hotel',
      40.71,
      -74,
      {
        eastMeters: 36.8,
        address: '17 John Street, New York, NY 10038',
      },
    ),
  ]);

  assert.equal(pairs[0]?.confidence, 'likely_same');
  assert.equal(pairs[0]?.nameSource, 'address');
  assert.equal(pairs[0]?.evidence.exactAddressMatch, true);
});

test('detection is stable regardless of listing input order', () => {
  const listings = [
    airbnb(
      'nomo-airbnb',
      'Hotel in SoHo',
      40.71,
      -74,
      { hostName: 'NoMo SoHo New York City' },
    ),
    booking(
      'nomo-booking',
      'NoMo SoHo',
      40.71,
      -74,
      { eastMeters: 81.4 },
    ),
  ];

  assert.deepEqual(
    detectReviewJobDuplicatePairs(listings),
    detectReviewJobDuplicatePairs([...listings].reverse()),
  );
});

test('equidistant geo-only ties use listing IDs instead of input order', () => {
  const listings = [
    airbnb('airbnb-b', 'Room in Manhattan', 40.71, -74),
    airbnb('airbnb-a', 'Room in Manhattan', 40.71, -74),
    booking('booking-b', 'Hotel in Manhattan', 40.71, -74),
    booking('booking-a', 'Hotel in Manhattan', 40.71, -74),
  ];
  const forward = detectReviewJobDuplicatePairs(listings);
  const reversed = detectReviewJobDuplicatePairs(
    [...listings].reverse(),
  );

  assert.deepEqual(forward, reversed);
  assert.deepEqual(
    forward.map((pair) => [
      pair.airbnbListingId,
      pair.bookingListingId,
      pair.confidence,
    ]),
    [
      ['airbnb-a', 'booking-a', 'possible_same'],
      ['airbnb-a', 'booking-b', 'possible_same'],
      ['airbnb-b', 'booking-a', 'possible_same'],
      ['airbnb-b', 'booking-b', 'possible_same'],
    ],
  );
});
