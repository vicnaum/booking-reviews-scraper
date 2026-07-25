import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { generateReport } from '../src/report.js';
import { TRIAGE_CLASSIFIER_VERSION } from '../src/triage-comparability.js';

test('generateReport surfaces POI distance in the report output', async () => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'report-poi-test-'),
  );

  const manifest = {
    version: 2,
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    dates: {
      checkIn: '2026-03-20',
      checkOut: '2026-03-29',
      adults: 2,
    },
    listings: {
      one: {
        platform: 'airbnb',
        id: 'one',
        url: 'https://www.airbnb.com/rooms/12345',
        details: { status: 'fetched', file: 'listings/listing_12345.json' },
        reviews: { status: 'fetched', file: 'reviews/reviews_12345.json', count: 12 },
        photos: { status: 'fetched', dir: 'photos/12345', count: 0 },
        aiReviews: { status: 'fetched', file: 'ai-reviews/12345.json' },
        aiPhotos: { status: 'fetched', file: 'ai-photos/12345.json' },
        triage: { status: 'fetched', file: 'triage/12345.json' },
      },
    },
  };

  fs.mkdirSync(path.join(rootDir, 'listings'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'triage'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'ai-reviews'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'ai-photos'), { recursive: true });

  fs.writeFileSync(
    path.join(rootDir, 'batch_manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  fs.writeFileSync(
    path.join(rootDir, 'listings', 'listing_12345.json'),
    JSON.stringify({
      title: 'POI distance listing',
      coordinates: { lat: 51.5158, lng: -0.1512 },
      poi: { lat: 51.5155, lng: -0.1427 },
      poiDistanceMeters: 386,
      bedrooms: 2,
      beds: 2,
      bathrooms: 1,
      capacity: 4,
      amenities: [],
      rating: 4.8,
      reviewCount: 12,
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(rootDir, 'triage', '12345.json'),
    JSON.stringify({
      fitScore: 8.5,
      tier: 'shortlist',
      tierReason: 'Good match',
      requirements: [],
      scores: {
        fit: 9,
        location: 8,
        sleepQuality: 8,
        cleanliness: 8,
        modernity: 8,
        valueForMoney: 7,
      },
      bedSetup: 'Two bedrooms',
      price: { total: '$1554', perNight: '$173', valueAssessment: 'fair' },
      highlights: [],
      concerns: [],
      dealBreakers: [],
      summary: 'Close to the user POI.',
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(rootDir, 'ai-reviews', '12345.json'),
    JSON.stringify({
      strengths: [],
      weaknesses: [],
      redFlags: [],
      dealBreakers: [],
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(rootDir, 'ai-photos', '12345.json'),
    JSON.stringify({ rooms: [] }, null, 2),
  );

  const outputFile = await generateReport({ outputDir: rootDir });
  const html = fs.readFileSync(outputFile, 'utf-8');

  assert.match(html, /386 m from POI/);
  assert.match(
    html,
    /POI distance: <b>' \+ esc\(formatPoiDistance\(r\.poiDistanceMeters\) \|\| ''\) \+ '<\/b>/,
  );
  assert.match(html, /const REPORT_POI = \{\"lat\":51\.5155,\"lng\":-0\.1427\};/);

  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('generateReport ranks only the active deterministic set', async () => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'report-rubric-test-'),
  );
  const fixtures = [
    {
      id: 'ranked',
      title: 'Comparable ranked',
      triage: {
        scoreSource: 'deterministic_rubric',
        rubricVersion: '1',
        requirementSetId: 'reqset_active',
        classifierVersion: TRIAGE_CLASSIFIER_VERSION,
        rawFitScore: 60,
        fitScore: 60,
        tier: 'consider',
        coverage: 1,
        rankingStatus: 'ranked',
      },
    },
    {
      id: 'thin',
      title: 'Thin evidence',
      triage: {
        scoreSource: 'deterministic_rubric',
        rubricVersion: '1',
        requirementSetId: 'reqset_active',
        classifierVersion: TRIAGE_CLASSIFIER_VERSION,
        rawFitScore: 90,
        fitScore: 90,
        tier: 'top_pick',
        coverage: 0.25,
        rankingStatus: 'insufficient_evidence',
      },
    },
    {
      id: 'legacy',
      title: 'Legacy high score',
      triage: {
        fitScore: 99,
        tier: 'top_pick',
      },
    },
  ];

  try {
    fs.mkdirSync(path.join(rootDir, 'listings'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'triage'), { recursive: true });
    const listings: Record<string, unknown> = {};
    for (const fixture of fixtures) {
      listings[fixture.id] = {
        platform: 'booking',
        id: fixture.id,
        url: `https://www.booking.com/hotel/us/${fixture.id}.html`,
        details: {
          status: 'fetched',
          file: `listings/listing_${fixture.id}.json`,
        },
        reviews: { status: 'skipped' },
        photos: { status: 'skipped' },
        aiReviews: { status: 'skipped' },
        aiPhotos: { status: 'skipped' },
        triage: {
          status: 'fetched',
          file: `triage/${fixture.id}.json`,
        },
      };
      fs.writeFileSync(
        path.join(rootDir, 'listings', `listing_${fixture.id}.json`),
        JSON.stringify({
          title: fixture.title,
          amenities: [],
        }),
      );
      fs.writeFileSync(
        path.join(rootDir, 'triage', `${fixture.id}.json`),
        JSON.stringify({
          ...fixture.triage,
          tierReason: 'Fixture verdict',
          requirements: [],
          scores: {},
          bedSetup: '',
          price: {
            total: '',
            perNight: '',
            valueAssessment: 'unknown',
          },
          highlights: [],
          concerns: [],
          dealBreakers: [],
          summary: fixture.title,
          affordability: {
            status: 'unknown',
            reasonCode: 'price_missing',
            reason: 'Price is missing for the selected stay.',
          },
        }),
      );
    }
    fs.writeFileSync(
      path.join(rootDir, 'batch_manifest.json'),
      JSON.stringify({
        version: 2,
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
        dates: {},
        listings,
      }),
    );

    const outputFile = await generateReport({ outputDir: rootDir });
    const html = fs.readFileSync(outputFile, 'utf-8');
    const dataStart = html.indexOf('const DATA = ') + 'const DATA = '.length;
    const dataEnd = html.indexOf(';\nconst INITIAL_PICKS', dataStart);
    const reportRows = JSON.parse(html.slice(dataStart, dataEnd));
    assert.deepEqual(
      reportRows.map((row: { id: string }) => row.id),
      ['ranked', 'thin', 'legacy'],
    );

    const heroStart = html.indexOf('<!-- TOP PICKS -->');
    const heroEnd = html.indexOf('<!-- TIER FILTERS -->', heroStart);
    const heroHtml = html.slice(heroStart, heroEnd);
    assert.match(heroHtml, /Comparable ranked/);
    assert.doesNotMatch(heroHtml, /Thin evidence/);
    assert.doesNotMatch(heroHtml, /Legacy high score/);
    assert.match(
      html,
      /1 insufficient-evidence, 0 older-policy, and 1 legacy\/stale-set verdicts/,
    );
    assert.match(
      html,
      /Budget unknown · Price is missing for the selected stay\./,
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
