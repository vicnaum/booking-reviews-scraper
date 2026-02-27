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

// --- Interfaces ---

export interface BatchOptions {
  fetchDetails: boolean;
  fetchReviews: boolean;
  fetchPhotos: boolean;
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
}

export interface ManifestEntry {
  platform: 'airbnb' | 'booking';
  id: string;
  url: string;
  details: ManifestPhase;
  reviews: ManifestPhase;
  photos: ManifestPhase;
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

function shouldRetryPhase(manifest: BatchManifest, key: string, phase: 'details' | 'reviews' | 'photos'): boolean {
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
    errors: [],
  };
}

// --- Main batch function ---

export async function runBatch(filePaths: string[], options: BatchOptions): Promise<BatchResult> {
  const startTime = Date.now();
  const manifestPath = getManifestPath(options);

  // 1. Load or create manifest
  const manifest: BatchManifest = loadManifest(manifestPath) || {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dates: {},
    listings: {},
  };

  // 2. Preprocess files (may be empty for --retry-only)
  const preprocessed = filePaths.length > 0
    ? preprocessFiles(filePaths)
    : { airbnb: { urls: [] as string[], count: 0, duplicatesRemoved: 0 }, booking: { urls: [] as string[], count: 0, duplicatesRemoved: 0 }, dates: { source: 'none' as const, checkIn: undefined, checkOut: undefined, adults: undefined } };

  // 3. If --retry, merge retry URLs from manifest
  if (options.retryFailed) {
    for (const [key, entry] of Object.entries(manifest.listings)) {
      const needsRetry = entry.details.status === 'failed' || entry.details.status === 'partial'
        || entry.reviews.status === 'failed' || entry.reviews.status === 'partial'
        || entry.photos.status === 'failed' || entry.photos.status === 'partial';
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
  console.log(`Fetching: ${phases.join(', ')}\n`);

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
          const detailsFile = path.join(airbnbOutputDir, `listing_${roomId}.json`);
          if (!options.force && fs.existsSync(detailsFile)) {
            statusParts.push('details \u2298 skip');
            airbnbResult.details.skipped++;
            entry.details = { status: 'skipped', file: `listing_${roomId}.json` };
            if (options.fetchPhotos) {
              try { details = JSON.parse(fs.readFileSync(detailsFile, 'utf-8')); } catch {}
            }
          } else {
            const t = Date.now();
            try {
              details = await airbnbListing.fetchListingDetails(apiKey, roomId, dateOpts);
              if (!options.print) {
                airbnbListing.saveListingDetails(details, `listing_${roomId}.json`, airbnbOutputDir);
              }
              statusParts.push(`details \u2713 (${formatDuration(Date.now() - t)})`);
              airbnbResult.details.fetched++;
              entry.details = { status: 'fetched', file: `listing_${roomId}.json` };
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
        const detailsFile = path.join(airbnbOutputDir, `listing_${roomId}.json`);
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
          const reviewsFile = path.join(airbnbOutputDir, `room_${roomId}_reviews.json`);
          if (!options.force && fs.existsSync(reviewsFile) && !shouldRetryPhase(manifest, manifestKey, 'reviews')) {
            statusParts.push('reviews \u2298 skip');
            airbnbResult.reviews.skipped++;
            entry.reviews = { status: 'skipped', file: `room_${roomId}_reviews.json` };
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
                if (!fs.existsSync(airbnbOutputDir)) fs.mkdirSync(airbnbOutputDir, { recursive: true });
                const output = {
                  scraped_at: new Date().toISOString(),
                  total_reviews: reviews.length,
                  properties_processed: [roomId],
                  reviews,
                };
                fs.writeFileSync(
                  path.join(airbnbOutputDir, `room_${roomId}_reviews.json`),
                  JSON.stringify(output, null, 2),
                );
              }
              statusParts.push(`reviews \u2713 ${reviews.length} (${formatDuration(Date.now() - t)})`);
              airbnbResult.reviews.fetched++;
              airbnbResult.reviews.totalReviewCount += reviews.length;

              // Review completeness check
              const expectedReviews = details?.reviewCount;
              if (expectedReviews && reviews.length < expectedReviews * 0.8) {
                entry.reviews = { status: 'partial', file: `room_${roomId}_reviews.json`, count: reviews.length, expected: expectedReviews };
                console.warn(`  Warning: got ${reviews.length}/${expectedReviews} reviews (partial)`);
              } else {
                entry.reviews = { status: 'fetched', file: `room_${roomId}_reviews.json`, count: reviews.length, expected: expectedReviews || undefined };
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
        const photosDir = path.join(airbnbOutputDir, `photos_${roomId}`);
        const dirExists = fs.existsSync(photosDir);
        const expectedPhotos = details?.photos?.length || 0;
        const actualPhotos = dirExists ? fs.readdirSync(photosDir).length : 0;
        const photosIncomplete = dirExists && details && expectedPhotos > 0 && actualPhotos < expectedPhotos;

        if (!options.force && dirExistsAndNonEmpty(photosDir) && !photosIncomplete) {
          statusParts.push('photos \u2298 skip');
          airbnbResult.photos.skipped++;
          entry.photos = { status: 'skipped', dir: `photos_${roomId}`, count: actualPhotos, expected: expectedPhotos || undefined };
        } else if (!details) {
          statusParts.push('photos \u2298 skip (no details)');
          airbnbResult.photos.skipped++;
          entry.photos = { status: 'skipped', reason: 'no details' };
        } else {
          if (photosIncomplete) {
            statusParts.push(`photos: ${actualPhotos}/${expectedPhotos} incomplete, re-downloading`);
          }
          try {
            await airbnbListing.downloadPhotos(details, airbnbOutputDir);
            const finalCount = fs.existsSync(photosDir) ? fs.readdirSync(photosDir).length : 0;
            if (expectedPhotos > 0 && finalCount < expectedPhotos) {
              statusParts.push(`photos \u2713 ${finalCount}/${expectedPhotos} (partial)`);
              entry.photos = { status: 'partial', dir: `photos_${roomId}`, count: finalCount, expected: expectedPhotos };
            } else {
              statusParts.push(`photos \u2713 ${finalCount}`);
              entry.photos = { status: 'fetched', dir: `photos_${roomId}`, count: finalCount, expected: expectedPhotos || undefined };
            }
            airbnbResult.photos.fetched++;
          } catch (err: any) {
            statusParts.push('photos \u2717 error');
            airbnbResult.photos.failed++;
            airbnbResult.errors.push({ id: roomId, phase: 'photos', message: err.message });
            entry.photos = { status: 'failed', dir: `photos_${roomId}`, error: err.message };
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
        const detailsFile = path.join(bookingOutputDir, `listing_${id}.json`);
        if (!options.force && fs.existsSync(detailsFile)) {
          statusParts.push('details \u2298 skip');
          bookingResult.details.skipped++;
          entry.details = { status: 'skipped', file: `listing_${id}.json` };
          if (options.fetchPhotos) {
            try { details = JSON.parse(fs.readFileSync(detailsFile, 'utf-8')); } catch {}
          }
        } else {
          const t = Date.now();
          try {
            details = await bookingListing.scrapeListingDetails(url, dateOpts);
            if (!options.print) {
              bookingListing.saveListingDetails(details, `listing_${id}.json`, bookingOutputDir);
            }
            statusParts.push(`details \u2713 (${formatDuration(Date.now() - t)})`);
            bookingResult.details.fetched++;
            entry.details = { status: 'fetched', file: `listing_${id}.json` };
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
        const detailsFile = path.join(bookingOutputDir, `listing_${id}.json`);
        if (fs.existsSync(detailsFile)) {
          try { details = JSON.parse(fs.readFileSync(detailsFile, 'utf-8')); } catch {}
        }
      }

      // --- Reviews ---
      if (doReviews) {
        const reviewsFile = path.join(bookingOutputDir, `${id}_reviews.json`);
        if (!options.force && fs.existsSync(reviewsFile) && !shouldRetryPhase(manifest, manifestKey, 'reviews')) {
          statusParts.push('reviews \u2298 skip');
          bookingResult.reviews.skipped++;
          entry.reviews = { status: 'skipped', file: `${id}_reviews.json` };
        } else {
          const t = Date.now();
          try {
            const reviews = await bookingScraper.scrapeHotelReviews(hotelInfo);
            if (!options.print) {
              if (!fs.existsSync(bookingOutputDir)) fs.mkdirSync(bookingOutputDir, { recursive: true });
              const output = {
                scraped_at: new Date().toISOString(),
                total_reviews: reviews.length,
                hotels_processed: [id],
                reviews,
              };
              fs.writeFileSync(
                path.join(bookingOutputDir, `${id}_reviews.json`),
                JSON.stringify(output, null, 2),
              );
            }
            statusParts.push(`reviews \u2713 ${reviews.length} (${formatDuration(Date.now() - t)})`);
            bookingResult.reviews.fetched++;
            bookingResult.reviews.totalReviewCount += reviews.length;

            // Review completeness check
            const expectedReviews = details?.reviewCount;
            if (expectedReviews && reviews.length < expectedReviews * 0.8) {
              entry.reviews = { status: 'partial', file: `${id}_reviews.json`, count: reviews.length, expected: expectedReviews };
              console.warn(`  Warning: got ${reviews.length}/${expectedReviews} reviews (partial)`);
            } else {
              entry.reviews = { status: 'fetched', file: `${id}_reviews.json`, count: reviews.length, expected: expectedReviews || undefined };
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
        const photosDir = path.join(bookingOutputDir, `photos_${id}`);
        const dirExists = fs.existsSync(photosDir);
        const expectedPhotos = details?.photos?.length || 0;
        const actualPhotos = dirExists ? fs.readdirSync(photosDir).length : 0;
        const photosIncomplete = dirExists && details && expectedPhotos > 0 && actualPhotos < expectedPhotos;

        if (!options.force && dirExistsAndNonEmpty(photosDir) && !photosIncomplete) {
          statusParts.push('photos \u2298 skip');
          bookingResult.photos.skipped++;
          entry.photos = { status: 'skipped', dir: `photos_${id}`, count: actualPhotos, expected: expectedPhotos || undefined };
        } else if (!details) {
          statusParts.push('photos \u2298 skip (no details)');
          bookingResult.photos.skipped++;
          entry.photos = { status: 'skipped', reason: 'no details' };
        } else {
          if (photosIncomplete) {
            statusParts.push(`photos: ${actualPhotos}/${expectedPhotos} incomplete, re-downloading`);
          }
          try {
            await bookingListing.downloadPhotos(details, bookingOutputDir, {
              downloadAll: options.downloadPhotosAll,
            });
            const finalCount = fs.existsSync(photosDir) ? fs.readdirSync(photosDir).length : 0;
            if (expectedPhotos > 0 && finalCount < expectedPhotos) {
              statusParts.push(`photos \u2713 ${finalCount}/${expectedPhotos} (partial)`);
              entry.photos = { status: 'partial', dir: `photos_${id}`, count: finalCount, expected: expectedPhotos };
            } else {
              statusParts.push(`photos \u2713 ${finalCount}`);
              entry.photos = { status: 'fetched', dir: `photos_${id}`, count: finalCount, expected: expectedPhotos || undefined };
            }
            bookingResult.photos.fetched++;
          } catch (err: any) {
            statusParts.push('photos \u2717 error');
            bookingResult.photos.failed++;
            bookingResult.errors.push({ id, phase: 'photos', message: err.message });
            entry.photos = { status: 'failed', dir: `photos_${id}`, error: err.message };
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

  const totalTimeMs = Date.now() - startTime;

  // 8. Final manifest save
  saveManifest(manifest, manifestPath);

  // 9. Print summary
  console.log('\nSummary:');
  if (preprocessed.airbnb.count > 0) {
    const { details: d, reviews: r, photos: p } = airbnbResult;
    let line = `  Airbnb:  ${airbnbResult.total} listings`;
    if (d.fetched + d.skipped + d.failed > 0) line += ` | details: ${d.fetched}\u2713 ${d.skipped}\u2298 ${d.failed}\u2717`;
    if (r.fetched + r.skipped + r.failed > 0) line += ` | reviews: ${r.fetched}\u2713 ${r.skipped}\u2298 ${r.failed}\u2717`;
    if (p.fetched + p.skipped + p.failed > 0) line += ` | photos: ${p.fetched}\u2713 ${p.skipped}\u2298 ${p.failed}\u2717`;
    console.log(line);
  }
  if (preprocessed.booking.count > 0) {
    const { details: d, reviews: r, photos: p } = bookingResult;
    let line = `  Booking: ${bookingResult.total} listings`;
    if (d.fetched + d.skipped + d.failed > 0) line += ` | details: ${d.fetched}\u2713 ${d.skipped}\u2298 ${d.failed}\u2717`;
    if (r.fetched + r.skipped + r.failed > 0) line += ` | reviews: ${r.fetched}\u2713 ${r.skipped}\u2298 ${r.failed}\u2717`;
    if (p.fetched + p.skipped + p.failed > 0) line += ` | photos: ${p.fetched}\u2713 ${p.skipped}\u2298 ${p.failed}\u2717`;
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
      || entry.photos.status === 'failed' || entry.photos.status === 'partial') {
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
