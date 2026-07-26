import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  buildPrioritiesMatrix,
  parsePrioritiesMatrixFrequency,
  sortPrioritiesMatrixRows,
  type PrioritiesMatrixInputRow,
} from '../src/priorities-matrix.js';
import {
  buildPrioritiesMatrixFromArtifacts,
  generatePrioritiesMatrixJson,
} from '../src/priorities-matrix-report.js';
import {
  TRIAGE_CLASSIFIER_VERSION,
  TRIAGE_RUBRIC_VERSION,
} from '../src/triage-comparability.js';

const repositoryRoot = process.cwd();
const requirementSet = {
  id: 'reqset_sleep_fixture',
  schemaVersion: 1,
  parserVersion: 'fixture-parser-v1',
  brief: 'Quiet sleep and a usable workspace',
  definitions: [
    {
      id: 'req-01-quiet-sleep',
      label: 'Quiet sleep',
      type: 'priority',
      rank: 1,
      weight: 3,
      sourceText: 'Quiet sleep',
      criteria: ['No persistent HVAC noise'],
      order: 1,
    },
    {
      id: 'req-02-workspace',
      label: 'Workspace',
      type: 'must_have',
      rank: null,
      weight: 3,
      sourceText: 'A usable desk',
      criteria: ['Desk and chair'],
      order: 2,
    },
  ],
  parsedBudget: null,
};

function triage(options: {
  rankingStatus?: 'ranked' | 'insufficient_evidence';
  coverage?: number;
  classifierVersion?: string;
  set?: typeof requirementSet;
  requirements?: Array<Record<string, unknown>>;
  affordability?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  const set = options.set ?? requirementSet;
  return {
    scoreSource: 'deterministic_rubric',
    rubricVersion: TRIAGE_RUBRIC_VERSION,
    classifierVersion:
      options.classifierVersion ?? TRIAGE_CLASSIFIER_VERSION,
    requirementSetId: set.id,
    requirementSet: set,
    rawFitScore: 70,
    fitScore: 70,
    tier: 'consider',
    capReasons: [],
    coverage: options.coverage ?? 1,
    rankingStatus: options.rankingStatus ?? 'ranked',
    rankingReason: null,
    affordability: options.affordability ?? {
      status: 'within',
      reasonCode: 'within_budget',
      reason: 'The public stay total is within budget.',
      budgetAmount: 3000,
      priceAmount: 2400,
      currency: 'USD',
      overByAmount: null,
      overByPercent: null,
    },
    evidenceGaps: [],
    requirements:
      options.requirements
      ?? set.definitions.map((definition) => ({
        requirementId: definition.id,
        requirement: definition.label,
        label: definition.label,
        type: definition.type,
        rank: definition.rank,
        weight: definition.weight,
        order: definition.order,
        status: 'met',
        confidence: 'high',
        note: 'Fixture verdict.',
        evidence: [],
      })),
  };
}

function row(
  id: string,
  triageValue: unknown,
  overrides: Partial<PrioritiesMatrixInputRow> = {},
): PrioritiesMatrixInputRow {
  return {
    id,
    platform: 'booking',
    name: id,
    url: `https://www.booking.com/hotel/us/${id}.html`,
    triage: triageValue,
    availability: {
      status: 'yes',
      freshness: 'fresh',
      eligibility: 'eligible',
      reasonCode: 'available',
      reason: 'Available for the recorded stay.',
      capturedAt: '2026-07-26T18:00:00.000Z',
      availableRange: {
        checkIn: '2026-07-29',
        checkOut: '2026-08-11',
      },
    },
    affordability: {
      status: 'within',
      reasonCode: 'within_budget',
      reason: 'Within budget.',
      budgetAmount: 3000,
      priceAmount: 2400,
      currency: 'USD',
      overByAmount: null,
      overByPercent: null,
    },
    ...overrides,
  };
}

test('matrix aligns canonical IDs and preserves status-aligned evidence provenance', () => {
  const riskyTriage = triage({
    requirements: [
      {
        ...requirementSet.definitions[0],
        requirementId: 'req-01-quiet-sleep',
        requirement: 'Quiet sleep',
        status: 'unmet',
        confidence: 'high',
        note: 'HVAC noise is a material sleep risk.',
        evidence: [
          {
            layer: 'details',
            polarity: 'supports',
            text: 'The listing advertises soundproofing.',
          },
          {
            layer: 'reviews',
            polarity: 'contradicts',
            text: 'Guests repeatedly report loud HVAC cycling overnight.',
            frequency: '42 of 250 reviews',
            years: [2024, 2026, 2026],
          },
        ],
      },
      {
        ...requirementSet.definitions[1],
        requirementId: 'req-02-workspace',
        requirement: 'Workspace',
        status: 'met',
        confidence: 'medium',
        note: 'A desk is consistently visible.',
        evidence: [
          {
            layer: 'reviews',
            polarity: 'contradicts',
            text: 'One guest found the chair uncomfortable.',
            frequency: '1/250',
            years: [2025],
          },
          {
            layer: 'photos',
            polarity: 'supports',
            text: 'Current photos show a desk and task chair.',
            years: [2026],
          },
        ],
      },
    ],
  });
  riskyTriage.evidenceGaps = ['photos'];

  const matchingLabelWrongId = triage({
    requirements: [
      {
        ...requirementSet.definitions[0],
        requirementId: 'req-not-the-canonical-id',
        requirement: 'Quiet sleep',
        label: 'Quiet sleep',
        status: 'met',
        confidence: 'high',
        note: 'Must not be label-aligned.',
        evidence: [],
      },
      {
        ...requirementSet.definitions[1],
        requirementId: 'req-02-workspace',
        requirement: 'Workspace',
        status: 'met',
        confidence: 'high',
        note: 'Workspace present.',
        evidence: [],
      },
    ],
  });

  const fitTriage = triage({
    requirements: [
      {
        ...requirementSet.definitions[0],
        requirementId: 'req-01-quiet-sleep',
        requirement: 'Quiet sleep',
        status: 'met',
        confidence: 'high',
        note: 'Quiet in the analyzed sample.',
        evidence: [
          {
            layer: 'reviews',
            polarity: 'supports',
            text: 'Recent guests describe quiet nights.',
            frequency: '18 out of 250 analyzed reviews',
            years: [2026],
          },
        ],
      },
      {
        ...requirementSet.definitions[1],
        requirementId: 'req-02-workspace',
        requirement: 'Workspace',
        status: 'met',
        confidence: 'high',
        note: 'Workspace present.',
        evidence: [],
      },
    ],
  });

  const insufficientTriage = triage({
    rankingStatus: 'insufficient_evidence',
    coverage: 0.25,
    requirements: requirementSet.definitions.map((definition) => ({
      ...definition,
      requirementId: definition.id,
      requirement: definition.label,
      status: 'unknown',
      confidence: 'low',
      note: 'Not enough review data.',
      evidence: [],
    })),
  });
  insufficientTriage.evidenceGaps = ['reviews'];

  const oldSet = {
    ...requirementSet,
    id: 'reqset_old_fixture',
    definitions: [
      {
        ...requirementSet.definitions[0],
        id: 'old-quiet-id',
      },
    ],
  };
  const matrix = buildPrioritiesMatrix(
    [
      row('risky', riskyTriage, {
        reviewSample: {
          totalScrapedReviewCount: 2632,
          eligibleReviewCount: 1924,
          analyzedReviewCount: 250,
          capped: true,
          source: 'batch_manifest',
        },
      }),
      row('label-collision', matchingLabelWrongId),
      row('fit', fitTriage),
      row('insufficient', insufficientTriage),
      row('old-policy', triage({
        classifierVersion: 'triage-classifier-v1',
      })),
      row('old-set', triage({ set: oldSet })),
      row('legacy', {
        fitScore: 99,
        requirements: [
          {
            requirement: 'Quiet sleep',
            status: 'met',
          },
        ],
      }),
      row('unscored', null),
    ],
    { generatedAt: '2026-07-26T20:00:00.000Z' },
  );

  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.generatedAt, '2026-07-26T20:00:00.000Z');
  assert.equal(matrix.activeRequirementSetId, requirementSet.id);
  assert.deepEqual(matrix.fixedAxes, ['availability', 'affordability']);
  assert.deepEqual(
    matrix.columns.map((column) => column.requirementId),
    ['req-01-quiet-sleep', 'req-02-workspace'],
  );

  const risky = matrix.rows[0];
  const quiet = risky.priorities['req-01-quiet-sleep'];
  const workspace = risky.priorities['req-02-workspace'];
  assert.equal(quiet.status, 'unmet');
  assert.equal(
    quiet.strongestEvidence?.text,
    'Guests repeatedly report loud HVAC cycling overnight.',
  );
  assert.deepEqual(quiet.strongestEvidence?.frequency, {
    raw: '42 of 250 reviews',
    mentions: 42,
    analyzedReviewCount: 250,
    denominatorMeaning: 'ai_analyzed_reviews',
    display: '42 of 250 AI-analyzed reviews',
  });
  assert.deepEqual(quiet.strongestEvidence?.years, [2026, 2024]);
  assert.equal(quiet.evidence.length, 2);
  assert.deepEqual(quiet.evidenceGaps, ['photos']);
  assert.equal(
    workspace.strongestEvidence?.text,
    'Current photos show a desk and task chair.',
  );
  assert.deepEqual(risky.reviewSample, {
    totalScrapedReviewCount: 2632,
    eligibleReviewCount: 1924,
    analyzedReviewCount: 250,
    capped: true,
    source: 'batch_manifest',
  });

  assert.equal(
    matrix.rows[1].priorities['req-01-quiet-sleep'].state,
    'missing',
  );
  assert.equal(matrix.rows[3].rankingStatus, 'insufficient_evidence');
  assert.deepEqual(
    matrix.rows[3].priorities['req-01-quiet-sleep'].evidenceGaps,
    ['reviews'],
  );
  assert.equal(matrix.rows[4].rankingStatus, 'stale_classifier_policy');
  assert.equal(
    matrix.rows[4].priorities['req-01-quiet-sleep'].state,
    'unavailable',
  );
  assert.equal(matrix.rows[5].rankingStatus, 'stale_requirement_set');
  assert.equal(matrix.rows[6].rankingStatus, 'legacy');
  assert.equal(matrix.rows[7].rankingStatus, 'unscored');

  assert.deepEqual(
    sortPrioritiesMatrixRows(
      matrix.rows,
      'req-01-quiet-sleep',
      'risk',
    ).map((item) => item.id),
    [
      'risky',
      'label-collision',
      'fit',
      'insufficient',
      'old-policy',
      'old-set',
      'legacy',
      'unscored',
    ],
  );
  assert.deepEqual(
    sortPrioritiesMatrixRows(
      matrix.rows,
      'req-01-quiet-sleep',
      'fit',
    ).slice(0, 3).map((item) => item.id),
    ['fit', 'label-collision', 'risky'],
  );
});

test('frequency parsing labels only valid ratios as AI-analyzed denominators', () => {
  assert.deepEqual(parsePrioritiesMatrixFrequency('3/10'), {
    raw: '3/10',
    mentions: 3,
    analyzedReviewCount: 10,
    denominatorMeaning: 'ai_analyzed_reviews',
    display: '3 of 10 AI-analyzed reviews',
  });
  assert.deepEqual(parsePrioritiesMatrixFrequency('roughly a dozen mentions'), {
    raw: 'roughly a dozen mentions',
    mentions: null,
    analyzedReviewCount: null,
    denominatorMeaning: null,
    display: 'roughly a dozen mentions',
  });
  assert.equal(
    parsePrioritiesMatrixFrequency('12 of 10 reviews').denominatorMeaning,
    null,
  );
});

function writeReportFixture(outputDir: string): void {
  fs.mkdirSync(path.join(outputDir, 'listings'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'triage'), { recursive: true });
  const capturedAt = '2026-07-26T18:00:00.000Z';
  fs.writeFileSync(
    path.join(outputDir, 'listings', 'listing_example.json'),
    JSON.stringify({
      title: 'Example Sleep Hotel',
      rating: 4.6,
      reviewCount: 2632,
      staySnapshot: {
        schemaVersion: 1,
        request: {
          platform: 'booking',
          listingId: 'example',
          checkIn: '2026-07-29',
          checkOut: '2026-08-11',
          adults: 2,
          linkedRoomId: null,
        },
        priceForStay: {
          amount: 2400,
          currency: 'USD',
          basis: 'stay',
          capturedAt,
          source: 'booking_property_page',
          rateType: 'public',
          mandatoryChargesResolved: true,
        },
        availability: {
          status: 'yes',
          capturedAt,
          reasonCode: 'provider_room_inventory',
        },
        providerEvidence: {},
      },
    }),
  );
  fs.writeFileSync(
    path.join(outputDir, 'triage', 'example.json'),
    JSON.stringify(triage({
      requirements: [
        {
          ...requirementSet.definitions[0],
          requirementId: 'req-01-quiet-sleep',
          requirement: 'Quiet sleep',
          status: 'unmet',
          confidence: 'high',
          note: 'HVAC noise is a sleep risk.',
          evidence: [
            {
              layer: 'reviews',
              polarity: 'contradicts',
              text: 'Guests report HVAC noise.',
              frequency: '42 of 250 reviews',
              years: [2026],
            },
          ],
        },
        {
          ...requirementSet.definitions[1],
          requirementId: 'req-02-workspace',
          requirement: 'Workspace',
          status: 'met',
          confidence: 'high',
          note: 'Desk present.',
          evidence: [],
        },
      ],
    })),
  );
  fs.writeFileSync(
    path.join(outputDir, 'batch_manifest.json'),
    JSON.stringify({
      version: 2,
      createdAt: capturedAt,
      updatedAt: capturedAt,
      dates: {
        checkIn: '2026-07-29',
        checkOut: '2026-08-11',
        adults: 2,
      },
      listings: {
        'booking/example': {
          platform: 'booking',
          id: 'example',
          url: 'https://www.booking.com/hotel/us/example.html',
          details: {
            status: 'fetched',
            file: 'listings/listing_example.json',
          },
          reviews: {
            status: 'fetched',
            file: 'reviews/example_reviews.json',
            count: 2632,
          },
          photos: { status: 'not_requested' },
          aiReviews: {
            status: 'fetched',
            file: 'ai-reviews/example.json',
            count: 250,
            expected: 1924,
          },
          aiPhotos: { status: 'not_requested' },
          triage: {
            status: 'fetched',
            file: 'triage/example.json',
          },
        },
      },
    }),
  );
}

test('artifact report and CLI expose analyzed, eligible, and scraped counts separately', () => {
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'reviewr-priorities-matrix-'),
  );
  const generatedAt = '2026-07-26T20:00:00.000Z';
  try {
    writeReportFixture(outputDir);
    const matrix = buildPrioritiesMatrixFromArtifacts({
      outputDir,
      generatedAt,
      now: Date.parse('2026-07-26T20:00:00.000Z'),
    });
    assert.equal(matrix.rows[0].availability.status, 'yes');
    assert.equal(matrix.rows[0].availability.freshness, 'fresh');
    assert.equal(matrix.rows[0].affordability.status, 'within');
    assert.deepEqual(matrix.rows[0].reviewSample, {
      totalScrapedReviewCount: 2632,
      eligibleReviewCount: 1924,
      analyzedReviewCount: 250,
      capped: true,
      source: 'batch_manifest',
    });
    assert.equal(
      matrix.rows[0]
        .priorities['req-01-quiet-sleep']
        .strongestEvidence?.frequency.display,
      '42 of 250 AI-analyzed reviews',
    );

    const customFile = path.join(outputDir, 'matrix-custom.json');
    assert.equal(
      generatePrioritiesMatrixJson({
        outputDir,
        outputFile: customFile,
        generatedAt,
      }),
      customFile,
    );
    const serialized = JSON.parse(fs.readFileSync(customFile, 'utf8'));
    assert.equal(serialized.schemaVersion, 1);
    assert.equal(
      serialized.rows[0].reviewSample.totalScrapedReviewCount,
      2632,
    );

    const cliPath = path.join(repositoryRoot, 'src', 'cli.ts');
    const tsxPath = path.join(
      repositoryRoot,
      'node_modules',
      '.bin',
      'tsx',
    );
    const cliResult = spawnSync(
      tsxPath,
      [
        cliPath,
        'report',
        '--output-dir',
        outputDir,
        '--priorities-matrix',
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
      },
    );
    assert.equal(
      cliResult.status,
      0,
      `${cliResult.stdout}\n${cliResult.stderr}`,
    );
    assert.match(cliResult.stdout, /Priorities matrix:/);
    assert.equal(
      fs.existsSync(path.join(outputDir, 'priorities-matrix.json')),
      true,
    );

    const customReportDir = path.join(outputDir, 'exports');
    fs.mkdirSync(customReportDir);
    const customReportFile = path.join(customReportDir, 'report.html');
    const customCliResult = spawnSync(
      tsxPath,
      [
        cliPath,
        'report',
        '--output-dir',
        outputDir,
        '--output-file',
        customReportFile,
        '--priorities-matrix',
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
      },
    );
    assert.equal(
      customCliResult.status,
      0,
      `${customCliResult.stdout}\n${customCliResult.stderr}`,
    );
    assert.equal(
      fs.existsSync(
        path.join(customReportDir, 'priorities-matrix.json'),
      ),
      true,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
