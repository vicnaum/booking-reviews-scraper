#!/usr/bin/env npx tsx
// scripts/filter-rome.ts
// Filter Rome listings based on requirements

import * as fs from 'fs';
import * as path from 'path';

const airbnbDir = 'data/airbnb/output/rome-listings';
const bookingDir = 'data/booking/output/rome-listings';

interface FilteredListing {
  id: string;
  platform: 'airbnb' | 'booking';
  title: string;
  url: string;
  bedrooms: number | null;
  beds: number | null;
  sleepingArrangements: any[] | null;
  rating: number | null;
  reviewCount: number | null;
  pricing: any;
  amenities: string[];
  description: string;
  highlights: string[];
  coordinates: { lat: number; lng: number } | null;
  propertyType: string | null;
  capacity: number | null;
  hasSeparateBedroom: boolean;
  hasDoubleBed: boolean;
  hasHeating: boolean;
  hasAC: boolean;
  hasBalcony: boolean;
  hasWifi: boolean;
  floor: string | null;
  issues: string[];
  score: number;
}

function analyzeAirbnbListings(): FilteredListing[] {
  const files = fs.readdirSync(airbnbDir).filter(f => f.startsWith('listing_') && f.endsWith('.json'));
  const results: FilteredListing[] = [];

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(airbnbDir, file), 'utf-8'));
    const issues: string[] = [];

    // Check sleeping arrangements
    const arrangements = data.sleepingArrangements || [];
    const allBeds = arrangements.flatMap((a: any) => a.beds || []).join(' ').toLowerCase();
    const hasDoubleBed = allBeds.includes('double') || allBeds.includes('queen') || allBeds.includes('king');

    // Check if there's a separate bedroom for daughter
    const bedroomCount = data.bedrooms || arrangements.length || 0;
    const hasSeparateBedroom = bedroomCount >= 2;

    // Check amenities
    const amenityNames = (data.amenities || []).map((a: any) => (a.name || '').toLowerCase());
    const hasHeating = amenityNames.some((a: string) => a.includes('heating') || a.includes('heat'));
    const hasAC = amenityNames.some((a: string) => a.includes('air conditioning') || a.includes('ac') || a.includes('a/c'));
    const hasBalcony = amenityNames.some((a: string) => a.includes('balcony') || a.includes('terrace') || a.includes('patio'));
    const hasWifi = amenityNames.some((a: string) => a.includes('wifi') || a.includes('wi-fi'));
    const isBasement = data.description?.toLowerCase().includes('basement') ||
                       data.title?.toLowerCase().includes('basement');

    // --- Issues / dealbreakers ---
    if (!hasDoubleBed && bedroomCount > 0) {
      issues.push('No double/queen/king bed found');
    }
    if (bedroomCount < 2) {
      // Check if there's at least a sofa bed for the daughter
      const hasSofaBed = allBeds.includes('sofa') || allBeds.includes('couch') || allBeds.includes('futon');
      if (!hasSofaBed && bedroomCount < 2) {
        issues.push(`Only ${bedroomCount} bedroom(s), no sofa bed`);
      } else if (hasSofaBed) {
        issues.push('Daughter would use sofa bed (not ideal)');
      }
    }
    if (!hasHeating && !hasAC) issues.push('No heating/AC');
    if (isBasement) issues.push('BASEMENT');
    if ((data.capacity || 0) < 3) issues.push(`Capacity only ${data.capacity}`);

    // Score
    let score = 0;
    if (hasSeparateBedroom) score += 30;
    if (hasDoubleBed) score += 20;
    if (hasHeating) score += 10;
    if (hasAC) score += 10;
    if (hasBalcony) score += 15;
    if (hasWifi) score += 5;
    if (data.rating) score += Math.round(data.rating * 2); // e.g. 4.8 -> 10
    if (data.reviewCount && data.reviewCount > 10) score += 5;
    if (data.reviewCount && data.reviewCount > 50) score += 5;
    if (!isBasement) score += 5;
    if ((data.capacity || 0) >= 3) score += 5;

    // Extract floor from description if possible
    const descLower = (data.description || '').toLowerCase();
    let floor: string | null = null;
    const floorMatch = descLower.match(/(\d+)(?:st|nd|rd|th)\s*floor/);
    if (floorMatch) floor = floorMatch[1];
    if (descLower.includes('penthouse')) { floor = 'penthouse'; score += 20; }
    if (descLower.includes('top floor')) { floor = 'top'; score += 10; }
    if (descLower.includes('ground floor')) floor = 'ground';

    results.push({
      id: data.id,
      platform: 'airbnb',
      title: data.title || '',
      url: data.url || '',
      bedrooms: data.bedrooms,
      beds: data.beds,
      sleepingArrangements: data.sleepingArrangements,
      rating: data.rating,
      reviewCount: data.reviewCount,
      pricing: data.pricing,
      amenities: amenityNames,
      description: (data.description || '').substring(0, 300),
      highlights: data.highlights || [],
      coordinates: data.coordinates,
      propertyType: data.propertyType,
      capacity: data.capacity,
      hasSeparateBedroom,
      hasDoubleBed,
      hasHeating,
      hasAC,
      hasBalcony,
      hasWifi,
      floor,
      issues,
      score,
    });
  }

  return results;
}

function main() {
  console.log('=== AIRBNB LISTINGS ANALYSIS ===\n');

  const airbnb = analyzeAirbnbListings();

  // Sort by score
  airbnb.sort((a, b) => b.score - a.score);

  // Stats
  const total = airbnb.length;
  const with2Beds = airbnb.filter(l => l.hasSeparateBedroom).length;
  const withDouble = airbnb.filter(l => l.hasDoubleBed).length;
  const withHeating = airbnb.filter(l => l.hasHeating).length;
  const withBalcony = airbnb.filter(l => l.hasBalcony).length;

  console.log(`Total: ${total}`);
  console.log(`2+ bedrooms: ${with2Beds}`);
  console.log(`Has double/queen/king: ${withDouble}`);
  console.log(`Has heating: ${withHeating}`);
  console.log(`Has balcony/terrace: ${withBalcony}`);
  console.log('');

  // TIER 1: 2+ bedrooms, double bed, heating
  const tier1 = airbnb.filter(l => l.hasSeparateBedroom && l.hasDoubleBed && l.hasHeating && (l.capacity || 0) >= 3);
  console.log(`\n=== TIER 1: 2+ bedrooms + double bed + heating (${tier1.length}) ===\n`);
  for (const l of tier1) {
    console.log(`[Score: ${l.score}] ${l.title}`);
    console.log(`  URL: ${l.url}`);
    console.log(`  Bedrooms: ${l.bedrooms}, Beds: ${l.beds}, Capacity: ${l.capacity}`);
    console.log(`  Rating: ${l.rating} (${l.reviewCount} reviews)`);
    console.log(`  Price: ${l.pricing?.totalPrice || 'N/A'}`);
    console.log(`  Sleeping: ${JSON.stringify(l.sleepingArrangements)}`);
    console.log(`  Balcony: ${l.hasBalcony}, AC: ${l.hasAC}, Floor: ${l.floor || 'unknown'}`);
    console.log(`  Type: ${l.propertyType}`);
    if (l.highlights.length > 0) console.log(`  Highlights: ${l.highlights.join('; ')}`);
    if (l.issues.length > 0) console.log(`  Issues: ${l.issues.join('; ')}`);
    console.log('');
  }

  // TIER 2: Has sofa bed situation but otherwise OK
  const tier2 = airbnb.filter(l =>
    !tier1.includes(l) && l.hasDoubleBed && l.hasHeating && (l.capacity || 0) >= 3
  );
  console.log(`\n=== TIER 2: Double bed + heating but daughter on sofa (${tier2.length}) ===\n`);
  for (const l of tier2) {
    console.log(`[Score: ${l.score}] ${l.title}`);
    console.log(`  URL: ${l.url}`);
    console.log(`  Bedrooms: ${l.bedrooms}, Beds: ${l.beds}, Capacity: ${l.capacity}`);
    console.log(`  Rating: ${l.rating} (${l.reviewCount} reviews)`);
    console.log(`  Price: ${l.pricing?.totalPrice || 'N/A'}`);
    console.log(`  Sleeping: ${JSON.stringify(l.sleepingArrangements)}`);
    console.log(`  Balcony: ${l.hasBalcony}, AC: ${l.hasAC}, Floor: ${l.floor || 'unknown'}`);
    if (l.issues.length > 0) console.log(`  Issues: ${l.issues.join('; ')}`);
    console.log('');
  }

  // REJECTED: Not enough beds or no heating
  const rejected = airbnb.filter(l => !tier1.includes(l) && !tier2.includes(l));
  console.log(`\n=== REJECTED (${rejected.length}) ===\n`);
  for (const l of rejected) {
    console.log(`  ${l.title} - ${l.issues.join('; ')}`);
  }

  // Save filtered results
  const output = { tier1, tier2, rejected: rejected.map(l => ({ id: l.id, title: l.title, issues: l.issues })) };
  fs.writeFileSync(path.join(airbnbDir, '_filtered.json'), JSON.stringify(output, null, 2));
  console.log(`\nFiltered results saved to ${airbnbDir}/_filtered.json`);
}

main();
