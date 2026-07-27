import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveBatchOutputDir, runBatch } from '../src/batch.js';
import { buildCanonicalRequirementSet } from '../src/triage-rubric.js';
import { TRIAGE_CLASSIFIER_VERSION } from '../src/triage-comparability.js';

const repositoryRoot = process.cwd();
const bookingUrl =
  'https://www.booking.com/hotel/us/example-hotel.en-gb.html';
const fixtureRequirementSet = buildCanonicalRequirementSet({
  parserVersion: 'fixture-parser-v1',
  definitions: [{ label: 'Fixture quality', type: 'priority' }],
});

function canonicalPath(filePath: string): string {
  return fs.realpathSync(filePath);
}

function writeBookingFixture(
  rootDir: string,
  id = 'example-hotel',
  url = bookingUrl,
): {
  listingFile: string;
  reviewsFile: string;
  photosDir: string;
} {
  const listingFile = path.join(
    rootDir,
    'listings',
    `listing_${id}.json`,
  );
  const reviewsFile = path.join(
    rootDir,
    'reviews',
    `${id}_reviews.json`,
  );
  const photosDir = path.join(rootDir, 'photos', id);

  fs.mkdirSync(path.dirname(listingFile), { recursive: true });
  fs.mkdirSync(path.dirname(reviewsFile), { recursive: true });
  fs.mkdirSync(photosDir, { recursive: true });
  fs.writeFileSync(
    listingFile,
    JSON.stringify({
      id,
      url,
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

test('Airbnb details with missing core fields are recorded as partial', async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'reviewr-airbnb-details-partial-'),
  );
  const outputDir = path.join(tempDir, 'output');
  const listingsDir = path.join(outputDir, 'listings');
  const urlsFile = path.join(tempDir, 'urls.txt');
  const roomId = '51945222';

  try {
    fs.mkdirSync(listingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(listingsDir, `listing_${roomId}.json`),
      JSON.stringify({
        id: roomId,
        url: `https://www.airbnb.com/rooms/${roomId}`,
        title: '',
        rating: null,
        reviewCount: null,
        amenities: [],
        photos: [],
      }),
    );
    fs.writeFileSync(
      urlsFile,
      `https://www.airbnb.com/rooms/${roomId}\n`,
    );

    const result = await runBatch(
      [urlsFile],
      {
        fetchDetails: true,
        fetchReviews: false,
        fetchPhotos: false,
        aiReviews: false,
        aiPhotos: false,
        triage: false,
        aiReviewsExplicit: false,
        aiPhotosExplicit: false,
        triageExplicit: false,
        force: false,
        retryFailed: true,
        downloadPhotosAll: false,
        outputDir,
        scopeManifestToInput: true,
        print: false,
        artifactCache: null,
      },
    );

    const manifest = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'batch_manifest.json'), 'utf8'),
    );
    assert.deepEqual(
      manifest.listings[`airbnb/${roomId}`].details,
      {
        status: 'partial',
        file: `listings/listing_${roomId}.json`,
        source: 'local',
        reason:
          'missing_core_fields:missing_title,missing_rating,missing_amenities',
        error:
          'Airbnb details incomplete: missing title, rating, amenities',
      },
    );
    assert.equal(result.airbnb.details.partial, 1);
    assert.equal(result.airbnb.details.fetched, 0);
    assert.equal(result.airbnb.details.skipped, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch freezes one canonical requirement set and reloads it on rerun', async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'reviewr-requirement-set-'),
  );
  const outputDir = path.join(tempDir, 'output');
  const manifestPath = path.join(outputDir, 'batch_manifest.json');
  const urlsFile = path.join(tempDir, 'urls.txt');
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;
  const ids = ['first-hotel', 'second-hotel'];
  const urls = ids.map(
    (id) => `https://www.booking.com/hotel/us/${id}.en-gb.html`,
  );
  const reusableSet = buildCanonicalRequirementSet({
    parserVersion: 'triage-default-requirements-v1',
    definitions: [{ label: 'Frozen quality', type: 'priority' }],
  });

  try {
    for (let index = 0; index < ids.length; index++) {
      writeBookingFixture(outputDir, ids[index], urls[index]);
    }
    fs.writeFileSync(urlsFile, `${urls.join('\n')}\n`);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 2,
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
        dates: {},
        listings: Object.fromEntries(
          ids.map((id, index) => [
            `booking/${id}`,
            {
              platform: 'booking',
              id,
              url: urls[index],
              details: {
                status: 'fetched',
                file: `listings/listing_${id}.json`,
              },
              reviews: { status: 'skipped', reason: 'not needed' },
              photos: { status: 'skipped', reason: 'not needed' },
              aiReviews: { status: 'skipped', reason: 'not needed' },
              aiPhotos: { status: 'skipped', reason: 'not needed' },
              triage: { status: 'not_requested' },
            },
          ]),
        ),
      }),
    );
    process.env.GEMINI_API_KEY = 'fixture-key';

    const firstRunSets: Array<string | null> = [];
    await runBatch(
      [urlsFile],
      {
        fetchDetails: false,
        fetchReviews: false,
        fetchPhotos: false,
        aiReviews: false,
        aiPhotos: false,
        triage: true,
        aiReviewsExplicit: false,
        aiPhotosExplicit: false,
        triageExplicit: true,
        force: false,
        retryFailed: false,
        downloadPhotosAll: false,
        outputDir,
        scopeManifestToInput: true,
        print: false,
        artifactCache: null,
      },
      {
        runTriage: async (options) => {
          firstRunSets.push(options.requirementSet?.id ?? null);
          return {
            data: { tier: 'shortlist', fitScore: 75 },
            model: 'fixture-model',
            provider: 'gemini',
            classifierVersion: TRIAGE_CLASSIFIER_VERSION,
            modelId: 'gemini:fixture-model:default',
            requirementSet: options.requirementSet ?? reusableSet,
            evidenceGaps: [],
          };
        },
      },
    );

    assert.deepEqual(firstRunSets, [null, reusableSet.id]);
    const persistedSet = JSON.parse(
      fs.readFileSync(
        path.join(outputDir, 'triage-requirements.json'),
        'utf-8',
      ),
    );
    assert.equal(persistedSet.id, reusableSet.id);
    const persistedManifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf-8'),
    );
    assert.equal(persistedManifest.requirementSet.id, reusableSet.id);

    const rerunSets: string[] = [];
    await runBatch(
      [urlsFile],
      {
        fetchDetails: false,
        fetchReviews: false,
        fetchPhotos: false,
        aiReviews: false,
        aiPhotos: false,
        triage: true,
        aiReviewsExplicit: false,
        aiPhotosExplicit: false,
        triageExplicit: true,
        force: true,
        retryFailed: false,
        downloadPhotosAll: false,
        outputDir,
        scopeManifestToInput: true,
        print: false,
        artifactCache: null,
      },
      {
        runTriage: async (options) => {
          assert.ok(options.requirementSet);
          rerunSets.push(options.requirementSet.id);
          return {
            data: { tier: 'shortlist', fitScore: 75 },
            model: 'fixture-model',
            provider: 'gemini',
            classifierVersion: TRIAGE_CLASSIFIER_VERSION,
            modelId: 'gemini:fixture-model:default',
            requirementSet: options.requirementSet,
            evidenceGaps: [],
          };
        },
      },
    );
    assert.deepEqual(rerunSets, [reusableSet.id, reusableSet.id]);
  } finally {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
            classifierVersion: TRIAGE_CLASSIFIER_VERSION,
            modelId: 'gemini:fixture-model:default',
            requirementSet:
              options.requirementSet ?? fixtureRequirementSet,
            evidenceGaps: [],
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
    assert.deepEqual(entry.triage.evidenceGaps, []);

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

test('triage records missing review evidence in its artifact and manifest', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewr-triage-gaps-'));
  const outputDir = path.join(tempDir, 'output');
  const fixture = writeBookingFixture(outputDir);
  const urlsFile = path.join(tempDir, 'urls.txt');
  const manifestPath = path.join(outputDir, 'batch_manifest.json');
  const aiPhotosFile = path.join(
    outputDir,
    'ai-photos',
    'example-hotel.json',
  );
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;
  fs.rmSync(fixture.reviewsFile);
  fs.mkdirSync(path.dirname(aiPhotosFile), { recursive: true });
  fs.writeFileSync(aiPhotosFile, JSON.stringify({ highlights: ['fixture'] }));
  fs.writeFileSync(urlsFile, `${bookingUrl}\n`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      version: 2,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
      dates: {},
      listings: {
        'booking/example-hotel': {
          platform: 'booking',
          id: 'example-hotel',
          url: bookingUrl,
          details: {
            status: 'fetched',
            file: 'listings/listing_example-hotel.json',
          },
          reviews: { status: 'skipped', reason: 'no reviews' },
          photos: {
            status: 'fetched',
            dir: 'photos/example-hotel',
          },
          aiReviews: {
            status: 'skipped',
            reason: 'no reviews',
          },
          aiPhotos: {
            status: 'fetched',
            file: 'ai-photos/example-hotel.json',
          },
          triage: { status: 'not_requested' },
        },
      },
    }),
  );

  const triageEvents: Array<{ level: string; message: string; payload?: Record<string, unknown> }> = [];

  try {
    process.env.GEMINI_API_KEY = 'fixture-key';
    const result = await runBatch(
      [urlsFile],
      {
        fetchDetails: false,
        fetchReviews: false,
        fetchPhotos: false,
        aiReviews: false,
        aiPhotos: false,
        triage: true,
        aiReviewsExplicit: false,
        aiPhotosExplicit: false,
        triageExplicit: true,
        force: false,
        retryFailed: false,
        downloadPhotosAll: false,
        outputDir,
        scopeManifestToInput: true,
        print: false,
        artifactCache: null,
        hooks: {
          onEvent: (event) => {
            if (event.phase === 'triage') triageEvents.push(event);
          },
        },
      },
      {
        runTriage: async (options) => {
          assert.equal(options.aiReviewsFile, undefined);
          assert.equal(
            canonicalPath(options.aiPhotosFile!),
            canonicalPath(aiPhotosFile),
          );
          return {
            data: { tier: 'consider', fitScore: 55 },
            model: 'fixture-model',
            provider: 'gemini',
            classifierVersion: TRIAGE_CLASSIFIER_VERSION,
            modelId: 'gemini:fixture-model:default',
            requirementSet:
              options.requirementSet ?? fixtureRequirementSet,
            evidenceGaps: [],
          };
        },
      },
    );

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.deepEqual(
      manifest.listings['booking/example-hotel'].triage.evidenceGaps,
      ['reviews'],
    );

    const triageJson = JSON.parse(
      fs.readFileSync(
        path.join(outputDir, 'triage', 'example-hotel.json'),
        'utf-8',
      ),
    );
    assert.deepEqual(triageJson.evidenceGaps, ['reviews']);
    assert.equal(result.booking.triage.fetched, 1);

    const completedEvent = triageEvents.find((event) =>
      event.message.startsWith('triage ✓'));
    assert.ok(completedEvent);
    assert.equal(completedEvent.level, 'warning');
    assert.deepEqual(completedEvent.payload?.evidenceGaps, ['reviews']);
    assert.match(completedEvent.message, /graded without reviews/);
  } finally {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('triage records missing photo evidence in its artifact and manifest', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewr-triage-photo-gap-'));
  const outputDir = path.join(tempDir, 'output');
  const fixture = writeBookingFixture(outputDir);
  const urlsFile = path.join(tempDir, 'urls.txt');
  const manifestPath = path.join(outputDir, 'batch_manifest.json');
  const aiReviewsFile = path.join(
    outputDir,
    'ai-reviews',
    'example-hotel.json',
  );
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;
  fs.mkdirSync(path.dirname(aiReviewsFile), { recursive: true });
  fs.writeFileSync(aiReviewsFile, JSON.stringify({ summary: 'fixture' }));
  fs.writeFileSync(urlsFile, `${bookingUrl}\n`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      version: 2,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
      dates: {},
      listings: {
        'booking/example-hotel': {
          platform: 'booking',
          id: 'example-hotel',
          url: bookingUrl,
          details: {
            status: 'fetched',
            file: 'listings/listing_example-hotel.json',
          },
          reviews: {
            status: 'fetched',
            file: 'reviews/example-hotel_reviews.json',
          },
          photos: { status: 'skipped', reason: 'no photos' },
          aiReviews: {
            status: 'fetched',
            file: 'ai-reviews/example-hotel.json',
          },
          aiPhotos: { status: 'skipped', reason: 'no photos' },
          triage: { status: 'not_requested' },
        },
      },
    }),
  );

  try {
    process.env.GEMINI_API_KEY = 'fixture-key';
    await runBatch(
      [urlsFile],
      {
        fetchDetails: false,
        fetchReviews: false,
        fetchPhotos: false,
        aiReviews: false,
        aiPhotos: false,
        triage: true,
        aiReviewsExplicit: false,
        aiPhotosExplicit: false,
        triageExplicit: true,
        force: false,
        retryFailed: false,
        downloadPhotosAll: false,
        outputDir,
        scopeManifestToInput: true,
        print: false,
        artifactCache: null,
      },
      {
        runTriage: async (options) => {
          assert.equal(
            canonicalPath(options.aiReviewsFile!),
            canonicalPath(aiReviewsFile),
          );
          assert.equal(options.aiPhotosFile, undefined);
          return {
            data: { tier: 'consider', fitScore: 55 },
            model: 'fixture-model',
            provider: 'gemini',
            classifierVersion: TRIAGE_CLASSIFIER_VERSION,
            modelId: 'gemini:fixture-model:default',
            requirementSet:
              options.requirementSet ?? fixtureRequirementSet,
            evidenceGaps: [],
          };
        },
      },
    );

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.deepEqual(
      manifest.listings['booking/example-hotel'].triage.evidenceGaps,
      ['photos'],
    );
    const triageJson = JSON.parse(
      fs.readFileSync(
        path.join(outputDir, 'triage', 'example-hotel.json'),
        'utf-8',
      ),
    );
    assert.deepEqual(triageJson.evidenceGaps, ['photos']);
    assert.equal(fs.existsSync(fixture.listingFile), true);
  } finally {
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
