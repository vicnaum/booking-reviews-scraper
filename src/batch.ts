// src/batch.ts
//
// Unified batch command: fetch details, reviews, and photos for multiple listings
//
// Usage:
//   reviewr batch <files...> [options]

import * as fs from 'fs';
import * as path from 'path';
import { preprocessFiles } from './preprocess.js';
import * as airbnbListing from './airbnb/listing.js';
import * as airbnbScraper from './airbnb/scraper.js';
import * as bookingListing from './booking/listing.js';
import * as bookingScraper from './booking/scraper.js';
import { runAnalyze, parseModelConfig, getProviderApiKey, PROVIDER_KEY_NAMES, type AnalysisResult } from './analyze.js';

// --- Interfaces ---

export interface BatchOptions {
  fetchDetails: boolean;
  fetchReviews: boolean;
  fetchPhotos: boolean;
  aiReviews: boolean;
  aiPhotos: boolean;
  aiModel?: string;
  aiPriorities?: string;
  aiReviewsExplicit: boolean;  // true when --ai-reviews was explicitly passed
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  force: boolean;
  retryFailed: boolean;
  downloadPhotosAll: boolean;
  outputDir?: string;
  print: boolean;
}

// --- Manifest types ---

export interface ManifestPhase {
  status: 'fetched' | 'skipped' | 'failed' | 'partial' | 'not_requested';
  file?: string;
  dir?: string;
  error?: string;
  reason?: string;
  count?: number;
  expected?: number;
  model?: string;
}

export interface ManifestEntry {
  platform: 'airbnb' | 'booking';
  id: string;
  url: string;
  details: ManifestPhase;
  reviews: ManifestPhase;
  photos: ManifestPhase;
  aiReviews: ManifestPhase;
  aiPhotos: ManifestPhase;
  verdict?: 'keep' | 'eliminated' | 'shortlisted';
  verdictReason?: string;
}

export interface BatchManifest {
  version: number;
  createdAt: string;
  updatedAt: string;
  dates: { checkIn?: string; checkOut?: string; adults?: number };
  listings: Record<string, ManifestEntry>;
}

interface PhaseResult {
  fetched: number;
  skipped: number;
  failed: number;
}

interface PlatformResult {
  total: number;
  details: PhaseResult;
  reviews: PhaseResult & { totalReviewCount: number };
  photos: PhaseResult;
  aiReviews: PhaseResult;
  errors: Array<{ id: string; phase: string; message: string }>;
}

export interface BatchResult {
  airbnb: PlatformResult;
  booking: PlatformResult;
  totalTimeMs: number;
}

// --- Helpers ---

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function dirExistsAndNonEmpty(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;
  return fs.readdirSync(dirPath).length > 0;
}

function getManifestPath(options: BatchOptions): string {
  const baseDir = options.outputDir || 'data';
  return path.join(baseDir, 'batch_manifest.json');
}

function loadManifest(manifestPath: string): BatchManifest | null {
  try {
    if (fs.existsSync(manifestPath)) {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    }
  } catch {}
  return null;
}

function saveManifest(manifest: BatchManifest, manifestPath: string): void {
  manifest.updatedAt = new Date().toISOString();
  const dir = path.dirname(manifestPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = manifestPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmpPath, manifestPath);
}

// --- Subdir path helpers (batch mode organizes output into subdirectories) ---

function getListingsDir(outputDir: string): string { return path.join(outputDir, 'listings'); }
function getReviewsDir(outputDir: string): string { return path.join(outputDir, 'reviews'); }
function getPhotosDir(outputDir: string): string { return path.join(outputDir, 'photos'); }
function getAiReviewsDir(outputDir: string): string { return path.join(outputDir, 'ai-reviews'); }

/**
 * Migrate v1 manifest to v2:
 * - Add aiReviews/aiPhotos phases to each entry
 * - Prefix flat file paths with subdirectories
 * - Bump version to 2
 */
function migrateManifestV2(manifest: BatchManifest): BatchManifest {
  if (manifest.version >= 2) return manifest;

  for (const entry of Object.values(manifest.listings)) {
    // Add new phases
    if (!(entry as any).aiReviews) {
      (entry as ManifestEntry).aiReviews = { status: 'not_requested' };
    }
    if (!(entry as any).aiPhotos) {
      (entry as ManifestEntry).aiPhotos = { status: 'not_requested' };
    }

    // Migrate flat paths to subdirs
    if (entry.details.file && !entry.details.file.includes('/')) {
      entry.details.file = `listings/${entry.details.file}`;
    }
    if (entry.reviews.file && !entry.reviews.file.includes('/')) {
      entry.reviews.file = `reviews/${entry.reviews.file}`;
    }
    if (entry.photos.dir && !entry.photos.dir.includes('/')) {
      // Convert photos_ID -> photos/ID
      const dirName = entry.photos.dir.replace(/^photos_/, '');
      entry.photos.dir = `photos/${dirName}`;
    }
  }

  manifest.version = 2;
  return manifest;
}

/**
 * Move files from flat layout to subdirectory layout during v1->v2 migration.
 * Silently skips if source doesn't exist or destination already exists.
 */
function migrateFilesToSubdirs(outputDir: string, manifest: BatchManifest): void {
  for (const entry of Object.values(manifest.listings)) {
    // Move listing files
    if (entry.details.file) {
      const basename = path.basename(entry.details.file);
      const oldPath = path.join(outputDir, basename);
      const newPath = path.join(outputDir, entry.details.file);
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        const dir = path.dirname(newPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.renameSync(oldPath, newPath);
      }
    }

    // Move review files
    if (entry.reviews.file) {
      const basename = path.basename(entry.reviews.file);
      const oldPath = path.join(outputDir, basename);
      const newPath = path.join(outputDir, entry.reviews.file);
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        const dir = path.dirname(newPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.renameSync(oldPath, newPath);
      }
    }

    // Move photo directories: photos_ID -> photos/ID
    if (entry.photos.dir) {
      const cleanId = path.basename(entry.photos.dir);
      const oldDir = path.join(outputDir, `photos_${cleanId}`);
      const newDir = path.join(outputDir, entry.photos.dir);
      if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
        const parent = path.dirname(newDir);
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
        fs.renameSync(oldDir, newDir);
      }
    }
  }
}

function shouldRetryPhase(manifest: BatchManifest, key: string, phase: 'details' | 'reviews' | 'photos' | 'aiReviews'): boolean {
  const entry = manifest.listings[key];
  if (!entry) return false;
  const status = entry[phase].status;
  return status === 'failed' || status === 'partial';
}

function newPlatformResult(total: number): PlatformResult {
  return {
    total,
    details: { fetched: 0, skipped: 0, failed: 0 },
    reviews: { fetched: 0, skipped: 0, failed: 0, totalReviewCount: 0 },
    photos: { fetched: 0, skipped: 0, failed: 0 },
    aiReviews: { fetched: 0, skipped: 0, failed: 0 },
    errors: [],
  };
}

// --- Main batch function ---

export async function runBatch(filePaths: string[], options: BatchOptions): Promise<BatchResult> {
  const startTime = Date.now();
  const manifestPath = getManifestPath(options);

  // 1. Load or create manifest (v2 format with subdirectories)
  let manifest: BatchManifest = loadManifest(manifestPath) || {
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dates: {},
    listings: {},
  };

  // Migrate v1 manifest to v2 (add aiReviews/aiPhotos, prefix paths with subdirs)
  if (manifest.version < 2) {
    const outputDir = options.outputDir || 'data';
    manifest = migrateManifestV2(manifest);
    migrateFilesToSubdirs(outputDir, manifest);
    saveManifest(manifest, manifestPath);
    console.log('Manifest migrated to v2 (subdirectory layout)');
  }

  // 2. Preprocess files (may be empty for --retry-only)
  const preprocessed = filePaths.length > 0
    ? preprocessFiles(filePaths)
    : { airbnb: { urls: [] as string[], count: 0, duplicatesRemoved: 0 }, booking: { urls: [] as string[], count: 0, duplicatesRemoved: 0 }, dates: { source: 'none' as const, checkIn: undefined, checkOut: undefined, adults: undefined } };

  // 3. If --retry, merge retry URLs from manifest
  if (options.retryFailed) {
    for (const [key, entry] of Object.entries(manifest.listings)) {
      const needsRetry = entry.details.status === 'failed' || entry.details.status === 'partial'
        || entry.reviews.status === 'failed' || entry.reviews.status === 'partial'
        || entry.photos.status === 'failed' || entry.photos.status === 'partial'
        || entry.aiReviews?.status === 'failed';
      if (!needsRetry) continue;

      if (entry.platform === 'airbnb') {
        if (!preprocessed.airbnb.urls.includes(entry.url)) {
          preprocessed.airbnb.urls.push(entry.url);
          preprocessed.airbnb.count++;
        }
      } else {
        if (!preprocessed.booking.urls.includes(entry.url)) {
          preprocessed.booking.urls.push(entry.url);
          preprocessed.booking.count++;
        }
      }
    }
  }

  // 4. Resolve dates: CLI flags > unanimous consensus > manifest > none
  const checkIn = options.checkIn || preprocessed.dates.checkIn || manifest.dates.checkIn || undefined;
  const checkOut = options.checkOut || preprocessed.dates.checkOut || manifest.dates.checkOut || undefined;
  const adults = options.adults || preprocessed.dates.adults || manifest.dates.adults || undefined;

  manifest.dates = { checkIn, checkOut, adults };

  if (preprocessed.dates.source === 'conflicting' && !options.checkIn) {
    console.warn('Warning: URLs have conflicting dates. Using most common. Override with --checkin/--checkout.');
  }

  // 5. Print header
  const totalDups = preprocessed.airbnb.duplicatesRemoved + preprocessed.booking.duplicatesRemoved;
  const platformParts: string[] = [];
  if (preprocessed.airbnb.count > 0) platformParts.push(`${preprocessed.airbnb.count} Airbnb`);
  if (preprocessed.booking.count > 0) platformParts.push(`${preprocessed.booking.count} Booking`);
  let headerLine = `Batch: ${platformParts.join(' + ')} URLs`;
  if (totalDups > 0) headerLine += ` (${totalDups} duplicate${totalDups > 1 ? 's' : ''} removed)`;
  if (options.retryFailed) headerLine += ' (retry mode)';
  console.log(headerLine);

  if (checkIn || checkOut) {
    let dateLine = `Dates: ${checkIn || '?'} to ${checkOut || '?'}`;
    if (adults) dateLine += `, ${adults} adults`;
    if (preprocessed.dates.source === 'unanimous') dateLine += ' (unanimous from URLs)';
    console.log(dateLine);
  }

  const phases: string[] = [];
  if (options.fetchDetails) phases.push('details');
  if (options.fetchReviews) phases.push('reviews');
  if (options.fetchPhotos) phases.push('photos');
  if (options.aiReviews) phases.push('ai-reviews');
  if (options.aiPhotos) phases.push('ai-photos');
  console.log(`Phases: ${phases.join(', ')}\n`);

  const dateOpts = { checkIn, checkOut, adults };
  const airbnbResult = newPlatformResult(preprocessed.airbnb.count);
  const bookingResult = newPlatformResult(preprocessed.booking.count);
  const totalCount = preprocessed.airbnb.count + preprocessed.booking.count;
  let currentIndex = 0;

  // 6. Process Airbnb listings
  if (preprocessed.airbnb.count > 0) {
    const airbnbOutputDir = options.outputDir || 'data/airbnb/output';
    let apiKey: string | null = null;

    // Get API key once if needed for details or reviews
    if (options.fetchDetails || options.fetchReviews) {
      try {
        apiKey = await airbnbScraper.getApiKey();
      } catch (err: any) {
        console.error(`Failed to get Airbnb API key: ${err.message}`);
      }
    }

    for (const url of preprocessed.airbnb.urls) {
      currentIndex++;
      const { roomId } = airbnbListing.parseAirbnbUrl(url);
      const manifestKey = `airbnb/${roomId}`;
      const prefix = `[${currentIndex}/${totalCount}] ${manifestKey}`;
      const statusParts: string[] = [];
      let details: airbnbListing.AirbnbListingDetails | null = null;

      // Initialize manifest entry (preserve existing or create new)
      if (!manifest.listings[manifestKey]) {
        manifest.listings[manifestKey] = {
          platform: 'airbnb', id: roomId, url,
          details: { status: 'not_requested' },
          reviews: { status: 'not_requested' },
          photos: { status: 'not_requested' },
          aiReviews: { status: 'not_requested' },
          aiPhotos: { status: 'not_requested' },
        };
      }
      const entry = manifest.listings[manifestKey];

      // Determine which phases to process (retry-aware)
      const isRetryListing = options.retryFailed && !!loadManifest(manifestPath)?.listings[manifestKey];
      const doDetails = options.fetchDetails && (!isRetryListing || shouldRetryPhase(manifest, manifestKey, 'details'));
      const doReviews = options.fetchReviews && (!isRetryListing || shouldRetryPhase(manifest, manifestKey, 'reviews'));
      const doPhotos = options.fetchPhotos && (!isRetryListing || shouldRetryPhase(manifest, manifestKey, 'photos'));

      // --- Details ---
      if (doDetails) {
        if (!apiKey) {
          statusParts.push('details \u2717 no API key');
          airbnbResult.details.failed++;
          airbnbResult.errors.push({ id: roomId, phase: 'details', message: 'No API key' });
          entry.details = { status: 'failed', error: 'No API key' };
        } else {
          const listingsDir = getListingsDir(airbnbOutputDir);
          const detailsFile = path.join(listingsDir, `listing_${roomId}.json`);
          if (!options.force && fs.existsSync(detailsFile)) {
            statusParts.push('details \u2298 skip');
            airbnbResult.details.skipped++;
            entry.details = { status: 'skipped', file: `listings/listing_${roomId}.json` };
            if (options.fetchPhotos) {
              try { details = JSON.parse(fs.readFileSync(detailsFile, 'utf-8')); } catch {}
            }
          } else {
            const t = Date.now();
            try {
              details = await airbnbListing.fetchListingDetails(apiKey, roomId, dateOpts);
              if (!options.print) {
                airbnbListing.saveListingDetails(details, `listing_${roomId}.json`, listingsDir);
              }
              statusParts.push(`details \u2713 (${formatDuration(Date.now() - t)})`);
              airbnbResult.details.fetched++;
              entry.details = { status: 'fetched', file: `listings/listing_${roomId}.json` };
            } catch (err: any) {
              statusParts.push('details \u2717 error');
              airbnbResult.details.failed++;
              airbnbResult.errors.push({ id: roomId, phase: 'details', message: err.message });
              entry.details = { status: 'failed', error: err.message };
              if (err.message?.includes('401') || err.message?.includes('403')) {
                try { apiKey = await airbnbScraper.getApiKey(); } catch {}
              }
            }
          }
        }
      } else if (options.fetchDetails) {
        // Phase requested but skipped by retry logic (already fetched)
        statusParts.push('details \u2298 skip');
        airbnbResult.details.skipped++;
      }

      // Load details for photos/review-check if not already loaded
      if (!details && (options.fetchPhotos || options.fetchReviews)) {
        const detailsFile = path.join(getListingsDir(airbnbOutputDir), `listing_${roomId}.json`);
        if (fs.existsSync(detailsFile)) {
          try { details = JSON.parse(fs.readFileSync(detailsFile, 'utf-8')); } catch {}
        }
      }

      // --- Reviews ---
      if (doReviews) {
        if (!apiKey) {
          statusParts.push('reviews \u2717 no API key');
          airbnbResult.reviews.failed++;
          airbnbResult.errors.push({ id: roomId, phase: 'reviews', message: 'No API key' });
          entry.reviews = { status: 'failed', error: 'No API key' };
        } else {
          const reviewsDir = getReviewsDir(airbnbOutputDir);
          const reviewsFile = path.join(reviewsDir, `room_${roomId}_reviews.json`);
          if (!options.force && fs.existsSync(reviewsFile) && !shouldRetryPhase(manifest, manifestKey, 'reviews')) {
            statusParts.push('reviews \u2298 skip');
            airbnbResult.reviews.skipped++;
            entry.reviews = { status: 'skipped', file: `reviews/room_${roomId}_reviews.json` };
          } else {
            const t = Date.now();
            try {
              const property: airbnbScraper.PropertyInfo = {
                id: roomId,
                url,
                room_type: 'Unknown',
                title: details?.title || `Room ${roomId}`,
                rating_score: '',
                review_count: '',
                status: 'Unknown',
              };
              const reviews = await airbnbScraper.fetchPropertyReviews(apiKey, property);
              if (!options.print) {
                if (!fs.existsSync(reviewsDir)) fs.mkdirSync(reviewsDir, { recursive: true });
                const output = {
                  scraped_at: new Date().toISOString(),
                  total_reviews: reviews.length,
                  properties_processed: [roomId],
                  reviews,
                };
                fs.writeFileSync(
                  path.join(reviewsDir, `room_${roomId}_reviews.json`),
                  JSON.stringify(output, null, 2),
                );
              }
              statusParts.push(`reviews \u2713 ${reviews.length} (${formatDuration(Date.now() - t)})`);
              airbnbResult.reviews.fetched++;
              airbnbResult.reviews.totalReviewCount += reviews.length;

              // Review completeness check
              const expectedReviews = details?.reviewCount;
              if (expectedReviews && reviews.length < expectedReviews * 0.8) {
                entry.reviews = { status: 'partial', file: `reviews/room_${roomId}_reviews.json`, count: reviews.length, expected: expectedReviews };
                console.warn(`  Warning: got ${reviews.length}/${expectedReviews} reviews (partial)`);
              } else {
                entry.reviews = { status: 'fetched', file: `reviews/room_${roomId}_reviews.json`, count: reviews.length, expected: expectedReviews || undefined };
              }
            } catch (err: any) {
              statusParts.push('reviews \u2717 error');
              airbnbResult.reviews.failed++;
              airbnbResult.errors.push({ id: roomId, phase: 'reviews', message: err.message });
              entry.reviews = { status: 'failed', error: err.message };
              if (err.message?.includes('401') || err.message?.includes('403')) {
                try { apiKey = await airbnbScraper.getApiKey(); } catch {}
              }
            }
          }
        }
      } else if (options.fetchReviews) {
        statusParts.push('reviews \u2298 skip');
        airbnbResult.reviews.skipped++;
      }

      // --- Photos ---
      if (doPhotos) {
        const photosBase = getPhotosDir(airbnbOutputDir);
        const photosDir = path.join(photosBase, roomId);
        const dirExists = fs.existsSync(photosDir);
        const expectedPhotos = details?.photos?.length || 0;
        const actualPhotos = dirExists ? fs.readdirSync(photosDir).length : 0;
        const photosIncomplete = dirExists && details && expectedPhotos > 0 && actualPhotos < expectedPhotos;

        if (!options.force && dirExistsAndNonEmpty(photosDir) && !photosIncomplete) {
          statusParts.push('photos \u2298 skip');
          airbnbResult.photos.skipped++;
          entry.photos = { status: 'skipped', dir: `photos/${roomId}`, count: actualPhotos, expected: expectedPhotos || undefined };
        } else if (!details) {
          statusParts.push('photos \u2298 skip (no details)');
          airbnbResult.photos.skipped++;
          entry.photos = { status: 'skipped', reason: 'no details' };
        } else {
          if (photosIncomplete) {
            statusParts.push(`photos: ${actualPhotos}/${expectedPhotos} incomplete, re-downloading`);
          }
          try {
            await airbnbListing.downloadPhotos(details, photosBase, { dirName: roomId });
            const finalCount = fs.existsSync(photosDir) ? fs.readdirSync(photosDir).length : 0;
            if (expectedPhotos > 0 && finalCount < expectedPhotos) {
              statusParts.push(`photos \u2713 ${finalCount}/${expectedPhotos} (partial)`);
              entry.photos = { status: 'partial', dir: `photos/${roomId}`, count: finalCount, expected: expectedPhotos };
            } else {
              statusParts.push(`photos \u2713 ${finalCount}`);
              entry.photos = { status: 'fetched', dir: `photos/${roomId}`, count: finalCount, expected: expectedPhotos || undefined };
            }
            airbnbResult.photos.fetched++;
          } catch (err: any) {
            statusParts.push('photos \u2717 error');
            airbnbResult.photos.failed++;
            airbnbResult.errors.push({ id: roomId, phase: 'photos', message: err.message });
            entry.photos = { status: 'failed', dir: `photos/${roomId}`, error: err.message };
          }
        }
      } else if (options.fetchPhotos) {
        statusParts.push('photos \u2298 skip');
        airbnbResult.photos.skipped++;
      }

      console.log(`${prefix} \u2014 ${statusParts.join(' | ')}`);

      // Save manifest after each listing
      saveManifest(manifest, manifestPath);

      // 1s delay between Airbnb listings
      if (currentIndex < totalCount) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // 7. Process Booking listings
  if (preprocessed.booking.count > 0) {
    const bookingOutputDir = options.outputDir || 'data/booking/output';

    for (const url of preprocessed.booking.urls) {
      currentIndex++;
      const hotelInfo = bookingScraper.extractHotelInfo(url);
      if (!hotelInfo) {
        bookingResult.errors.push({ id: url, phase: 'parse', message: 'Could not extract hotel info' });
        continue;
      }

      const id = hotelInfo.hotel_name;
      const manifestKey = `booking/${id}`;
      const prefix = `[${currentIndex}/${totalCount}] ${manifestKey}`;
      const statusParts: string[] = [];
      let details: bookingListing.BookingListingDetails | null = null;

      // Initialize manifest entry
      if (!manifest.listings[manifestKey]) {
        manifest.listings[manifestKey] = {
          platform: 'booking', id, url,
          details: { status: 'not_requested' },
          reviews: { status: 'not_requested' },
          photos: { status: 'not_requested' },
          aiReviews: { status: 'not_requested' },
          aiPhotos: { status: 'not_requested' },
        };
      }
      const entry = manifest.listings[manifestKey];

      // Determine which phases to process (retry-aware)
      const isRetryListing = options.retryFailed && !!loadManifest(manifestPath)?.listings[manifestKey];
      const doDetails = options.fetchDetails && (!isRetryListing || shouldRetryPhase(manifest, manifestKey, 'details'));
      const doReviews = options.fetchReviews && (!isRetryListing || shouldRetryPhase(manifest, manifestKey, 'reviews'));
      const doPhotos = options.fetchPhotos && (!isRetryListing || shouldRetryPhase(manifest, manifestKey, 'photos'));

      // --- Details ---
      if (doDetails) {
        const listingsDir = getListingsDir(bookingOutputDir);
        const detailsFile = path.join(listingsDir, `listing_${id}.json`);
        if (!options.force && fs.existsSync(detailsFile)) {
          statusParts.push('details \u2298 skip');
          bookingResult.details.skipped++;
          entry.details = { status: 'skipped', file: `listings/listing_${id}.json` };
          if (options.fetchPhotos) {
            try { details = JSON.parse(fs.readFileSync(detailsFile, 'utf-8')); } catch {}
          }
        } else {
          const t = Date.now();
          try {
            details = await bookingListing.scrapeListingDetails(url, dateOpts);
            if (!options.print) {
              bookingListing.saveListingDetails(details, `listing_${id}.json`, listingsDir);
            }
            statusParts.push(`details \u2713 (${formatDuration(Date.now() - t)})`);
            bookingResult.details.fetched++;
            entry.details = { status: 'fetched', file: `listings/listing_${id}.json` };
          } catch (err: any) {
            statusParts.push('details \u2717 error');
            bookingResult.details.failed++;
            bookingResult.errors.push({ id, phase: 'details', message: err.message });
            entry.details = { status: 'failed', error: err.message };
          }
        }
      } else if (options.fetchDetails) {
        statusParts.push('details \u2298 skip');
        bookingResult.details.skipped++;
      }

      // Load details for photos/review-check if not already loaded
      if (!details && (options.fetchPhotos || options.fetchReviews)) {
        const detailsFile = path.join(getListingsDir(bookingOutputDir), `listing_${id}.json`);
        if (fs.existsSync(detailsFile)) {
          try { details = JSON.parse(fs.readFileSync(detailsFile, 'utf-8')); } catch {}
        }
      }

      // --- Reviews ---
      if (doReviews) {
        const reviewsDir = getReviewsDir(bookingOutputDir);
        const reviewsFile = path.join(reviewsDir, `${id}_reviews.json`);
        if (!options.force && fs.existsSync(reviewsFile) && !shouldRetryPhase(manifest, manifestKey, 'reviews')) {
          statusParts.push('reviews \u2298 skip');
          bookingResult.reviews.skipped++;
          entry.reviews = { status: 'skipped', file: `reviews/${id}_reviews.json` };
        } else {
          const t = Date.now();
          try {
            const reviews = await bookingScraper.scrapeHotelReviews(hotelInfo);
            if (!options.print) {
              if (!fs.existsSync(reviewsDir)) fs.mkdirSync(reviewsDir, { recursive: true });
              const output = {
                scraped_at: new Date().toISOString(),
                total_reviews: reviews.length,
                hotels_processed: [id],
                reviews,
              };
              fs.writeFileSync(
                path.join(reviewsDir, `${id}_reviews.json`),
                JSON.stringify(output, null, 2),
              );
            }
            statusParts.push(`reviews \u2713 ${reviews.length} (${formatDuration(Date.now() - t)})`);
            bookingResult.reviews.fetched++;
            bookingResult.reviews.totalReviewCount += reviews.length;

            // Review completeness check
            const expectedReviews = details?.reviewCount;
            if (expectedReviews && reviews.length < expectedReviews * 0.8) {
              entry.reviews = { status: 'partial', file: `reviews/${id}_reviews.json`, count: reviews.length, expected: expectedReviews };
              console.warn(`  Warning: got ${reviews.length}/${expectedReviews} reviews (partial)`);
            } else {
              entry.reviews = { status: 'fetched', file: `reviews/${id}_reviews.json`, count: reviews.length, expected: expectedReviews || undefined };
            }
          } catch (err: any) {
            statusParts.push('reviews \u2717 error');
            bookingResult.reviews.failed++;
            bookingResult.errors.push({ id, phase: 'reviews', message: err.message });
            entry.reviews = { status: 'failed', error: err.message };
          }
        }
      } else if (options.fetchReviews) {
        statusParts.push('reviews \u2298 skip');
        bookingResult.reviews.skipped++;
      }

      // --- Photos ---
      if (doPhotos) {
        const photosBase = getPhotosDir(bookingOutputDir);
        const photosDir = path.join(photosBase, id);
        const dirExists = fs.existsSync(photosDir);
        const expectedPhotos = details?.photos?.length || 0;
        const actualPhotos = dirExists ? fs.readdirSync(photosDir).length : 0;
        const photosIncomplete = dirExists && details && expectedPhotos > 0 && actualPhotos < expectedPhotos;

        if (!options.force && dirExistsAndNonEmpty(photosDir) && !photosIncomplete) {
          statusParts.push('photos \u2298 skip');
          bookingResult.photos.skipped++;
          entry.photos = { status: 'skipped', dir: `photos/${id}`, count: actualPhotos, expected: expectedPhotos || undefined };
        } else if (!details) {
          statusParts.push('photos \u2298 skip (no details)');
          bookingResult.photos.skipped++;
          entry.photos = { status: 'skipped', reason: 'no details' };
        } else {
          if (photosIncomplete) {
            statusParts.push(`photos: ${actualPhotos}/${expectedPhotos} incomplete, re-downloading`);
          }
          try {
            await bookingListing.downloadPhotos(details, photosBase, {
              downloadAll: options.downloadPhotosAll,
              dirName: id,
            });
            const finalCount = fs.existsSync(photosDir) ? fs.readdirSync(photosDir).length : 0;
            if (expectedPhotos > 0 && finalCount < expectedPhotos) {
              statusParts.push(`photos \u2713 ${finalCount}/${expectedPhotos} (partial)`);
              entry.photos = { status: 'partial', dir: `photos/${id}`, count: finalCount, expected: expectedPhotos };
            } else {
              statusParts.push(`photos \u2713 ${finalCount}`);
              entry.photos = { status: 'fetched', dir: `photos/${id}`, count: finalCount, expected: expectedPhotos || undefined };
            }
            bookingResult.photos.fetched++;
          } catch (err: any) {
            statusParts.push('photos \u2717 error');
            bookingResult.photos.failed++;
            bookingResult.errors.push({ id, phase: 'photos', message: err.message });
            entry.photos = { status: 'failed', dir: `photos/${id}`, error: err.message };
          }
        }
      } else if (options.fetchPhotos) {
        statusParts.push('photos \u2298 skip');
        bookingResult.photos.skipped++;
      }

      console.log(`${prefix} \u2014 ${statusParts.join(' | ')}`);

      // Save manifest after each listing
      saveManifest(manifest, manifestPath);
      // No artificial delay for Booking (Playwright is already slow)
    }
  }

  // 8. AI review analysis phase (runs after all scraping)
  if (options.aiReviews) {
    const aiOutputDir = options.outputDir || 'data';
    const aiModel = options.aiModel || process.env.LLM_MODEL || 'gemini-3-flash-preview:high';
    const aiReviewsDir = getAiReviewsDir(aiOutputDir);

    // Early API key validation
    const modelConfig = parseModelConfig(aiModel);
    const aiApiKey = getProviderApiKey(modelConfig.provider);
    if (!aiApiKey) {
      const keyName = PROVIDER_KEY_NAMES[modelConfig.provider];
      if (options.aiReviewsExplicit) {
        console.error(`Error: ${keyName} (or LLM_API_KEY) required for --ai-reviews. Set it in your environment.`);
        process.exit(1);
      } else {
        console.warn(`Warning: ${keyName} not set \u2014 skipping AI review analysis.`);
      }
    } else {
      console.log(`\nAI review analysis (${modelConfig.model}):`);
      if (!fs.existsSync(aiReviewsDir)) fs.mkdirSync(aiReviewsDir, { recursive: true });

      let aiIndex = 0;
      const aiEntries = Object.entries(manifest.listings);
      for (const [manifestKey, entry] of aiEntries) {
        aiIndex++;
        const prefix = `[${aiIndex}/${aiEntries.length}] ${manifestKey}`;

        // Determine platform-specific result tracker
        const platformResult = entry.platform === 'airbnb' ? airbnbResult : bookingResult;

        // Skip if already fetched (unless --force)
        const aiFile = path.join(aiReviewsDir, `${entry.id}.json`);
        if (!options.force && entry.aiReviews?.status === 'fetched' && fs.existsSync(aiFile)) {
          if (!(options.retryFailed && shouldRetryPhase(manifest, manifestKey, 'aiReviews'))) {
            console.log(`${prefix} \u2014 ai-reviews \u2298 skip`);
            platformResult.aiReviews.skipped++;
            continue;
          }
        }

        // Skip if retrying and AI already succeeded for this listing
        // (not_requested is NOT skipped — it means AI hasn't run yet, not that user didn't want it)
        if (options.retryFailed && entry.aiReviews?.status === 'fetched') {
          console.log(`${prefix} \u2014 ai-reviews \u2298 skip`);
          platformResult.aiReviews.skipped++;
          continue;
        }

        // Skip if no reviews available
        if (!entry.reviews.file || (entry.reviews.status !== 'fetched' && entry.reviews.status !== 'partial')) {
          console.log(`${prefix} \u2014 ai-reviews \u2298 skip (no reviews)`);
          platformResult.aiReviews.skipped++;
          entry.aiReviews = { status: 'skipped', reason: 'no reviews' };
          continue;
        }

        // Resolve full paths for reviews and listing files
        const reviewsPath = path.join(aiOutputDir, entry.reviews.file!);
        const listingPath = entry.details.file ? path.join(aiOutputDir, entry.details.file) : undefined;

        if (!fs.existsSync(reviewsPath)) {
          console.log(`${prefix} \u2014 ai-reviews \u2298 skip (reviews file missing)`);
          platformResult.aiReviews.skipped++;
          entry.aiReviews = { status: 'skipped', reason: 'reviews file missing' };
          continue;
        }

        const t = Date.now();
        try {
          const result: AnalysisResult = await runAnalyze({
            reviewsFile: reviewsPath,
            listingFile: listingPath && fs.existsSync(listingPath) ? listingPath : undefined,
            model: aiModel,
            priorities: options.aiPriorities,
          });

          // Write result to ai-reviews dir
          fs.writeFileSync(aiFile, JSON.stringify(result.data, null, 2));

          console.log(`${prefix} \u2014 ai-reviews \u2713 (${formatDuration(Date.now() - t)})`);
          platformResult.aiReviews.fetched++;
          entry.aiReviews = { status: 'fetched', file: `ai-reviews/${entry.id}.json`, model: result.model };
        } catch (err: any) {
          console.log(`${prefix} \u2014 ai-reviews \u2717 ${err.message}`);
          platformResult.aiReviews.failed++;
          platformResult.errors.push({ id: entry.id, phase: 'ai-reviews', message: err.message });
          entry.aiReviews = { status: 'failed', error: err.message, model: modelConfig.model };
        }

        saveManifest(manifest, manifestPath);
      }
    }
  }

  // AI photo analysis stub
  if (options.aiPhotos) {
    console.log('\nAI photo analysis: not yet implemented (skipping)');
    // Future capabilities:
    // - Room type detection (bedroom, bathroom, kitchen, living room)
    // - Bed type assessment (real bed vs sofa/couch, single vs double vs bunk)
    // - Modernity assessment (modern/rustic/dated/renovated)
    // - Cleanliness appearance from photos
    // - Natural light / window presence
    // - Listing-vs-reality comparison (match listing claims to photo evidence)
    // - User priority support (e.g., "needs bathtub" -> check bathroom photos)
  }

  const totalTimeMs = Date.now() - startTime;

  // 9. Final manifest save
  saveManifest(manifest, manifestPath);

  // 10. Print summary
  console.log('\nSummary:');
  if (preprocessed.airbnb.count > 0) {
    const { details: d, reviews: r, photos: p, aiReviews: ai } = airbnbResult;
    let line = `  Airbnb:  ${airbnbResult.total} listings`;
    if (d.fetched + d.skipped + d.failed > 0) line += ` | details: ${d.fetched}\u2713 ${d.skipped}\u2298 ${d.failed}\u2717`;
    if (r.fetched + r.skipped + r.failed > 0) line += ` | reviews: ${r.fetched}\u2713 ${r.skipped}\u2298 ${r.failed}\u2717`;
    if (p.fetched + p.skipped + p.failed > 0) line += ` | photos: ${p.fetched}\u2713 ${p.skipped}\u2298 ${p.failed}\u2717`;
    if (ai.fetched + ai.skipped + ai.failed > 0) line += ` | ai-reviews: ${ai.fetched}\u2713 ${ai.skipped}\u2298 ${ai.failed}\u2717`;
    console.log(line);
  }
  if (preprocessed.booking.count > 0) {
    const { details: d, reviews: r, photos: p, aiReviews: ai } = bookingResult;
    let line = `  Booking: ${bookingResult.total} listings`;
    if (d.fetched + d.skipped + d.failed > 0) line += ` | details: ${d.fetched}\u2713 ${d.skipped}\u2298 ${d.failed}\u2717`;
    if (r.fetched + r.skipped + r.failed > 0) line += ` | reviews: ${r.fetched}\u2713 ${r.skipped}\u2298 ${r.failed}\u2717`;
    if (p.fetched + p.skipped + p.failed > 0) line += ` | photos: ${p.fetched}\u2713 ${p.skipped}\u2298 ${p.failed}\u2717`;
    if (ai.fetched + ai.skipped + ai.failed > 0) line += ` | ai-reviews: ${ai.fetched}\u2713 ${ai.skipped}\u2298 ${ai.failed}\u2717`;
    console.log(line);
  }
  console.log(`  Time: ${formatDuration(totalTimeMs)}`);

  const allErrors = [...airbnbResult.errors, ...bookingResult.errors];
  if (allErrors.length > 0) {
    console.log(`  Errors (${allErrors.length}):`);
    for (const err of allErrors) {
      console.log(`    ${err.id} ${err.phase}: ${err.message}`);
    }
  }

  // Count failures/partials in manifest for retry hint
  let failureCount = 0;
  for (const entry of Object.values(manifest.listings)) {
    if (entry.details.status === 'failed' || entry.details.status === 'partial'
      || entry.reviews.status === 'failed' || entry.reviews.status === 'partial'
      || entry.photos.status === 'failed' || entry.photos.status === 'partial'
      || entry.aiReviews?.status === 'failed') {
      failureCount++;
    }
  }

  console.log(`  Manifest: ${manifestPath}`);

  // Auto-retry once if there are failures and this isn't already a retry pass
  if (failureCount > 0 && !options.retryFailed) {
    console.log(`\n  ${failureCount} listing${failureCount > 1 ? 's' : ''} with failures \u2014 auto-retrying...\n`);
    await runBatch([], { ...options, retryFailed: true });
  } else if (failureCount > 0) {
    console.log(`  ${failureCount} listing${failureCount > 1 ? 's' : ''} still failing \u2014 retry with: reviewr batch ${manifestPath} --retry`);
  }

  return { airbnb: airbnbResult, booking: bookingResult, totalTimeMs };
}
