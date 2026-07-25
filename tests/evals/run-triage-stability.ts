import 'dotenv/config';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { TRIAGE_CLASSIFIER_VERSION } from '../../src/triage-comparability.js';
import type {
  CanonicalRequirementSet,
  RequirementConfidence,
  RequirementStatus,
} from '../../src/triage-rubric.js';
import { runTriage } from '../../src/triage.js';

const argv = process.argv.slice(2);

function argument(name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

interface Outcome {
  requirementId: string;
  status: RequirementStatus;
  confidence: RequirementConfidence;
}

interface StabilityRecord {
  temperature: number;
  run: number;
  slug: string;
  fitScore: number;
  rawFitScore: number;
  tier: string;
  capReasons: string[];
  coverage: number;
  rankingStatus: string;
  outcomes: Outcome[];
  classificationSignature: string;
  usage: unknown;
  durationMs: number;
}

function pairs<T>(values: T[], differs: (left: T, right: T) => boolean): number {
  let count = 0;
  for (let left = 0; left < values.length; left++) {
    for (let right = left + 1; right < values.length; right++) {
      if (differs(values[left], values[right])) count++;
    }
  }
  return count;
}

function summarize(
  records: StabilityRecord[],
  requirementSet: CanonicalRequirementSet,
) {
  const temperatures = [0, 1];
  const listings = [...new Set(records.map((record) => record.slug))];
  const scoreStats = Object.fromEntries(
    temperatures.map((temperature) => [
      String(temperature),
      Object.fromEntries(
        listings.map((slug) => {
          const rows = records.filter(
            (record) =>
              record.temperature === temperature && record.slug === slug,
          );
          const scores = rows.map((row) => row.fitScore);
          const mean =
            scores.reduce((sum, score) => sum + score, 0) / scores.length;
          const tiers = [...new Set(rows.map((row) => row.tier))];
          return [
            slug,
            {
              scores,
              mean,
              minimum: Math.min(...scores),
              maximum: Math.max(...scores),
              maxAbsoluteDeviation: Math.max(
                ...scores.map((score) => Math.abs(score - mean)),
              ),
              tiers,
              accepted:
                rows.length === 5
                && tiers.length === 1
                && Math.max(
                  ...scores.map((score) => Math.abs(score - mean)),
                ) <= 5,
            },
          ];
        }),
      ),
    ]),
  );

  const flipStats = Object.fromEntries(
    temperatures.map((temperature) => {
      let weightedPairs = 0;
      let weightedStatusFlips = 0;
      let weightedConfidenceFlips = 0;
      let boundaryFlips = 0;
      for (const slug of listings) {
        const rows = records.filter(
          (record) =>
            record.temperature === temperature && record.slug === slug,
        );
        for (const requirement of requirementSet.definitions) {
          const outcomes = rows
            .map((row) =>
              row.outcomes.find(
                (outcome) => outcome.requirementId === requirement.id,
              ))
            .filter((outcome): outcome is Outcome => outcome != null);
          const pairCount = (outcomes.length * (outcomes.length - 1)) / 2;
          weightedPairs += pairCount * requirement.weight;
          weightedStatusFlips += pairs(
            outcomes,
            (left, right) => left.status !== right.status,
          ) * requirement.weight;
          weightedConfidenceFlips += pairs(
            outcomes,
            (left, right) => left.confidence !== right.confidence,
          ) * requirement.weight;
          boundaryFlips += pairs(
            outcomes,
            (left, right) =>
              left.confidence === 'high'
              && right.confidence === 'high'
              && (
                (left.status === 'partial' && right.status === 'unmet')
                || (left.status === 'unmet' && right.status === 'partial')
              ),
          );
        }
      }
      return [
        String(temperature),
        {
          weightedPairs,
          weightedStatusFlips,
          weightedStatusFlipRate:
            weightedPairs > 0 ? weightedStatusFlips / weightedPairs : null,
          weightedConfidenceFlips,
          weightedConfidenceFlipRate:
            weightedPairs > 0 ? weightedConfidenceFlips / weightedPairs : null,
          partialUnmetHighFlips: boundaryFlips,
        },
      ];
    }),
  );

  const verdictsByClassification = new Map<string, Set<string>>();
  for (const record of records) {
    const key = [
      record.temperature,
      record.slug,
      record.classificationSignature,
    ].join(':');
    const verdict = JSON.stringify({
      rawFitScore: record.rawFitScore,
      fitScore: record.fitScore,
      tier: record.tier,
      capReasons: record.capReasons,
      coverage: record.coverage,
      rankingStatus: record.rankingStatus,
    });
    const verdicts = verdictsByClassification.get(key) ?? new Set<string>();
    verdicts.add(verdict);
    verdictsByClassification.set(key, verdicts);
  }
  const deterministicInvariantViolations = [
    ...verdictsByClassification.entries(),
  ]
    .filter(([, verdicts]) => verdicts.size > 1)
    .map(([key, verdicts]) => ({ key, verdicts: [...verdicts] }));

  return {
    completedCalls: records.length,
    scoreStats,
    flipStats,
    deterministicInvariantViolations,
    acceptedAtTemperatureZero:
      records.filter((record) => record.temperature === 0).length === 15
      && Object.values(
        scoreStats['0'] as Record<string, { accepted: boolean }>,
      ).every((stats) => stats.accepted)
      && deterministicInvariantViolations.length === 0,
  };
}

async function main(): Promise<void> {
  const inputRoot = path.resolve(
    argument('--input-root')
    ?? process.env.TRIAGE_EVAL_INPUT_ROOT
    ?? 'data/experiments/issue-69/inputs',
  );
  const requirementSetFile = path.resolve(
    argument('--requirement-set')
    ?? path.join(path.dirname(inputRoot), 'rubric-requirements.json'),
  );
  const outputFile = path.resolve(
    argument('--output')
    ?? 'data/experiments/issue-69/stability-results.json',
  );
  const model =
    argument('--model')
    ?? process.env.LLM_MODEL
    ?? 'gemini-3-flash-preview:high';
  const requirementSet = JSON.parse(
    fs.readFileSync(requirementSetFile, 'utf8'),
  ) as CanonicalRequirementSet;
  const slugs = [
    'club-quarters-midtown-nyc',
    'candlewood-suites-new-york-city',
    'the-michelangelo',
  ];
  const stayContext = {
    checkIn: '2026-07-29',
    checkOut: '2026-08-11',
    adults: 2,
    destination: 'New York City, USA',
  };
  const resumable =
    argv.includes('--resume') && fs.existsSync(outputFile)
      ? JSON.parse(fs.readFileSync(outputFile, 'utf8')) as {
          startedAt?: string;
          records?: StabilityRecord[];
          attemptErrors?: Array<Record<string, unknown>>;
        }
      : null;
  const records: StabilityRecord[] = resumable?.records ?? [];
  const attemptErrors: Array<Record<string, unknown>> =
    resumable?.attemptErrors ?? [];
  const startedAt = resumable?.startedAt ?? new Date().toISOString();

  for (const temperature of [0, 1]) {
    for (let run = 1; run <= 5; run++) {
      for (const slug of slugs) {
        if (
          records.some(
            (record) =>
              record.temperature === temperature
              && record.run === run
              && record.slug === slug,
          )
        ) {
          continue;
        }
        const started = Date.now();
        let result: Awaited<ReturnType<typeof runTriage>> | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            result = await runTriage({
              listingFile: path.join(inputRoot, `${slug}.listing.json`),
              aiReviewsFile: path.join(inputRoot, `${slug}.reviews.json`),
              aiPhotosFile: path.join(inputRoot, `${slug}.photos.json`),
              model,
              requirementSet,
              classifierVersion: TRIAGE_CLASSIFIER_VERSION,
              temperature,
              stayContext,
            });
            break;
          } catch (error) {
            attemptErrors.push({
              temperature,
              run,
              slug,
              attempt,
              error: error instanceof Error ? error.message : String(error),
              recordedAt: new Date().toISOString(),
            });
            writeJson(outputFile, {
              issue: 69,
              startedAt,
              completed: false,
              model,
              classifierVersion: TRIAGE_CLASSIFIER_VERSION,
              attemptErrors,
              records,
            });
            if (attempt === 3) throw error;
          }
        }
        if (!result) {
          throw new Error(`No result produced for ${temperature}/${run}/${slug}.`);
        }
        const outcomes = result.data.requirements.map(
          (assessment: Outcome) => ({
            requirementId: assessment.requirementId,
            status: assessment.status,
            confidence: assessment.confidence,
          }),
        );
        records.push({
          temperature,
          run,
          slug,
          fitScore: result.data.fitScore,
          rawFitScore: result.data.rawFitScore,
          tier: result.data.tier,
          capReasons: result.data.capReasons,
          coverage: result.data.coverage,
          rankingStatus: result.data.rankingStatus,
          outcomes,
          classificationSignature: JSON.stringify(outcomes),
          usage: result.usage ?? null,
          durationMs: Date.now() - started,
        });
        writeJson(outputFile, {
          issue: 69,
          startedAt,
          completed: false,
          model,
          classifierVersion: TRIAGE_CLASSIFIER_VERSION,
          attemptErrors,
          records,
        });
      }
    }
  }

  const inputHashes = Object.fromEntries(
    fs.readdirSync(inputRoot)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => [file, sha256(path.join(inputRoot, file))]),
  );
  const summary = summarize(records, requirementSet);
  writeJson(outputFile, {
    issue: 69,
    sourceMeasurementIssue: 62,
    startedAt,
    completedAt: new Date().toISOString(),
    completed: true,
    model,
    classifierVersion: TRIAGE_CLASSIFIER_VERSION,
    requirementSetId: requirementSet.id,
    requirementSetSha256: sha256(requirementSetFile),
    inputHashes,
    stayContext,
    summary,
    attemptErrors,
    records,
  });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
