import 'dotenv/config';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  LEGACY_TRIAGE_CLASSIFIER_VERSION,
  TRIAGE_CLASSIFIER_VERSION,
  type TriageClassifierVersion,
} from '../../src/triage-comparability.js';
import type {
  CanonicalRequirementSet,
  RequirementStatus,
} from '../../src/triage-rubric.js';
import { runTriage } from '../../src/triage.js';

interface EvalLabel {
  requirementId: string;
  expectedStatus: RequirementStatus;
  boundaryCase: boolean;
  rationale: string;
  evidence: string[];
}

interface EvalListing {
  slug: string;
  label: string;
  inputSha256: Record<'listing' | 'reviews' | 'photos', string>;
  labels: EvalLabel[];
}

interface EvalFixture {
  issue: number;
  sourceIssue: number;
  stayContext: {
    checkIn: string;
    checkOut: string;
    adults: number;
    destination: string;
  };
  requirementSet: {
    id: string;
    sha256: string;
  };
  listings: EvalListing[];
}

const argv = process.argv.slice(2);

function argument(name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeResult(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
const fixtureFile = path.resolve(
  argument('--fixture')
  ?? 'tests/fixtures/triage-boundary-eval.json',
);
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
  ?? 'data/experiments/issue-69/boundary-eval-results.json',
);
const model =
  argument('--model')
  ?? process.env.LLM_MODEL
  ?? 'gemini-3-flash-preview:high';

const fixture = JSON.parse(
  fs.readFileSync(fixtureFile, 'utf8'),
) as EvalFixture;
const requirementSet = JSON.parse(
  fs.readFileSync(requirementSetFile, 'utf8'),
) as CanonicalRequirementSet;

if (requirementSet.id !== fixture.requirementSet.id) {
  throw new Error(
    `Requirement set mismatch: ${requirementSet.id} != ${fixture.requirementSet.id}`,
  );
}
if (sha256(requirementSetFile) !== fixture.requirementSet.sha256) {
  throw new Error('Requirement set hash does not match the labeled fixture.');
}

const filesByListing = new Map<string, {
  listingFile: string;
  aiReviewsFile: string;
  aiPhotosFile: string;
}>();
for (const listing of fixture.listings) {
  const files = {
    listingFile: path.join(inputRoot, `${listing.slug}.listing.json`),
    aiReviewsFile: path.join(inputRoot, `${listing.slug}.reviews.json`),
    aiPhotosFile: path.join(inputRoot, `${listing.slug}.photos.json`),
  };
  for (const [kind, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) {
      throw new Error(`Missing ${kind} fixture: ${file}`);
    }
  }
  const actualHashes = {
    listing: sha256(files.listingFile),
    reviews: sha256(files.aiReviewsFile),
    photos: sha256(files.aiPhotosFile),
  };
  for (const kind of ['listing', 'reviews', 'photos'] as const) {
    if (actualHashes[kind] !== listing.inputSha256[kind]) {
      throw new Error(`${listing.slug} ${kind} hash mismatch.`);
    }
  }
  filesByListing.set(listing.slug, files);
}

const versions: TriageClassifierVersion[] = [
  LEGACY_TRIAGE_CLASSIFIER_VERSION,
  TRIAGE_CLASSIFIER_VERSION,
];
const startedAt = new Date().toISOString();
const runs: Array<Record<string, unknown>> = [];

for (const classifierVersion of versions) {
  for (const listing of fixture.listings) {
    const files = filesByListing.get(listing.slug);
    if (!files) throw new Error(`Missing file map for ${listing.slug}.`);
    const result = await runTriage({
      ...files,
      model,
      requirementSet,
      temperature: 0,
      stayContext: fixture.stayContext,
      classifierVersion,
    });
    const assessments = result.data.requirements as Array<{
      requirementId: string;
      status: RequirementStatus;
      confidence: string;
      note: string;
    }>;
    const actualById = new Map(
      assessments.map(
        (assessment) => [assessment.requirementId, assessment] as const,
      ),
    );
    const outcomes = listing.labels.map((label) => {
      const actual = actualById.get(label.requirementId);
      return {
        requirementId: label.requirementId,
        expectedStatus: label.expectedStatus,
        boundaryCase: label.boundaryCase,
        actualStatus: actual?.status ?? null,
        confidence: actual?.confidence ?? null,
        note: actual?.note ?? null,
        correct: actual?.status === label.expectedStatus,
      };
    });
    runs.push({
      classifierVersion,
      slug: listing.slug,
      label: listing.label,
      fitScore: result.data.fitScore,
      tier: result.data.tier,
      outcomes,
      usage: result.usage ?? null,
    });
    writeResult(outputFile, {
      issue: fixture.issue,
      startedAt,
      completed: false,
      model,
      runs,
    });
  }
}

const summary = Object.fromEntries(
  versions.map((classifierVersion) => {
    const outcomes = runs
      .filter((run) => run.classifierVersion === classifierVersion)
      .flatMap((run) => run.outcomes as Array<{
        boundaryCase: boolean;
        correct: boolean;
      }>);
    const boundary = outcomes.filter((outcome) => outcome.boundaryCase);
    const correct = outcomes.filter((outcome) => outcome.correct).length;
    const boundaryCorrect =
      boundary.filter((outcome) => outcome.correct).length;
    return [
      classifierVersion,
      {
        correct,
        total: outcomes.length,
        accuracy: outcomes.length > 0 ? correct / outcomes.length : null,
        boundaryCorrect,
        boundaryTotal: boundary.length,
        boundaryAccuracy:
          boundary.length > 0 ? boundaryCorrect / boundary.length : null,
      },
    ];
  }),
);

writeResult(outputFile, {
  issue: fixture.issue,
  sourceIssue: fixture.sourceIssue,
  startedAt,
  completedAt: new Date().toISOString(),
  completed: true,
  model,
  fixtureFile,
  inputRoot,
  requirementSetFile,
  summary,
  runs,
});

console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
