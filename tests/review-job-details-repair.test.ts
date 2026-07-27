import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type {
  BatchManifest,
  BatchOptions,
} from '../src/batch.js';
import {
  DETAILS_REPAIR_PLAN_FILE,
  fingerprintDetailsRepairValue,
  getDetailsRepairCoverage,
  readReviewJobDetailsRepairPlan,
  stageReviewJobDetailsRepair,
  validateReviewJobDetailsRepairForApply,
  type DetailsRepairJobInput,
} from '../web/src/lib/review-job-details-repair.js';

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function manifestEntry(
  platform: 'airbnb' | 'booking',
  id: string,
  url: string,
) {
  const detailsFile = `listings/listing_${id}.json`;
  return {
    platform,
    id,
    url,
    details: {
      status: 'fetched' as const,
      file: detailsFile,
      source: 'network' as const,
    },
    reviews: {
      status: 'fetched' as const,
      file:
        platform === 'airbnb'
          ? `reviews/room_${id}_reviews.json`
          : `reviews/${id}_reviews.json`,
      count: 10,
      source: 'network' as const,
    },
    photos: {
      status: 'fetched' as const,
      dir: `photos/${id}`,
      count: 1,
      source: 'network' as const,
    },
    aiReviews: {
      status: 'fetched' as const,
      file: `ai-reviews/${id}.json`,
      model: 'test-model',
      cost: 0.2,
    },
    aiPhotos: {
      status: 'fetched' as const,
      file: `ai-photos/${id}.json`,
      model: 'test-model',
      cost: 0.3,
    },
    triage: {
      status: 'fetched' as const,
      file: `triage/${id}.json`,
      model: 'test-model',
      cost: 0.1,
    },
    verdict: 'shortlisted' as const,
    verdictReason: 'keep this exact decision',
  };
}

function seedEntryArtifacts(
  rootDir: string,
  entry: ReturnType<typeof manifestEntry>,
  details: unknown,
): void {
  writeJson(path.join(rootDir, entry.details.file), details);
  writeJson(path.join(rootDir, entry.reviews.file), {
    reviews: [{ id: 'review-1' }],
  });
  fs.mkdirSync(path.join(rootDir, entry.photos.dir), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, entry.photos.dir, '01.jpg'),
    `photo:${entry.platform}:${entry.id}`,
  );
  writeJson(path.join(rootDir, entry.aiReviews.file), {
    analysis: `reviews:${entry.id}`,
  });
  writeJson(path.join(rootDir, entry.aiPhotos.file), {
    analysis: `photos:${entry.id}`,
  });
  writeJson(path.join(rootDir, entry.triage.file), {
    verdict: 'unchanged',
    listingId: entry.id,
  });
}

test('coverage treats a zero review count as populated but empty collections as missing', () => {
  assert.deepEqual(
    getDetailsRepairCoverage({
      title: 'A real title',
      rating: null,
      reviewCount: 0,
      subRatings: {},
      amenities: [],
    }),
    {
      title: true,
      rating: false,
      reviewCount: true,
      subRatings: false,
      amenities: false,
      total: 2,
    },
  );
});

test('details repair stages only missing core fields and preserves every non-details byte', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'reviewr-details-repair-'),
  );
  const sourceRoot = path.join(tempRoot, 'source');
  const stagedRoot = path.join(tempRoot, 'staged');
  fs.mkdirSync(sourceRoot, { recursive: true });

  const airbnbOneUrl = 'https://www.airbnb.com/rooms/111';
  const airbnbTwoUrl = 'https://www.airbnb.com/rooms/222';
  const bookingUrl =
    'https://www.booking.com/hotel/us/example.html';
  const airbnbOne = manifestEntry('airbnb', '111', airbnbOneUrl);
  const airbnbTwo = manifestEntry('airbnb', '222', airbnbTwoUrl);
  const booking = manifestEntry('booking', 'example', bookingUrl);
  const firstBefore = {
    title: '',
    rating: 4.7,
    reviewCount: null,
    subRatings: {},
    amenities: [],
    host: { name: 'Original Host' },
    description: 'Original description',
    staySnapshot: { capturedAt: 'original' },
  };
  const secondBefore = {
    title: '',
    rating: null,
    reviewCount: null,
    subRatings: {},
    amenities: [],
    host: { name: 'Second Host' },
  };
  const bookingBefore = {
    title: 'Booking stays untouched',
    rating: 8.9,
    reviewCount: 500,
    amenities: [{ name: 'Elevator' }],
  };
  const manifest: BatchManifest = {
    version: 2,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    dates: {
      checkIn: '2026-07-29',
      checkOut: '2026-08-11',
      adults: 2,
    },
    requirementSet: {
      id: 'requirements-v1',
      parserVersion: 'parser-v1',
      file: 'requirements.json',
    },
    listings: {
      'airbnb/111': airbnbOne,
      'airbnb/222': airbnbTwo,
      'booking/example': booking,
    },
  };
  writeJson(path.join(sourceRoot, 'batch_manifest.json'), manifest);
  writeJson(path.join(sourceRoot, 'requirements.json'), {
    keep: 'byte-identical',
  });
  seedEntryArtifacts(sourceRoot, airbnbOne, firstBefore);
  seedEntryArtifacts(sourceRoot, airbnbTwo, secondBefore);
  seedEntryArtifacts(sourceRoot, booking, bookingBefore);
  fs.writeFileSync(path.join(sourceRoot, 'report.html'), 'original report');

  const sourceFilesBefore = new Map(
    [
      'batch_manifest.json',
      'requirements.json',
      airbnbOne.details.file,
      airbnbOne.reviews.file,
      `${airbnbOne.photos.dir}/01.jpg`,
      airbnbOne.aiReviews.file,
      airbnbOne.aiPhotos.file,
      airbnbOne.triage.file,
      airbnbTwo.details.file,
      booking.details.file,
      booking.reviews.file,
      booking.aiReviews.file,
      booking.aiPhotos.file,
      booking.triage.file,
      'report.html',
    ].map((relativePath) => [
      relativePath,
      fs.readFileSync(path.join(sourceRoot, relativePath)),
    ]),
  );

  const job: DetailsRepairJobInput = {
    id: 'job-nyc',
    status: 'completed',
    currentPhase: 'results-ready',
    analysisStatus: 'completed',
    analysisCurrentPhase: 'completed',
    priceRefreshStatus: 'pending',
    priceRefreshCurrentPhase: null,
    artifactRoot: sourceRoot,
    reportPath: path.join(sourceRoot, 'report.html'),
    checkin: '2026-07-29',
    checkout: '2026-08-11',
    adults: 2,
    sourceStateFingerprint: 'db-state-before',
    listings: [
      {
        rowId: 'row-111',
        analysisId: 'analysis-111',
        listingId: '111',
        platform: 'airbnb',
        url: airbnbOneUrl,
        detailsStatus: 'completed',
        details: firstBefore,
      },
      {
        rowId: 'row-222',
        analysisId: 'analysis-222',
        listingId: '222',
        platform: 'airbnb',
        url: airbnbTwoUrl,
        detailsStatus: 'completed',
        details: secondBefore,
      },
      {
        rowId: 'row-booking',
        analysisId: 'analysis-booking',
        listingId: 'example',
        platform: 'booking',
        url: bookingUrl,
        detailsStatus: 'completed',
        details: bookingBefore,
      },
    ],
  };

  const capturedBatchOptions: BatchOptions[] = [];
  let capturedUrls: string[] = [];
  const plan = await stageReviewJobDetailsRepair({
    job,
    platform: 'airbnb',
    stagedRoot,
    now: new Date('2026-07-27T13:00:00.000Z'),
    runBatch: async (filePaths, options) => {
      capturedBatchOptions.push(options);
      capturedUrls = fs.readFileSync(filePaths[0], 'utf8')
        .trim()
        .split('\n');
      const stagedManifest = readJson<BatchManifest>(
        path.join(stagedRoot, 'batch_manifest.json'),
      );
      writeJson(path.join(stagedRoot, airbnbOne.details.file), {
        title: 'Recovered title',
        rating: 4.9,
        reviewCount: 0,
        subRatings: { cleanliness: 4.8 },
        amenities: [{ name: 'Elevator' }, { name: 'Air conditioning' }],
        host: { name: 'Replacement Host' },
        description: 'Replacement description',
        staySnapshot: { capturedAt: 'replacement' },
      });
      stagedManifest.listings['airbnb/111'].details = {
        status: 'fetched',
        file: airbnbOne.details.file,
        source: 'network',
      };
      stagedManifest.listings['airbnb/222'].details = {
        status: 'failed',
        error: 'provider timeout',
      };
      writeJson(
        path.join(stagedRoot, 'batch_manifest.json'),
        stagedManifest,
      );
      return {};
    },
    generateReport: async ({ outputFile }) => {
      fs.writeFileSync(outputFile as string, 'regenerated report');
      return outputFile as string;
    },
  });

  try {
    assert.deepEqual(capturedUrls, [airbnbOneUrl, airbnbTwoUrl]);
    const capturedOptions = capturedBatchOptions[0];
    assert.ok(capturedOptions);
    assert.deepEqual(
      {
        details: capturedOptions.fetchDetails,
        reviews: capturedOptions.fetchReviews,
        photos: capturedOptions.fetchPhotos,
        aiReviews: capturedOptions.aiReviews,
        aiPhotos: capturedOptions.aiPhotos,
        triage: capturedOptions.triage,
        force: capturedOptions.force,
        retry: capturedOptions.retryFailed,
        scopeManifest: capturedOptions.scopeManifestToInput,
        scopePostScrape: capturedOptions.scopePostScrapePhasesToInput,
      },
      {
        details: true,
        reviews: false,
        photos: false,
        aiReviews: false,
        aiPhotos: false,
        triage: false,
        force: false,
        retry: false,
        scopeManifest: false,
        scopePostScrape: true,
      },
    );

    assert.equal(plan.listings.length, 2);
    assert.equal(plan.listings[0].outcome, 'repaired');
    assert.deepEqual(plan.listings[0].addedFields, [
      'title',
      'reviewCount',
      'subRatings',
      'amenities',
    ]);
    assert.equal(plan.listings[1].outcome, 'preserved');
    assert.match(plan.listings[1].message ?? '', /provider timeout/);
    assert.equal(plan.totalAddedFields, 4);

    const repairedDetails = readJson<Record<string, unknown>>(
      path.join(stagedRoot, airbnbOne.details.file),
    );
    assert.deepEqual(repairedDetails, {
      ...firstBefore,
      title: 'Recovered title',
      reviewCount: 0,
      subRatings: { cleanliness: 4.8 },
      amenities: [{ name: 'Elevator' }, { name: 'Air conditioning' }],
    });
    assert.deepEqual(
      readJson(path.join(stagedRoot, airbnbTwo.details.file)),
      secondBefore,
    );
    assert.deepEqual(
      readJson(path.join(stagedRoot, booking.details.file)),
      bookingBefore,
    );
    assert.ok(fs.existsSync(path.join(stagedRoot, DETAILS_REPAIR_PLAN_FILE)));

    for (const [relativePath, expected] of sourceFilesBefore) {
      assert.deepEqual(
        fs.readFileSync(path.join(sourceRoot, relativePath)),
        expected,
        `source changed: ${relativePath}`,
      );
    }
    for (const relativePath of [
      'requirements.json',
      airbnbOne.reviews.file,
      `${airbnbOne.photos.dir}/01.jpg`,
      airbnbOne.aiReviews.file,
      airbnbOne.aiPhotos.file,
      airbnbOne.triage.file,
      booking.details.file,
      booking.reviews.file,
      booking.aiReviews.file,
      booking.aiPhotos.file,
      booking.triage.file,
    ]) {
      assert.deepEqual(
        fs.readFileSync(path.join(stagedRoot, relativePath)),
        sourceFilesBefore.get(relativePath),
        `preserved staged artifact changed: ${relativePath}`,
      );
    }

    const loadedPlan = readReviewJobDetailsRepairPlan(stagedRoot);
    const updates = validateReviewJobDetailsRepairForApply({
      plan: loadedPlan,
      job,
    });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].analysisId, 'analysis-111');
    assert.equal(updates[0].detailsStatus, 'completed');
    assert.equal(
      fingerprintDetailsRepairValue(updates[0].details),
      plan.listings[0].afterDetailsFingerprint,
    );

    assert.throws(
      () => validateReviewJobDetailsRepairForApply({
        plan: loadedPlan,
        job: {
          ...job,
          sourceStateFingerprint: 'concurrent-change',
        },
      }),
      /state changed after the dry run/,
    );

    const sourceDetailsPath = path.join(
      sourceRoot,
      airbnbOne.details.file,
    );
    const sourceDetailsBefore = fs.readFileSync(sourceDetailsPath);
    fs.writeFileSync(sourceDetailsPath, '{"tampered":true}');
    assert.throws(
      () => validateReviewJobDetailsRepairForApply({
        plan: loadedPlan,
        job,
      }),
      /Source details artifact changed/,
    );
    fs.writeFileSync(sourceDetailsPath, sourceDetailsBefore);

    const repairedDetailsPath = path.join(
      stagedRoot,
      airbnbOne.details.file,
    );
    const repairedDetailsBefore = fs.readFileSync(repairedDetailsPath);
    const tamperedDetails = {
      ...readJson<Record<string, unknown>>(repairedDetailsPath),
      host: { name: 'Tampered Host' },
    };
    writeJson(repairedDetailsPath, tamperedDetails);
    const tamperedPlan = structuredClone(loadedPlan);
    tamperedPlan.listings[0].afterDetailsFingerprint =
      fingerprintDetailsRepairValue(tamperedDetails);
    assert.throws(
      () => validateReviewJobDetailsRepairForApply({
        plan: tamperedPlan,
        job,
      }),
      /outside the missing-core repair/,
    );
    fs.writeFileSync(repairedDetailsPath, repairedDetailsBefore);

    const triagePath = path.join(stagedRoot, airbnbOne.triage.file);
    const triageBefore = fs.readFileSync(triagePath);
    fs.writeFileSync(triagePath, 'tampered');
    assert.throws(
      () => validateReviewJobDetailsRepairForApply({
        plan: loadedPlan,
        job,
      }),
      /preserved artifacts changed/,
    );
    fs.writeFileSync(triagePath, triageBefore);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('details repair refuses a no-op plan and leaves the source root unchanged', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'reviewr-details-noop-'),
  );
  const sourceRoot = path.join(tempRoot, 'source');
  const stagedRoot = path.join(tempRoot, 'staged');
  const url = 'https://www.airbnb.com/rooms/333';
  const entry = manifestEntry('airbnb', '333', url);
  const before = {
    title: '',
    rating: null,
    reviewCount: null,
    subRatings: {},
    amenities: [],
    host: { name: 'Kept' },
  };
  fs.mkdirSync(sourceRoot, { recursive: true });
  writeJson(path.join(sourceRoot, 'batch_manifest.json'), {
    version: 2,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    dates: {},
    listings: { 'airbnb/333': entry },
  });
  seedEntryArtifacts(sourceRoot, entry, before);
  fs.writeFileSync(path.join(sourceRoot, 'report.html'), 'original');
  const sourceDetailsBefore = fs.readFileSync(
    path.join(sourceRoot, entry.details.file),
  );

  try {
    await assert.rejects(
      stageReviewJobDetailsRepair({
        job: {
          id: 'job-noop',
          status: 'completed',
          currentPhase: 'results-ready',
          analysisStatus: 'completed',
          analysisCurrentPhase: 'completed',
          priceRefreshStatus: 'pending',
          priceRefreshCurrentPhase: null,
          artifactRoot: sourceRoot,
          reportPath: path.join(sourceRoot, 'report.html'),
          checkin: null,
          checkout: null,
          adults: 2,
          sourceStateFingerprint: 'state',
          listings: [{
            rowId: 'row-333',
            analysisId: 'analysis-333',
            listingId: '333',
            platform: 'airbnb',
            url,
            detailsStatus: 'completed',
            details: before,
          }],
        },
        platform: 'airbnb',
        stagedRoot,
        runBatch: async (_files, _options) => {
          const stagedManifest = readJson<BatchManifest>(
            path.join(stagedRoot, 'batch_manifest.json'),
          );
          stagedManifest.listings['airbnb/333'].details = {
            status: 'failed',
            error: 'provider unavailable',
          };
          writeJson(
            path.join(stagedRoot, 'batch_manifest.json'),
            stagedManifest,
          );
          return {};
        },
        generateReport: async () => {
          throw new Error('report should not run for a no-op plan');
        },
      }),
      /recovered no missing core fields/,
    );
    assert.deepEqual(
      fs.readFileSync(path.join(sourceRoot, entry.details.file)),
      sourceDetailsBefore,
    );
    assert.equal(
      fs.existsSync(path.join(stagedRoot, DETAILS_REPAIR_PLAN_FILE)),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
