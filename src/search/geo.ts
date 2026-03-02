// src/search/geo.ts
//
// Geocoding, bounding box utilities, grid subdivision, and price pivoting
// Adapted from hosts-finder.ts patterns, generalized for both platforms

import * as turf from '@turf/turf';
import { makeRequest } from '../airbnb/scraper.js';
import type { BoundingBox } from './types.js';

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

/**
 * Geocode a location string to a bounding box using Nominatim
 */
export async function geocodeLocation(query: string): Promise<BoundingBox> {
  console.log(`🌍 Geocoding "${query}" using OpenStreetMap...`);

  const url = new URL(`${NOMINATIM_BASE_URL}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  const response = await makeRequest(url.toString(), {
    headers: { 'User-Agent': 'ReviewrSearch/1.0' },
  });

  const results = JSON.parse(response.data);
  if (!results.length) {
    throw new Error(`Could not geocode "${query}". No results from Nominatim.`);
  }

  const result = results[0];
  const [swLat, neLat, swLng, neLng] = result.boundingbox.map(Number);

  console.log(`✅ Geocoded: ${result.display_name}`);
  console.log(`   Bbox: [${neLat.toFixed(4)}, ${neLng.toFixed(4)}] / [${swLat.toFixed(4)}, ${swLng.toFixed(4)}]`);

  return { neLat, neLng, swLat, swLng };
}

/**
 * Create a search grid of bounding boxes covering the given area.
 * Uses turf.js to create a point grid and convert each point to a cell bbox.
 */
export function createSearchGrid(bbox: BoundingBox, cellSizeKm: number): BoundingBox[] {
  const turfBbox: [number, number, number, number] = [bbox.swLng, bbox.swLat, bbox.neLng, bbox.neLat];
  const grid = turf.pointGrid(turfBbox, cellSizeKm, { units: 'kilometers' });

  const cells: BoundingBox[] = [];
  const halfLat = cellSizeKm / 111 / 2;

  for (const feature of grid.features) {
    const [lng, lat] = feature.geometry.coordinates;
    const halfLng = cellSizeKm / (111 * Math.cos(lat * Math.PI / 180)) / 2;
    cells.push({
      neLat: lat + halfLat,
      neLng: lng + halfLng,
      swLat: lat - halfLat,
      swLng: lng - halfLng,
    });
  }

  return cells;
}

/**
 * Subdivide a bounding box into 4 quadrants
 */
export function subdivideBbox(bbox: BoundingBox): BoundingBox[] {
  const midLat = (bbox.neLat + bbox.swLat) / 2;
  const midLng = (bbox.neLng + bbox.swLng) / 2;

  return [
    { neLat: bbox.neLat, neLng: bbox.neLng, swLat: midLat, swLng: midLng }, // NE
    { neLat: bbox.neLat, neLng: midLng, swLat: midLat, swLng: bbox.swLng }, // NW
    { neLat: midLat, neLng: bbox.neLng, swLat: bbox.swLat, swLng: midLng }, // SE
    { neLat: midLat, neLng: midLng, swLat: bbox.swLat, swLng: bbox.swLng }, // SW
  ];
}

/**
 * Create price range buckets for price pivoting
 */
export function createPriceRanges(min: number, max: number, buckets: number): { min: number; max: number }[] {
  const intervalSize = (max - min) / buckets;
  const ranges: { min: number; max: number }[] = [];

  for (let i = 0; i < buckets; i++) {
    ranges.push({
      min: Math.round(min + i * intervalSize),
      max: Math.round(min + (i + 1) * intervalSize),
    });
  }

  return ranges;
}

/**
 * Check if a point is within a bounding box
 */
export function bboxContains(bbox: BoundingBox, lat: number, lng: number): boolean {
  return lat >= bbox.swLat && lat <= bbox.neLat && lng >= bbox.swLng && lng <= bbox.neLng;
}

/**
 * Parse a bbox string "neLat,neLng,swLat,swLng" into a BoundingBox
 */
export function parseBboxString(str: string): BoundingBox {
  const parts = str.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    throw new Error(`Invalid bbox format "${str}". Expected: neLat,neLng,swLat,swLng`);
  }
  return { neLat: parts[0], neLng: parts[1], swLat: parts[2], swLng: parts[3] };
}
