// src/airbnb/hash-manager.ts
//
// Manages Airbnb persisted GraphQL query hashes.
// Hashes rotate periodically; this module:
// - Caches hashes in ~/.config/reviewr/airbnb-hashes.json
// - Falls back to hardcoded defaults
// - Auto-refreshes stale hashes via Playwright

import * as fs from 'fs';
import * as path from 'path';
import { getConfigDir } from '../config.js';

// --- Hardcoded defaults (current known-good hashes) ---

const DEFAULT_LISTING_HASH = '817db68da8bfce0eeea799a4531a191ea2aa0238830f398b9c16e6c98d3249fa';
const DEFAULT_REVIEWS_HASH = 'dec1c8061483e78373602047450322fd474e79ba9afa8d3dbbc27f504030f91d';

// --- Interfaces ---

interface HashConfig {
  listingHash: string;
  reviewsHash: string;
  lastRefreshed: string | null;
}

// --- Session cache ---

let sessionCache: HashConfig | null = null;

// --- File paths ---

function getHashConfigPath(): string {
  return path.join(getConfigDir(), 'airbnb-hashes.json');
}

// --- Core functions ---

/**
 * Load hashes from config file, falling back to hardcoded defaults.
 * Result is session-cached.
 */
export function loadHashes(): HashConfig {
  if (sessionCache) return sessionCache;

  const configPath = getHashConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      sessionCache = {
        listingHash: parsed.listingHash || DEFAULT_LISTING_HASH,
        reviewsHash: parsed.reviewsHash || DEFAULT_REVIEWS_HASH,
        lastRefreshed: parsed.lastRefreshed || null,
      };
      return sessionCache;
    }
  } catch {
    // Config file corrupt or unreadable, use defaults
  }

  sessionCache = {
    listingHash: DEFAULT_LISTING_HASH,
    reviewsHash: DEFAULT_REVIEWS_HASH,
    lastRefreshed: null,
  };
  return sessionCache;
}

/**
 * Save hashes to config file with timestamp.
 */
export function saveHashes(hashes: { listingHash: string; reviewsHash: string }): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const config: HashConfig = {
    listingHash: hashes.listingHash,
    reviewsHash: hashes.reviewsHash,
    lastRefreshed: new Date().toISOString(),
  };

  fs.writeFileSync(getHashConfigPath(), JSON.stringify(config, null, 2));
  sessionCache = config;
}

/**
 * Get the current listing (StaysPdpSections) hash.
 */
export function getListingHash(): string {
  return loadHashes().listingHash;
}

/**
 * Get the current reviews (StaysPdpReviewsQuery) hash.
 */
export function getReviewsHash(): string {
  return loadHashes().reviewsHash;
}

/**
 * Get the full Sections API URL with current hash.
 */
export function getSectionsApiUrl(): string {
  return `https://www.airbnb.com/api/v3/StaysPdpSections/${getListingHash()}`;
}

/**
 * Get the full Reviews API URL with current hash.
 */
export function getReviewsApiUrl(): string {
  return `https://www.airbnb.com/api/v3/StaysPdpReviewsQuery/${getReviewsHash()}/`;
}

/**
 * Clear session cache, forcing reload from file on next access.
 */
export function invalidateSessionCache(): void {
  sessionCache = null;
}

/**
 * Detect if a hash is stale based on API response.
 * A stale listing hash returns structuredDisplayPrice=null AND
 * the calendarSubtitle suggests dates aren't being processed.
 */
export function isStaleHash(bookItSection: any): boolean {
  if (!bookItSection) return false;

  const displayPrice = bookItSection.structuredDisplayPrice;
  if (displayPrice !== null && displayPrice !== undefined) return false;

  // Check if the calendar subtitle hints that dates weren't processed
  const calendarSubtitle = bookItSection.calendarSubtitle || '';
  if (calendarSubtitle.toLowerCase().includes('add your travel dates')) {
    return true;
  }

  return false;
}

/**
 * Refresh hashes by intercepting Airbnb's actual API calls via Playwright.
 * Navigates to a real listing page with dates and captures the hash from network requests.
 */
export async function refreshHashesViaPlaywright(): Promise<{ listingHash: string; reviewsHash: string }> {
  const { chromium } = await import('playwright');

  console.log('Refreshing Airbnb API hashes via Playwright...');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    let listingHash: string | null = null;
    let reviewsHash: string | null = null;

    // Intercept network requests to capture API hashes
    page.on('request', (request) => {
      const url = request.url();

      const sectionsMatch = url.match(/\/api\/v3\/StaysPdpSections\/([a-f0-9]{64})/);
      if (sectionsMatch && !listingHash) {
        listingHash = sectionsMatch[1];
        console.log(`  Found listing hash: ${listingHash.substring(0, 16)}...`);
      }

      const reviewsMatch = url.match(/\/api\/v3\/StaysPdpReviewsQuery\/([a-f0-9]{64})/);
      if (reviewsMatch && !reviewsHash) {
        reviewsHash = reviewsMatch[1];
        console.log(`  Found reviews hash: ${reviewsHash.substring(0, 16)}...`);
      }
    });

    // Navigate to a well-known listing with dates to trigger API calls
    // Use a popular listing that's unlikely to be removed
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 7);
    const nextWeek = new Date(tomorrow);
    nextWeek.setDate(nextWeek.getDate() + 5);
    const checkIn = tomorrow.toISOString().split('T')[0];
    const checkOut = nextWeek.toISOString().split('T')[0];

    const testUrl = `https://www.airbnb.com/rooms/44129719?check_in=${checkIn}&check_out=${checkOut}&adults=2`;
    console.log(`  Navigating to test listing...`);

    await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for API calls to be made
    await page.waitForTimeout(5000);

    // Scroll down to trigger reviews loading if not yet captured
    if (!reviewsHash) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await page.waitForTimeout(3000);
    }

    if (!listingHash && !reviewsHash) {
      throw new Error('Could not capture any API hashes from network requests');
    }

    const result = {
      listingHash: listingHash || getListingHash(),
      reviewsHash: reviewsHash || getReviewsHash(),
    };

    saveHashes(result);
    console.log(`Hashes refreshed and saved.`);

    return result;
  } finally {
    await browser.close();
  }
}
