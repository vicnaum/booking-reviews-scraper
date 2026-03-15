import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatAirbnbListing,
  formatBookingListing,
} from '../src/analyze.js';
import { formatListingContext } from '../src/analyze-photos.js';

test('review analysis listing context includes POI distance and coordinates for Airbnb', () => {
  const text = formatAirbnbListing({
    id: '1',
    url: 'https://www.airbnb.com/rooms/1',
    title: 'Marylebone flat',
    description: 'Two-bedroom apartment near the high street.',
    propertyType: 'Entire home/apt',
    coordinates: { lat: 51.5158, lng: -0.1512 },
    capacity: 4,
    bedrooms: 2,
    beds: 2,
    bathrooms: 1,
    photos: [],
    amenities: [],
    host: {
      name: 'Host',
      id: 'host-1',
      isSuperhost: true,
      profilePicUrl: '',
      highlights: [],
    },
    houseRules: [],
    highlights: [],
    rating: 4.8,
    reviewCount: 42,
    subRatings: {},
    pricing: null,
    checkIn: '15:00',
    checkOut: '11:00',
    cancellationPolicy: null,
    sleepingArrangements: [],
    poi: { lat: 51.5155, lng: -0.1427 },
    poiDistanceMeters: 386,
    scrapedAt: new Date().toISOString(),
  });

  assert.match(text, /Distance to POI: 386 m/);
  assert.match(text, /POI: 51\.5155, -0\.1427/);
});

test('review analysis listing context includes POI distance and coordinates for Booking', () => {
  const text = formatBookingListing({
    id: '2',
    hotelId: 2,
    url: 'https://www.booking.com/hotel/gb/example.html',
    title: 'Wigmore apartment',
    description: 'Central apartment.',
    propertyType: '201',
    stars: 4,
    address: {
      street: '74 Wigmore St',
      city: 'London',
      region: 'London',
      postalCode: 'W1U 2SQ',
      country: 'UK',
      full: '74 Wigmore St, London W1U 2SQ, UK',
    },
    coordinates: { lat: 51.5158, lng: -0.1512 },
    photos: [],
    amenities: ['Kitchen'],
    rating: 8.8,
    ratingText: 'Fabulous',
    reviewCount: 123,
    subRatings: {},
    checkIn: '15:00',
    checkOut: '11:00',
    linkedRoomId: null,
    rooms: [],
    poi: { lat: 51.5155, lng: -0.1427 },
    poiDistanceMeters: 1250,
    scrapedAt: new Date().toISOString(),
  });

  assert.match(text, /Distance to POI: 1\.3 km/);
  assert.match(text, /POI: 51\.5155, -0\.1427/);
});

test('photo analysis listing context includes POI distance and coordinates', () => {
  const text = formatListingContext({
    title: 'Test flat',
    description: 'Nice place',
    poi: { lat: 51.5155, lng: -0.1427 },
    poiDistanceMeters: 98,
    bedrooms: 2,
    beds: 2,
  });

  assert.match(text, /Distance to POI: 98 m/);
  assert.match(text, /POI: 51\.5155, -0\.1427/);
});
