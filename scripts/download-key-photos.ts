#!/usr/bin/env npx tsx
// scripts/download-key-photos.ts
// Downloads 4-6 key photos per listing for visual analysis
// Usage: npx tsx scripts/download-key-photos.ts

import * as fs from 'fs';
import * as path from 'path';
import https from 'https';
import http from 'http';

const AIRBNB_DIR = 'data/airbnb/output/rome-listings';
const BOOKING_DIR = 'data/booking/output/rome-listings';
const OUTPUT_DIR = 'data/rome-analysis/photos';
const MANIFEST_PATH = 'data/rome-analysis/photo_manifest.json';
const CONCURRENCY = 10;

interface Photo {
  url: string;
  caption: string | null;
  role: string; // hero, bedroom1, bedroom2, bathroom, living, view
}

interface ListingPhotos {
  id: string;
  platform: string;
  title: string;
  photos: Photo[];
}

// Get best download URL for a Booking photo (prefer highresUrl with auth params)
function getBookingPhotoUrl(photo: any): string {
  // highresUrl has auth params (?k=...&o=&hp=1) that bypass 401
  if (photo.highresUrl) return photo.highresUrl;
  return photo.url;
}

// Caption-based photo selection for Booking (has descriptive captions)
function selectBookingPhotos(photos: any[]): Photo[] {
  const selected: Photo[] = [];
  const used = new Set<number>();

  // Always include first photo as hero
  if (photos.length > 0) {
    selected.push({ url: getBookingPhotoUrl(photos[0]), caption: photos[0].caption, role: 'hero' });
    used.add(0);
  }

  const patterns: [RegExp, string, number][] = [
    [/bedroom|master|double bed|queen|king|twin bed|single bed/i, 'bedroom1', 1],
    [/bedroom|master|double bed|queen|king|twin bed|single bed/i, 'bedroom2', 1],
    [/bathroom|shower|bathtub|toilet/i, 'bathroom', 1],
    [/living|sofa|couch|lounge|sitting/i, 'living', 1],
    [/balcony|terrace|view|panoram|rooftop/i, 'view', 1],
    [/kitchen|dining|cook/i, 'kitchen', 1],
  ];

  for (const [pattern, role, max] of patterns) {
    let found = 0;
    for (let i = 0; i < photos.length && found < max; i++) {
      if (used.has(i)) continue;
      const cap = photos[i].caption || '';
      if (pattern.test(cap)) {
        if (role === 'bedroom2') {
          const bed1 = selected.find(s => s.role === 'bedroom1');
          if (bed1 && bed1.url === getBookingPhotoUrl(photos[i])) continue;
        }
        selected.push({ url: getBookingPhotoUrl(photos[i]), caption: photos[i].caption, role });
        used.add(i);
        found++;
      }
    }
  }

  // If we have fewer than 4, fill with unused photos
  for (let i = 0; i < photos.length && selected.length < 6; i++) {
    if (!used.has(i)) {
      selected.push({ url: getBookingPhotoUrl(photos[i]), caption: photos[i].caption, role: `extra${i}` });
      used.add(i);
    }
  }

  return selected.slice(0, 6);
}

// For Airbnb (generic captions), just take first 6 photos
function selectAirbnbPhotos(photos: any[]): Photo[] {
  const roles = ['hero', 'photo2', 'photo3', 'photo4', 'photo5', 'photo6'];
  return photos.slice(0, 6).map((p, i) => ({
    url: p.url,
    caption: p.caption,
    role: roles[i] || `photo${i + 1}`,
  }));
}

function getDownloadUrl(url: string, platform: string): string {
  if (platform === 'airbnb') {
    // Airbnb: append ?im_w=720 for reduced resolution
    return url.includes('?') ? `${url}&im_w=720` : `${url}?im_w=720`;
  } else {
    // Booking: highresUrl already has auth params, use as-is
    return url;
  }
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadFile(redirectUrl, dest).then(resolve).catch(reject);
          return;
        }
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('Timeout')); });
  });
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

async function main() {
  console.log('=== Rome Listing Photo Downloader ===\n');

  // Read all listing JSONs
  const manifest: ListingPhotos[] = [];
  const downloads: { url: string; dest: string; listingId: string }[] = [];

  // Process Airbnb listings
  const airbnbFiles = fs.readdirSync(AIRBNB_DIR)
    .filter(f => f.startsWith('listing_') && f.endsWith('.json'));
  console.log(`Found ${airbnbFiles.length} Airbnb listings`);

  for (const file of airbnbFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(AIRBNB_DIR, file), 'utf-8'));
    if (!data.photos || data.photos.length === 0) continue;

    const selected = selectAirbnbPhotos(data.photos);
    const dirName = `airbnb_${data.id}`;
    const dirPath = path.join(OUTPUT_DIR, dirName);
    fs.mkdirSync(dirPath, { recursive: true });

    manifest.push({
      id: data.id,
      platform: 'airbnb',
      title: data.title,
      photos: selected,
    });

    for (const photo of selected) {
      const ext = 'jpg';
      const filename = `${photo.role}.${ext}`;
      const dest = path.join(dirPath, filename);
      if (!fs.existsSync(dest)) {
        downloads.push({
          url: getDownloadUrl(photo.url, 'airbnb'),
          dest,
          listingId: data.id,
        });
      }
    }
  }

  // Process Booking listings
  const bookingFiles = fs.readdirSync(BOOKING_DIR)
    .filter(f => f.startsWith('listing_') && f.endsWith('.json'));
  console.log(`Found ${bookingFiles.length} Booking listings`);

  for (const file of bookingFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(BOOKING_DIR, file), 'utf-8'));
    if (!data.photos || data.photos.length === 0) continue;

    const selected = selectBookingPhotos(data.photos);
    const dirName = `booking_${data.id}`;
    const dirPath = path.join(OUTPUT_DIR, dirName);
    fs.mkdirSync(dirPath, { recursive: true });

    manifest.push({
      id: data.id,
      platform: 'booking',
      title: data.title,
      photos: selected,
    });

    for (const photo of selected) {
      const ext = 'jpg';
      const filename = `${photo.role}.${ext}`;
      const dest = path.join(dirPath, filename);
      if (!fs.existsSync(dest)) {
        downloads.push({
          url: getDownloadUrl(photo.url, 'booking'),
          dest,
          listingId: data.id,
        });
      }
    }
  }

  console.log(`\nTotal listings: ${manifest.length}`);
  console.log(`Photos to download: ${downloads.length}`);

  // Save manifest
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`Manifest saved to ${MANIFEST_PATH}`);

  // Download with concurrency
  let completed = 0;
  let failed = 0;
  const startTime = Date.now();

  await processWithConcurrency(downloads, CONCURRENCY, async (dl) => {
    try {
      await downloadFile(dl.url, dl.dest);
      completed++;
      if (completed % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  Downloaded ${completed}/${downloads.length} (${elapsed}s)`);
      }
    } catch (err: any) {
      failed++;
      console.error(`  FAIL [${dl.listingId}]: ${err.message}`);
    }
  });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone! ${completed} downloaded, ${failed} failed in ${totalTime}s`);
}

main().catch(console.error);
