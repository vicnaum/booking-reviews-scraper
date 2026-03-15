import test from 'node:test';
import assert from 'node:assert/strict';
import { bboxIntersectsCircle, subdivideBbox } from '../src/search/geo';
import type { BoundingBox, CircleFilter } from '../src/search/types';

test('bboxIntersectsCircle rejects quadrants fully outside the circle', () => {
  const root: BoundingBox = {
    neLat: 51.52,
    neLng: -0.12,
    swLat: 51.50,
    swLng: -0.16,
  };
  const circle: CircleFilter = {
    center: { lat: 51.505, lng: -0.155 },
    radiusMeters: 450,
  };

  const quadrants = subdivideBbox(root);
  const intersects = quadrants.map((cell) => bboxIntersectsCircle(cell, circle));

  assert.deepEqual(intersects, [false, false, false, true]);
});

test('bboxIntersectsCircle keeps cells touched by the circle edge', () => {
  const cell: BoundingBox = {
    neLat: 51.511,
    neLng: -0.149,
    swLat: 51.509,
    swLng: -0.151,
  };
  const circle: CircleFilter = {
    center: { lat: 51.509, lng: -0.1555 },
    radiusMeters: 320,
  };

  assert.equal(bboxIntersectsCircle(cell, circle), true);
});
