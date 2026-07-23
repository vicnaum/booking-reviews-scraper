import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ArtifactCache,
  buildDetailsCacheVariant,
  buildPhotosCacheVariant,
  createArtifactCache,
  resolveArtifactCachePolicy,
  type ArtifactCacheKey,
} from '../src/artifact-cache.js';
import { runBatch } from '../src/batch.js';

const DAY_MS = 24 * 60 * 60 * 1000;

test('cache policy uses the approved TTLs and supports per-artifact opt-out', () => {
  const policy = resolveArtifactCachePolicy({
    REVIEWR_CACHE_DIR: '/tmp/reviewr-test-cache',
    REVIEWR_CACHE_DETAILS_TTL_DAYS: '2.5',
    REVIEWR_CACHE_REVIEWS_TTL_DAYS: '0',
    REVIEWR_CACHE_PHOTOS_TTL_DAYS: '365',
  });

  assert.equal(policy.rootDir, '/tmp/reviewr-test-cache');
  assert.equal(policy.ttlMs.details, 2.5 * DAY_MS);
  assert.equal(policy.ttlMs.reviews, 0);
  assert.equal(policy.ttlMs.photos, 365 * DAY_MS);

  const defaults = resolveArtifactCachePolicy({});
  assert.equal(defaults.ttlMs.details, 7 * DAY_MS);
  assert.equal(defaults.ttlMs.reviews, 30 * DAY_MS);
  assert.equal(defaults.ttlMs.photos, 180 * DAY_MS);
  assert.match(defaults.rootDir, /\.cache[/\\]reviewr[/\\]artifacts-v1$/);

  assert.throws(
    () => resolveArtifactCachePolicy({ REVIEWR_CACHE_DETAILS_TTL_DAYS: '-1' }),
    /non-negative number/,
  );
});

test('details cache isolates request variants and expires from metadata time', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewr-cache-'));
  let now = Date.parse('2026-07-23T10:00:00.000Z');
  const cache = createArtifactCache({
    rootDir: path.join(tempDir, 'cache'),
    now: () => now,
  });
  const sourcePath = path.join(tempDir, 'source.json');
  const restoredPath = path.join(tempDir, 'restored.json');
  const key: ArtifactCacheKey = {
    platform: 'booking',
    listingId: 'pl/example-hotel',
    artifact: 'details',
    variant: buildDetailsCacheVariant({
      checkIn: '2026-08-01',
      checkOut: '2026-08-05',
      adults: 2,
      linkedRoomId: '123',
    }),
  };
  fs.writeFileSync(sourcePath, JSON.stringify({ title: 'Fresh details' }));

  try {
    const metadata = cache.publishFile(key, sourcePath);
    assert.equal(metadata?.cachedAt, '2026-07-23T10:00:00.000Z');

    now += 6 * DAY_MS;
    const hit = cache.restoreFile(key, restoredPath);
    assert.equal(hit?.ageMs, 6 * DAY_MS);
    assert.deepEqual(JSON.parse(fs.readFileSync(restoredPath, 'utf-8')), {
      title: 'Fresh details',
    });

    const differentDates = {
      ...key,
      variant: buildDetailsCacheVariant({
        checkIn: '2026-09-01',
        checkOut: '2026-09-05',
        adults: 2,
        linkedRoomId: '123',
      }),
    };
    assert.equal(cache.restoreFile(differentDates, restoredPath), null);

    now += DAY_MS + 1;
    assert.equal(cache.restoreFile(key, restoredPath), null);
    assert.equal(fs.existsSync(cache.getEntryPath(key)), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('photo cache variants isolate Booking room selection and restore complete directories', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewr-photo-cache-'));
  const cache = createArtifactCache({ rootDir: path.join(tempDir, 'cache') });
  const sourceDir = path.join(tempDir, 'source-photos');
  const restoredDir = path.join(tempDir, 'restored-photos');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, '01.jpg'), 'one');
  fs.writeFileSync(path.join(sourceDir, '02.jpg'), 'two');
  const roomKey: ArtifactCacheKey = {
    platform: 'booking',
    listingId: 'pl/example-hotel',
    artifact: 'photos',
    variant: buildPhotosCacheVariant({
      platform: 'booking',
      linkedRoomId: '123',
      downloadAll: false,
    }),
  };

  try {
    cache.publishDirectory(roomKey, sourceDir, { count: 2, expected: 2 });
    const hit = cache.restoreDirectory(roomKey, restoredDir);
    assert.equal(hit?.count, 2);
    assert.deepEqual(fs.readdirSync(restoredDir).sort(), ['01.jpg', '02.jpg']);

    const otherRoomKey = {
      ...roomKey,
      variant: buildPhotosCacheVariant({
        platform: 'booking',
        linkedRoomId: '456',
        downloadAll: false,
      }),
    };
    assert.equal(cache.restoreDirectory(otherRoomKey, restoredDir), null);

    const otherCountryKey = {
      ...roomKey,
      listingId: 'us/example-hotel',
    };
    assert.notEqual(cache.getEntryPath(roomKey), cache.getEntryPath(otherCountryKey));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('shared batch path restores all Airbnb scrape artifacts without an upstream request', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewr-batch-cache-'));
  const cache = new ArtifactCache(
    resolveArtifactCachePolicy({}, path.join(tempDir, 'cache')),
    () => Date.parse('2026-07-23T10:00:00.000Z'),
  );
  const seedDir = path.join(tempDir, 'seed');
  const outputDir = path.join(tempDir, 'output');
  const urlsFile = path.join(tempDir, 'urls.txt');
  const roomId = '123456789';
  fs.mkdirSync(seedDir, { recursive: true });
  fs.writeFileSync(urlsFile, `https://www.airbnb.com/rooms/${roomId}\n`);

  const detailsPath = path.join(seedDir, 'details.json');
  const reviewsPath = path.join(seedDir, 'reviews.json');
  const photosPath = path.join(seedDir, 'photos');
  fs.mkdirSync(photosPath, { recursive: true });
  fs.writeFileSync(path.join(photosPath, '01.jpeg'), 'photo');
  fs.writeFileSync(
    detailsPath,
    JSON.stringify({
      id: roomId,
      title: 'Cached listing',
      reviewCount: 1,
      photos: [{ url: 'https://example.com/photo.jpeg', caption: null }],
    }),
  );
  fs.writeFileSync(
    reviewsPath,
    JSON.stringify({
      scraped_at: '2026-07-23T10:00:00.000Z',
      total_reviews: 1,
      properties_processed: [roomId],
      reviews: [{ review_id: 'review-1', review_text: 'Cached review' }],
    }),
  );

  cache.publishFile({
    platform: 'airbnb',
    listingId: roomId,
    artifact: 'details',
    variant: buildDetailsCacheVariant({}),
  }, detailsPath);
  cache.publishFile({
    platform: 'airbnb',
    listingId: roomId,
    artifact: 'reviews',
  }, reviewsPath, { count: 1, expected: 1 });
  cache.publishDirectory({
    platform: 'airbnb',
    listingId: roomId,
    artifact: 'photos',
    variant: buildPhotosCacheVariant({ platform: 'airbnb' }),
  }, photosPath, { count: 1, expected: 1 });

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };

  try {
    await runBatch([urlsFile], {
      fetchDetails: true,
      fetchReviews: true,
      fetchPhotos: true,
      aiReviews: false,
      aiPhotos: false,
      triage: false,
      aiReviewsExplicit: false,
      aiPhotosExplicit: false,
      triageExplicit: false,
      force: false,
      retryFailed: false,
      downloadPhotosAll: false,
      outputDir,
      print: false,
      artifactCache: cache,
    });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'batch_manifest.json'), 'utf-8'),
    );
    const entry = manifest.listings[`airbnb/${roomId}`];
    assert.equal(entry.details.source, 'cache');
    assert.equal(entry.reviews.source, 'cache');
    assert.equal(entry.photos.source, 'cache');
    assert.equal(entry.details.status, 'fetched');
    assert.equal(entry.reviews.status, 'fetched');
    assert.equal(entry.photos.status, 'fetched');
    assert.equal(entry.reviews.count, 1);
    assert.equal(entry.photos.count, 1);
    assert.match(logs.join('\n'), /details .* cache/);
    assert.match(logs.join('\n'), /reviews .* cache/);
    assert.match(logs.join('\n'), /photos .* cache/);
    assert.doesNotMatch(logs.join('\n'), /Fetching AirBnB API key/);
  } finally {
    console.log = originalLog;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
