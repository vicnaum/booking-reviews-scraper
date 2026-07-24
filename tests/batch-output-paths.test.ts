import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveBatchOutputDir, runBatch } from '../src/batch.js';

const repositoryRoot = process.cwd();
const bookingUrl =
  'https://www.booking.com/hotel/us/example-hotel.en-gb.html';

function canonicalPath(filePath: string): string {
  return fs.realpathSync(filePath);
}

function writeBookingFixture(rootDir: string): {
  listingFile: string;
  reviewsFile: string;
  photosDir: string;
} {
  const listingFile = path.join(
    rootDir,
    'listings',
    'listing_example-hotel.json',
  );
  const reviewsFile = path.join(
    rootDir,
    'reviews',
    'example-hotel_reviews.json',
  );
  const photosDir = path.join(rootDir, 'photos', 'example-hotel');

  fs.mkdirSync(path.dirname(listingFile), { recursive: true });
  fs.mkdirSync(path.dirname(reviewsFile), { recursive: true });
  fs.mkdirSync(photosDir, { recursive: true });
  fs.writeFileSync(
    listingFile,
    JSON.stringify({
      id: 'example-hotel',
      url: bookingUrl,
      linkedRoomId: null,
      reviewCount: 1,
      photos: [{ associatedRooms: [] }],
    }),
  );
  fs.writeFileSync(
    reviewsFile,
    JSON.stringify({
      scraped_at: '2026-07-24T00:00:00.000Z',
      total_reviews: 1,
      hotels_processed: ['example-hotel'],
      reviews: [{ review_id: 'one' }],
    }),
  );
  fs.writeFileSync(path.join(photosDir, 'one.jpg'), 'fixture');

  return { listingFile, reviewsFile, photosDir };
}

test('default batch output directories are platform-specific', () => {
  assert.equal(
    resolveBatchOutputDir({}, 'booking'),
    path.join('data', 'booking', 'output'),
  );
  assert.equal(
    resolveBatchOutputDir({}, 'airbnb'),
    path.join('data', 'airbnb', 'output'),
  );
  assert.equal(
    resolveBatchOutputDir({ outputDir: '/tmp/reviewr-output' }, 'booking'),
    '/tmp/reviewr-output',
  );
});

test('default-dir resumed Booking artifacts remain eligible for every AI phase', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewr-batch-paths-'));
  const originalCwd = process.cwd();
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;
  const platformOutputDir = path.join(
    tempDir,
    'data',
    'booking',
    'output',
  );
  const fixture = writeBookingFixture(platformOutputDir);
  const urlsFile = path.join(tempDir, 'urls.txt');
  fs.writeFileSync(urlsFile, `${bookingUrl}\n`);

  const manifestPath = path.join(tempDir, 'data', 'batch_manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      version: 2,
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      dates: {},
      listings: {
        'booking/unrelated-hotel': {
          platform: 'booking',
          id: 'unrelated-hotel',
          url: 'https://www.booking.com/hotel/it/unrelated-hotel.en-gb.html',
          details: { status: 'not_requested' },
          reviews: { status: 'not_requested' },
          photos: { status: 'not_requested' },
          aiReviews: { status: 'not_requested' },
          aiPhotos: { status: 'not_requested' },
          triage: { status: 'not_requested' },
        },
      },
    }),
  );

  const analyzerInputs: string[] = [];
  const checkpointOutputDirs: string[] = [];

  try {
    process.chdir(tempDir);
    process.env.GEMINI_API_KEY = 'fixture-key';

    const result = await runBatch(
      [urlsFile],
      {
        fetchDetails: true,
        fetchReviews: true,
        fetchPhotos: true,
        aiReviews: true,
        aiPhotos: true,
        triage: true,
        aiReviewsExplicit: true,
        aiPhotosExplicit: true,
        triageExplicit: true,
        force: false,
        retryFailed: false,
        downloadPhotosAll: false,
        scopeManifestToInput: true,
        print: false,
        artifactCache: null,
        hooks: {
          onBeforeAiCall: ({ outputDir }) => {
            checkpointOutputDirs.push(canonicalPath(outputDir));
          },
        },
      },
      {
        runAnalyze: async (options) => {
          analyzerInputs.push(canonicalPath(options.reviewsFile));
          assert.equal(
            canonicalPath(options.listingFile!),
            canonicalPath(fixture.listingFile),
          );
          return {
            data: { summary: 'fixture' },
            model: 'fixture-model',
            provider: 'gemini',
            multiYear: false,
            reviewSelection: {
              eligibleCount: 1,
              includedCount: 1,
              limit: 250,
              capped: false,
            },
          };
        },
        runAnalyzePhotos: async (options) => {
          analyzerInputs.push(canonicalPath(options.photosDir));
          assert.equal(
            canonicalPath(options.listingFile!),
            canonicalPath(fixture.listingFile),
          );
          return {
            data: { highlights: ['fixture'] },
            model: 'fixture-model',
            provider: 'gemini',
            photoCount: 1,
          };
        },
        runTriage: async (options) => {
          analyzerInputs.push(canonicalPath(options.listingFile));
          assert.equal(
            canonicalPath(options.aiReviewsFile!),
            canonicalPath(
              path.join(
                platformOutputDir,
                'ai-reviews',
                'example-hotel.json',
              ),
            ),
          );
          assert.equal(
            canonicalPath(options.aiPhotosFile!),
            canonicalPath(
              path.join(
                platformOutputDir,
                'ai-photos',
                'example-hotel.json',
              ),
            ),
          );
          return {
            data: { tier: 'shortlist', fitScore: 75 },
            model: 'fixture-model',
            provider: 'gemini',
          };
        },
      },
    );

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.deepEqual(Object.keys(manifest.listings), ['booking/example-hotel']);

    const entry = manifest.listings['booking/example-hotel'];
    assert.deepEqual(
      [entry.details.status, entry.details.source],
      ['skipped', 'local'],
    );
    assert.deepEqual(
      [entry.reviews.status, entry.reviews.source],
      ['skipped', 'local'],
    );
    assert.deepEqual(
      [entry.photos.status, entry.photos.source],
      ['skipped', 'local'],
    );
    assert.equal(entry.aiReviews.status, 'fetched');
    assert.equal(entry.aiPhotos.status, 'fetched');
    assert.equal(entry.triage.status, 'fetched');

    assert.deepEqual(analyzerInputs, [
      canonicalPath(fixture.reviewsFile),
      canonicalPath(fixture.photosDir),
      canonicalPath(fixture.listingFile),
    ]);
    assert.deepEqual(checkpointOutputDirs, [
      canonicalPath(platformOutputDir),
      canonicalPath(platformOutputDir),
      canonicalPath(platformOutputDir),
    ]);
    assert.equal(result.booking.aiReviews.fetched, 1);
    assert.equal(result.booking.aiPhotos.fetched, 1);
    assert.equal(result.booking.triage.fetched, 1);
    assert.equal(
      fs.existsSync(
        path.join(platformOutputDir, 'ai-reviews', 'example-hotel.json'),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(platformOutputDir, 'ai-photos', 'example-hotel.json'),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(platformOutputDir, 'triage', 'example-hotel.json'),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(tempDir, 'data', 'ai-reviews', 'example-hotel.json'),
      ),
      false,
    );
  } finally {
    process.chdir(originalCwd);
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch CLI accepts --output after the subcommand', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewr-cli-output-'));
  const outputDir = path.join(tempDir, 'custom-output');
  const urlsFile = path.join(tempDir, 'urls.txt');
  const cacheDir = path.join(tempDir, 'cache');
  writeBookingFixture(outputDir);
  fs.writeFileSync(urlsFile, `${bookingUrl}\n`);

  const cliPath = path.join(repositoryRoot, 'src', 'cli.ts');
  const tsxPath = path.join(repositoryRoot, 'node_modules', '.bin', 'tsx');

  try {
    const cliResult = spawnSync(
      tsxPath,
      [cliPath, 'batch', urlsFile, '--details', '--output', outputDir],
      {
        cwd: tempDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          REVIEWR_CACHE_DIR: cacheDir,
        },
      },
    );

    assert.equal(
      cliResult.status,
      0,
      `${cliResult.stdout}\n${cliResult.stderr}`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'batch_manifest.json'), 'utf-8'),
    );
    assert.equal(
      manifest.listings['booking/example-hotel'].details.source,
      'local',
    );
    assert.equal(
      fs.existsSync(path.join(tempDir, 'data', 'batch_manifest.json')),
      false,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
