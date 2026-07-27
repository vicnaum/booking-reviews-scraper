import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runBatch as defaultRunBatch,
  type BatchManifest,
  type BatchOptions,
  type ManifestEntry,
} from '../../../src/batch.js';
import { generateReport as defaultGenerateReport } from '../../../src/report.js';
import {
  getListingMatchKey,
  getManifestPathFromRoot,
  getReportPathFromRoot,
} from './review-job-analysis.js';
import {
  getReviewJobArtifactRunDir,
  isReviewJobArtifactRootAvailable,
} from './reviewJobArtifacts.js';

export const DETAILS_REPAIR_PLAN_VERSION = 1;
export const DETAILS_REPAIR_PLAN_FILE = 'details-repair-plan.json';

export type DetailsRepairPlatform = 'airbnb';
export type DetailsRepairCoreField =
  | 'title'
  | 'rating'
  | 'reviewCount'
  | 'subRatings'
  | 'amenities';

export interface DetailsRepairCoverage {
  title: boolean;
  rating: boolean;
  reviewCount: boolean;
  subRatings: boolean;
  amenities: boolean;
  total: number;
}

export interface DetailsRepairListingInput {
  rowId: string;
  analysisId: string;
  listingId: string;
  platform: 'airbnb' | 'booking';
  url: string;
  detailsStatus: string;
  details: unknown;
}

export interface DetailsRepairJobInput {
  id: string;
  status: string;
  currentPhase: string | null;
  analysisStatus: string;
  analysisCurrentPhase: string | null;
  priceRefreshStatus: string;
  priceRefreshCurrentPhase: string | null;
  artifactRoot: string | null;
  reportPath: string | null;
  checkin: string | null;
  checkout: string | null;
  adults: number;
  sourceStateFingerprint: string;
  listings: DetailsRepairListingInput[];
}

export interface DetailsRepairPlanListing {
  rowId: string;
  analysisId: string;
  listingId: string;
  platform: DetailsRepairPlatform;
  url: string;
  manifestKey: string;
  outcome: 'repaired' | 'preserved';
  message: string | null;
  addedFields: DetailsRepairCoreField[];
  beforeCoverage: DetailsRepairCoverage;
  afterCoverage: DetailsRepairCoverage;
  beforeDetailsFingerprint: string;
  sourceDetailsArtifactFingerprint: string;
  afterDetailsFingerprint: string;
  detailsFile: string;
  beforeDetailsStatus: string;
  afterDetailsStatus: ManifestEntry['details']['status'];
}

export interface DetailsRepairPlan {
  version: typeof DETAILS_REPAIR_PLAN_VERSION;
  jobId: string;
  platform: DetailsRepairPlatform;
  createdAt: string;
  sourceArtifactRoot: string;
  sourceReportPath: string | null;
  sourceStateFingerprint: string;
  sourceManifestFingerprint: string;
  sourcePreservedArtifactsFingerprint: string;
  stagedArtifactRoot: string;
  stagedReportPath: string;
  stagedReportFingerprint: string;
  stagedManifestInvariantFingerprint: string;
  stagedPreservedArtifactsFingerprint: string;
  listings: DetailsRepairPlanListing[];
  totalAddedFields: number;
}

export interface DetailsRepairApplyUpdate {
  analysisId: string;
  listingId: string;
  details: Record<string, unknown>;
  detailsStatus: 'completed' | 'partial';
}

type RunBatch = (
  filePaths: string[],
  options: BatchOptions,
) => Promise<unknown>;

type GenerateReport = (options: {
  outputDir: string;
  outputFile?: string;
}) => Promise<string>;

interface StageDetailsRepairInput {
  job: DetailsRepairJobInput;
  platform: DetailsRepairPlatform;
  stagedRoot?: string;
  now?: Date;
  runBatch?: RunBatch;
  generateReport?: GenerateReport;
}

const CORE_FIELDS: DetailsRepairCoreField[] = [
  'title',
  'rating',
  'reviewCount',
  'subRatings',
  'amenities',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function finiteNumber(value: unknown): number | null {
  if (
    value == null
    || (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasSubRatings(value: unknown): boolean {
  const record = asRecord(value);
  return !!record && Object.values(record).some(
    (rating) => finiteNumber(rating) != null,
  );
}

function hasAmenities(value: unknown): boolean {
  return Array.isArray(value) && value.some((amenity) => {
    if (typeof amenity === 'string') {
      return nonEmptyString(amenity) != null;
    }
    return nonEmptyString(asRecord(amenity)?.name) != null;
  });
}

export function getDetailsRepairCoverage(
  value: unknown,
): DetailsRepairCoverage {
  const details = asRecord(value);
  const coverage = {
    title: nonEmptyString(details?.title) != null,
    rating: finiteNumber(details?.rating) != null,
    reviewCount:
      finiteNumber(details?.reviewCount) != null
      && (finiteNumber(details?.reviewCount) as number) >= 0,
    subRatings: hasSubRatings(details?.subRatings),
    amenities: hasAmenities(details?.amenities),
  };
  return {
    ...coverage,
    total: CORE_FIELDS.filter((field) => coverage[field]).length,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeForFingerprint(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForFingerprint(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeForFingerprint(child)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return null;
  }
  return value;
}

export function fingerprintDetailsRepairValue(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizeForFingerprint(value)))
    .digest('hex');
}

function fingerprintFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fingerprintArtifactTree(
  rootDir: string,
  excludedRelativePaths: Set<string>,
): string {
  const resolvedRoot = path.resolve(rootDir);
  const hash = createHash('sha256');

  function walk(currentDir: string): void {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(currentDir, entry.name);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Artifact tree contains a symbolic link: ${filePath}`,
        );
      }
      if (stat.isDirectory()) {
        walk(filePath);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(
          `Artifact tree contains a non-regular entry: ${filePath}`,
        );
      }
      const relativePath =
        path.relative(resolvedRoot, filePath).split(path.sep).join('/');
      if (excludedRelativePaths.has(relativePath)) {
        continue;
      }
      hash.update(relativePath);
      hash.update('\0');
      hash.update(fs.readFileSync(filePath));
      hash.update('\0');
    }
  }

  walk(resolvedRoot);
  return hash.digest('hex');
}

function repairMutableArtifactPaths(
  detailsFiles: Iterable<string>,
): Set<string> {
  return new Set([
    'batch_manifest.json',
    'report.html',
    'details_repair_urls.txt',
    DETAILS_REPAIR_PLAN_FILE,
    ...Array.from(detailsFiles, (filePath) =>
      filePath.split(path.sep).join('/')),
  ]);
}

function resolveArtifactFile(
  rootDir: string,
  relativePath: string,
  label: string,
): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a relative artifact path`);
  }
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (
    resolved === resolvedRoot
    || !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`${label} escapes the artifact root`);
  }
  return resolved;
}

function assertRegularFile(filePath: string, label: string): void {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file: ${filePath}`);
  }
}

function assertIdleJob(job: DetailsRepairJobInput): void {
  if (job.status === 'pending' || job.status === 'running') {
    throw new Error(
      `Review job ${job.id} is ${job.status}; details repair requires an idle job`,
    );
  }
  if (
    job.analysisStatus === 'running'
    || job.analysisCurrentPhase === 'queued'
  ) {
    throw new Error(
      `Review job ${job.id} has analysis in progress`,
    );
  }
  if (
    job.priceRefreshStatus === 'running'
    || job.priceRefreshCurrentPhase === 'queued'
  ) {
    throw new Error(
      `Review job ${job.id} has a price refresh in progress`,
    );
  }
}

function getManifestEntry(
  manifest: BatchManifest,
  platform: 'airbnb' | 'booking',
  url: string,
): [string, ManifestEntry] | null {
  const matchKey = getListingMatchKey(platform, url);
  return Object.entries(manifest.listings).find(
    ([, entry]) =>
      getListingMatchKey(entry.platform, entry.url) === matchKey,
  ) ?? null;
}

function manifestInvariantValue(
  manifest: BatchManifest,
  mutableTargetKeys: Set<string>,
): unknown {
  return {
    ...manifest,
    updatedAt: '<ignored>',
    listings: Object.fromEntries(
      Object.entries(manifest.listings).map(([key, entry]) => {
        const matchKey = getListingMatchKey(entry.platform, entry.url);
        return [
          key,
          mutableTargetKeys.has(matchKey)
            ? { ...entry, details: '<repair-target>' }
            : entry,
        ];
      }),
    ),
  };
}

function manifestInvariantFingerprint(
  manifest: BatchManifest,
  mutableTargetKeys: Set<string>,
): string {
  return fingerprintDetailsRepairValue(
    manifestInvariantValue(manifest, mutableTargetKeys),
  );
}

function restoreSourceDetails(input: {
  sourceRoot: string;
  stagedRoot: string;
  sourceEntry: ManifestEntry;
  stagedEntry: ManifestEntry;
}): void {
  input.stagedEntry.details = cloneJson(input.sourceEntry.details);
  if (!input.sourceEntry.details.file) {
    throw new Error(
      `Source details artifact is missing for ${input.sourceEntry.platform}/`
      + `${input.sourceEntry.id}`,
    );
  }
  const sourcePath = resolveArtifactFile(
    input.sourceRoot,
    input.sourceEntry.details.file,
    'Source details path',
  );
  assertRegularFile(sourcePath, 'Source details artifact');
  const destinationPath = resolveArtifactFile(
    input.stagedRoot,
    input.sourceEntry.details.file,
    'Staged details path',
  );
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

function mergeMissingCoreFields(
  beforeValue: unknown,
  candidateValue: unknown,
): {
  details: Record<string, unknown>;
  addedFields: DetailsRepairCoreField[];
} {
  const before = asRecord(beforeValue) ?? {};
  const candidate = asRecord(candidateValue) ?? {};
  const merged = cloneJson(before);
  const beforeCoverage = getDetailsRepairCoverage(before);
  const candidateCoverage = getDetailsRepairCoverage(candidate);
  const addedFields: DetailsRepairCoreField[] = [];

  for (const field of CORE_FIELDS) {
    if (!beforeCoverage[field] && candidateCoverage[field]) {
      merged[field] = cloneJson(candidate[field]);
      addedFields.push(field);
    }
  }

  return { details: merged, addedFields };
}

function getCoverageRegressions(
  before: DetailsRepairCoverage,
  after: DetailsRepairCoverage,
): DetailsRepairCoreField[] {
  return CORE_FIELDS.filter((field) => before[field] && !after[field]);
}

function toDbDetailsStatus(
  status: ManifestEntry['details']['status'],
): 'completed' | 'partial' {
  if (status === 'fetched' || status === 'skipped') {
    return 'completed';
  }
  if (status === 'partial') {
    return 'partial';
  }
  throw new Error(`Cannot persist details phase status "${status}"`);
}

function createRepairRunId(now: Date): string {
  return `details-repair-${now.toISOString().replace(/[:.]/g, '-')}`;
}

function copyArtifactRoot(sourceRoot: string, stagedRoot: string): void {
  if (!isReviewJobArtifactRootAvailable(sourceRoot)) {
    throw new Error(`Saved artifact root is unavailable: ${sourceRoot}`);
  }
  const resolvedSource = path.resolve(sourceRoot);
  const resolvedStaged = path.resolve(stagedRoot);
  if (path.dirname(resolvedSource) !== path.dirname(resolvedStaged)) {
    throw new Error(
      'Staged artifact root must be a sibling of the source run',
    );
  }
  if (
    resolvedSource === resolvedStaged
    || resolvedStaged.startsWith(`${resolvedSource}${path.sep}`)
    || resolvedSource.startsWith(`${resolvedStaged}${path.sep}`)
  ) {
    throw new Error('Staged and source artifact roots must be separate');
  }
  if (fs.existsSync(resolvedStaged)) {
    throw new Error(`Staged artifact root already exists: ${resolvedStaged}`);
  }
  fs.mkdirSync(path.dirname(resolvedStaged), { recursive: true });
  fs.cpSync(resolvedSource, resolvedStaged, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter(sourcePath) {
      return path.basename(sourcePath) !== 'runs';
    },
  });
}

function readManifest(rootDir: string): BatchManifest {
  const manifestPath = getManifestPathFromRoot(rootDir);
  assertRegularFile(manifestPath, 'Batch manifest');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BatchManifest;
}

function writeManifest(rootDir: string, manifest: BatchManifest): void {
  fs.writeFileSync(
    getManifestPathFromRoot(rootDir),
    JSON.stringify(manifest, null, 2),
  );
}

export async function stageReviewJobDetailsRepair(
  input: StageDetailsRepairInput,
): Promise<DetailsRepairPlan> {
  assertIdleJob(input.job);
  if (!input.job.artifactRoot) {
    throw new Error(`Review job ${input.job.id} has no saved artifact root`);
  }
  const now = input.now ?? new Date();
  const sourceRoot = path.resolve(input.job.artifactRoot);
  const stagedRoot = path.resolve(
    input.stagedRoot
      ?? getReviewJobArtifactRunDir(
        input.job.id,
        createRepairRunId(now),
      ),
  );
  const targets = input.job.listings.filter(
    (listing): listing is DetailsRepairListingInput & {
      platform: DetailsRepairPlatform;
    } => listing.platform === input.platform,
  );
  if (targets.length === 0) {
    throw new Error(
      `Review job ${input.job.id} has no ${input.platform} listings`,
    );
  }
  for (const target of targets) {
    if (!target.analysisId) {
      throw new Error(
        `Review job listing ${target.rowId} has no persisted analysis row`,
      );
    }
  }

  const sourceManifest = readManifest(sourceRoot);
  const sourceManifestFingerprint =
    fingerprintDetailsRepairValue(sourceManifest);
  const targetKeys = new Set(
    targets.map((listing) =>
      getListingMatchKey(listing.platform, listing.url)),
  );
  const sourceDetailsFiles = targets.map((listing) => {
    const entry = getManifestEntry(
      sourceManifest,
      listing.platform,
      listing.url,
    )?.[1];
    if (!entry?.details.file) {
      throw new Error(
        `Manifest details file not found for ${listing.platform}/`
        + `${listing.listingId}`,
      );
    }
    return entry.details.file;
  });
  const mutableArtifactPaths =
    repairMutableArtifactPaths(sourceDetailsFiles);
  const sourcePreservedArtifactsFingerprint = fingerprintArtifactTree(
    sourceRoot,
    mutableArtifactPaths,
  );
  const sourceInvariant =
    manifestInvariantFingerprint(sourceManifest, targetKeys);

  copyArtifactRoot(sourceRoot, stagedRoot);
  if (
    fingerprintArtifactTree(stagedRoot, mutableArtifactPaths)
    !== sourcePreservedArtifactsFingerprint
  ) {
    throw new Error(
      'Staged artifact copy changed a preserved artifact unexpectedly',
    );
  }
  const stagedManifest = readManifest(stagedRoot);
  if (
    manifestInvariantFingerprint(stagedManifest, targetKeys)
    !== sourceInvariant
  ) {
    throw new Error('Staged artifact copy changed the manifest unexpectedly');
  }

  for (const target of targets) {
    const matched = getManifestEntry(
      stagedManifest,
      target.platform,
      target.url,
    );
    if (!matched) {
      throw new Error(
        `Manifest entry not found for ${target.platform}/${target.listingId}`,
      );
    }
    const [, entry] = matched;
    if (!entry.details.file) {
      throw new Error(
        `Manifest details file not found for ${target.platform}/`
        + `${target.listingId}`,
      );
    }
    const stagedDetailsPath = resolveArtifactFile(
      stagedRoot,
      entry.details.file,
      'Staged details path',
    );
    if (fs.existsSync(stagedDetailsPath)) {
      assertRegularFile(stagedDetailsPath, 'Staged details artifact');
      fs.rmSync(stagedDetailsPath);
    }
    entry.details = { status: 'not_requested' };
  }
  stagedManifest.updatedAt = now.toISOString();
  writeManifest(stagedRoot, stagedManifest);

  const urlsFile = path.join(stagedRoot, 'details_repair_urls.txt');
  fs.writeFileSync(
    urlsFile,
    `${targets.map((listing) => listing.url).join('\n')}\n`,
  );

  const runBatch = input.runBatch ?? defaultRunBatch;
  await runBatch([urlsFile], {
    fetchDetails: true,
    fetchReviews: false,
    fetchPhotos: false,
    aiReviews: false,
    aiPhotos: false,
    triage: false,
    aiReviewsExplicit: false,
    aiPhotosExplicit: false,
    triageExplicit: false,
    checkIn: input.job.checkin ?? undefined,
    checkOut: input.job.checkout ?? undefined,
    adults: input.job.adults,
    force: false,
    retryFailed: false,
    downloadPhotosAll: false,
    outputDir: stagedRoot,
    scopeManifestToInput: false,
    scopePostScrapePhasesToInput: true,
    print: false,
    programmatic: true,
  });

  const refreshedManifest = readManifest(stagedRoot);
  if (
    manifestInvariantFingerprint(refreshedManifest, targetKeys)
    !== sourceInvariant
  ) {
    throw new Error(
      'Details-only batch changed a non-details manifest field',
    );
  }

  const plannedListings: DetailsRepairPlanListing[] = [];
  for (const target of targets) {
    const sourceMatch = getManifestEntry(
      sourceManifest,
      target.platform,
      target.url,
    );
    const refreshedMatch = getManifestEntry(
      refreshedManifest,
      target.platform,
      target.url,
    );
    if (!sourceMatch || !refreshedMatch) {
      throw new Error(
        `Manifest entry disappeared for ${target.platform}/`
        + `${target.listingId}`,
      );
    }
    const [manifestKey, sourceEntry] = sourceMatch;
    const [, refreshedEntry] = refreshedMatch;
    if (!sourceEntry.details.file) {
      throw new Error(
        `Source details file missing for ${target.platform}/`
        + `${target.listingId}`,
      );
    }
    const sourceDetailsPath = resolveArtifactFile(
      sourceRoot,
      sourceEntry.details.file,
      'Source details path',
    );
    assertRegularFile(sourceDetailsPath, 'Source details artifact');
    const beforeCoverage = getDetailsRepairCoverage(target.details);
    const beforeDetailsFingerprint =
      fingerprintDetailsRepairValue(target.details);
    let message: string | null = null;
    let outcome: DetailsRepairPlanListing['outcome'] = 'preserved';
    let addedFields: DetailsRepairCoreField[] = [];
    let afterDetails = asRecord(target.details) ?? {};

    const candidateFile = refreshedEntry.details.file
      ? resolveArtifactFile(
        stagedRoot,
        refreshedEntry.details.file,
        'Candidate details path',
      )
      : null;
    const candidateDetails =
      candidateFile
      && fs.existsSync(candidateFile)
      && !fs.lstatSync(candidateFile).isSymbolicLink()
        ? JSON.parse(fs.readFileSync(candidateFile, 'utf8')) as unknown
        : null;
    const candidateUsable =
      (
        refreshedEntry.details.status === 'fetched'
        || refreshedEntry.details.status === 'partial'
      )
      && asRecord(candidateDetails) != null;

    if (candidateUsable) {
      const merged = mergeMissingCoreFields(
        target.details,
        candidateDetails,
      );
      afterDetails = merged.details;
      addedFields = merged.addedFields;
      if (addedFields.length > 0) {
        outcome = 'repaired';
        message =
          refreshedEntry.details.error
          ?? refreshedEntry.details.reason
          ?? null;
        const detailsFile = refreshedEntry.details.file as string;
        fs.writeFileSync(
          resolveArtifactFile(
            stagedRoot,
            detailsFile,
            'Repaired details path',
          ),
          JSON.stringify(afterDetails, null, 2),
        );
      } else {
        message = 'Provider result added no previously missing core fields';
        restoreSourceDetails({
          sourceRoot,
          stagedRoot,
          sourceEntry,
          stagedEntry: refreshedEntry,
        });
        afterDetails = asRecord(target.details) ?? {};
      }
    } else {
      message =
        refreshedEntry.details.error
        ?? refreshedEntry.details.reason
        ?? 'Provider did not return a usable details artifact';
      restoreSourceDetails({
        sourceRoot,
        stagedRoot,
        sourceEntry,
        stagedEntry: refreshedEntry,
      });
    }

    const afterCoverage = getDetailsRepairCoverage(afterDetails);
    const regressions = getCoverageRegressions(
      beforeCoverage,
      afterCoverage,
    );
    if (
      regressions.length > 0
      || afterCoverage.total < beforeCoverage.total
    ) {
      throw new Error(
        `Core-field regression for ${target.platform}/${target.listingId}: `
        + `${regressions.join(', ') || 'coverage count decreased'}`,
      );
    }

    const finalDetailsFile =
      refreshedEntry.details.file ?? sourceEntry.details.file;
    if (!finalDetailsFile) {
      throw new Error(
        `Final details file missing for ${target.platform}/`
        + `${target.listingId}`,
      );
    }
    const finalDetailsPath = resolveArtifactFile(
      stagedRoot,
      finalDetailsFile,
      'Final details path',
    );
    assertRegularFile(finalDetailsPath, 'Final details artifact');
    const persistedDetails = JSON.parse(
      fs.readFileSync(finalDetailsPath, 'utf8'),
    ) as unknown;

    plannedListings.push({
      rowId: target.rowId,
      analysisId: target.analysisId,
      listingId: target.listingId,
      platform: target.platform,
      url: target.url,
      manifestKey,
      outcome,
      message,
      addedFields,
      beforeCoverage,
      afterCoverage,
      beforeDetailsFingerprint,
      sourceDetailsArtifactFingerprint:
        fingerprintFile(sourceDetailsPath),
      afterDetailsFingerprint:
        fingerprintDetailsRepairValue(persistedDetails),
      detailsFile: finalDetailsFile,
      beforeDetailsStatus: target.detailsStatus,
      afterDetailsStatus: refreshedEntry.details.status,
    });
  }

  const totalAddedFields = plannedListings.reduce(
    (sum, listing) => sum + listing.addedFields.length,
    0,
  );
  if (totalAddedFields === 0) {
    throw new Error(
      'Details repair recovered no missing core fields; refusing a no-op plan',
    );
  }

  writeManifest(stagedRoot, refreshedManifest);
  const generateReport = input.generateReport ?? defaultGenerateReport;
  const stagedReportPath = getReportPathFromRoot(stagedRoot);
  await generateReport({
    outputDir: stagedRoot,
    outputFile: stagedReportPath,
  });
  assertRegularFile(stagedReportPath, 'Staged report');
  const stagedPreservedArtifactsFingerprint = fingerprintArtifactTree(
    stagedRoot,
    mutableArtifactPaths,
  );
  if (
    stagedPreservedArtifactsFingerprint
    !== sourcePreservedArtifactsFingerprint
  ) {
    throw new Error(
      'Details-only repair changed a preserved non-details artifact',
    );
  }

  const plan: DetailsRepairPlan = {
    version: DETAILS_REPAIR_PLAN_VERSION,
    jobId: input.job.id,
    platform: input.platform,
    createdAt: now.toISOString(),
    sourceArtifactRoot: sourceRoot,
    sourceReportPath: input.job.reportPath,
    sourceStateFingerprint: input.job.sourceStateFingerprint,
    sourceManifestFingerprint,
    sourcePreservedArtifactsFingerprint,
    stagedArtifactRoot: stagedRoot,
    stagedReportPath,
    stagedReportFingerprint: fingerprintFile(stagedReportPath),
    stagedManifestInvariantFingerprint:
      manifestInvariantFingerprint(refreshedManifest, targetKeys),
    stagedPreservedArtifactsFingerprint,
    listings: plannedListings,
    totalAddedFields,
  };
  fs.writeFileSync(
    path.join(stagedRoot, DETAILS_REPAIR_PLAN_FILE),
    JSON.stringify(plan, null, 2),
  );
  return plan;
}

export function readReviewJobDetailsRepairPlan(
  stagedRoot: string,
): DetailsRepairPlan {
  const resolvedRoot = path.resolve(stagedRoot);
  if (!isReviewJobArtifactRootAvailable(resolvedRoot)) {
    throw new Error(`Staged artifact root is unavailable: ${resolvedRoot}`);
  }
  const planPath = path.join(resolvedRoot, DETAILS_REPAIR_PLAN_FILE);
  assertRegularFile(planPath, 'Details repair plan');
  const plan = JSON.parse(
    fs.readFileSync(planPath, 'utf8'),
  ) as DetailsRepairPlan;
  if (plan.version !== DETAILS_REPAIR_PLAN_VERSION) {
    throw new Error(
      `Unsupported details repair plan version: ${String(plan.version)}`,
    );
  }
  if (path.resolve(plan.stagedArtifactRoot) !== resolvedRoot) {
    throw new Error('Details repair plan does not match the staged root');
  }
  if (
    path.dirname(path.resolve(plan.sourceArtifactRoot))
    !== path.dirname(resolvedRoot)
  ) {
    throw new Error(
      'Staged artifact root is not a sibling of the source run',
    );
  }
  return plan;
}

export function validateReviewJobDetailsRepairForApply(input: {
  plan: DetailsRepairPlan;
  job: DetailsRepairJobInput;
}): DetailsRepairApplyUpdate[] {
  const { plan, job } = input;
  assertIdleJob(job);
  if (job.id !== plan.jobId) {
    throw new Error(
      `Repair plan is for ${plan.jobId}, not ${job.id}`,
    );
  }
  if (path.resolve(job.artifactRoot ?? '') !== plan.sourceArtifactRoot) {
    throw new Error(
      'Review job artifact root changed after the dry run; refusing apply',
    );
  }
  if (job.reportPath !== plan.sourceReportPath) {
    throw new Error(
      'Review job report path changed after the dry run; refusing apply',
    );
  }
  if (job.sourceStateFingerprint !== plan.sourceStateFingerprint) {
    throw new Error(
      'Review job state changed after the dry run; refusing apply',
    );
  }

  const sourceManifest = readManifest(plan.sourceArtifactRoot);
  if (
    fingerprintDetailsRepairValue(sourceManifest)
    !== plan.sourceManifestFingerprint
  ) {
    throw new Error(
      'Source manifest changed after the dry run; refusing apply',
    );
  }
  const mutableArtifactPaths = repairMutableArtifactPaths(
    plan.listings.map((listing) => listing.detailsFile),
  );
  if (
    fingerprintArtifactTree(
      plan.sourceArtifactRoot,
      mutableArtifactPaths,
    ) !== plan.sourcePreservedArtifactsFingerprint
  ) {
    throw new Error(
      'Source non-details artifacts changed after the dry run; refusing apply',
    );
  }
  const stagedManifest = readManifest(plan.stagedArtifactRoot);
  const targetKeys = new Set(
    plan.listings.map((listing) =>
      getListingMatchKey(listing.platform, listing.url)),
  );
  if (
    manifestInvariantFingerprint(stagedManifest, targetKeys)
    !== plan.stagedManifestInvariantFingerprint
  ) {
    throw new Error(
      'Staged non-details manifest state changed after the dry run',
    );
  }
  if (
    fingerprintArtifactTree(
      plan.stagedArtifactRoot,
      mutableArtifactPaths,
    ) !== plan.stagedPreservedArtifactsFingerprint
  ) {
    throw new Error(
      'Staged preserved artifacts changed after the dry run',
    );
  }
  assertRegularFile(plan.stagedReportPath, 'Staged report');
  if (
    fingerprintFile(plan.stagedReportPath)
    !== plan.stagedReportFingerprint
  ) {
    throw new Error('Staged report changed after the dry run');
  }

  const currentListings = new Map(
    job.listings.map((listing) => [listing.rowId, listing]),
  );
  const plannedTotalAddedFields = plan.listings.reduce(
    (sum, listing) => sum + listing.addedFields.length,
    0,
  );
  if (plannedTotalAddedFields !== plan.totalAddedFields) {
    throw new Error('Repair plan added-field total is inconsistent');
  }
  const updates: DetailsRepairApplyUpdate[] = [];
  for (const planned of plan.listings) {
    const current = currentListings.get(planned.rowId);
    if (
      !current
      || current.analysisId !== planned.analysisId
      || current.listingId !== planned.listingId
      || current.platform !== planned.platform
      || current.url !== planned.url
    ) {
      throw new Error(
        `Review job listing changed after dry run: ${planned.listingId}`,
      );
    }
    if (
      fingerprintDetailsRepairValue(current.details)
      !== planned.beforeDetailsFingerprint
    ) {
      throw new Error(
        `Persisted details changed after dry run: ${planned.listingId}`,
      );
    }
    const currentCoverage = getDetailsRepairCoverage(current.details);
    if (
      fingerprintDetailsRepairValue(currentCoverage)
      !== fingerprintDetailsRepairValue(planned.beforeCoverage)
    ) {
      throw new Error(
        `Persisted details coverage changed after dry run: `
        + `${planned.listingId}`,
      );
    }

    const entry = getManifestEntry(
      stagedManifest,
      planned.platform,
      planned.url,
    )?.[1];
    if (!entry || entry.details.file !== planned.detailsFile) {
      throw new Error(
        `Staged manifest details changed: ${planned.listingId}`,
      );
    }
    if (entry.details.status !== planned.afterDetailsStatus) {
      throw new Error(
        `Staged manifest details status changed: ${planned.listingId}`,
      );
    }
    const sourceEntry = getManifestEntry(
      sourceManifest,
      planned.platform,
      planned.url,
    )?.[1];
    if (!sourceEntry?.details.file) {
      throw new Error(
        `Source manifest details disappeared: ${planned.listingId}`,
      );
    }
    const sourceDetailsPath = resolveArtifactFile(
      plan.sourceArtifactRoot,
      sourceEntry.details.file,
      'Source details path',
    );
    assertRegularFile(sourceDetailsPath, 'Source details artifact');
    if (
      fingerprintFile(sourceDetailsPath)
      !== planned.sourceDetailsArtifactFingerprint
    ) {
      throw new Error(
        `Source details artifact changed after dry run: `
        + `${planned.listingId}`,
      );
    }
    const detailsPath = resolveArtifactFile(
      plan.stagedArtifactRoot,
      planned.detailsFile,
      'Planned details path',
    );
    assertRegularFile(detailsPath, 'Planned details artifact');
    const details = JSON.parse(
      fs.readFileSync(detailsPath, 'utf8'),
    ) as unknown;
    if (
      fingerprintDetailsRepairValue(details)
      !== planned.afterDetailsFingerprint
    ) {
      throw new Error(
        `Staged details changed after dry run: ${planned.listingId}`,
      );
    }
    const afterCoverage = getDetailsRepairCoverage(details);
    if (
      fingerprintDetailsRepairValue(afterCoverage)
      !== fingerprintDetailsRepairValue(planned.afterCoverage)
    ) {
      throw new Error(
        `Staged details coverage changed after dry run: ${planned.listingId}`,
      );
    }
    const regressions = getCoverageRegressions(
      planned.beforeCoverage,
      afterCoverage,
    );
    if (
      regressions.length > 0
      || afterCoverage.total < planned.beforeCoverage.total
    ) {
      throw new Error(
        `Staged details regress core fields for ${planned.listingId}`,
      );
    }
    const addedFields = CORE_FIELDS.filter(
      (field) => !currentCoverage[field] && afterCoverage[field],
    );
    if (
      fingerprintDetailsRepairValue(addedFields)
      !== fingerprintDetailsRepairValue(planned.addedFields)
    ) {
      throw new Error(
        `Staged added fields changed after dry run: ${planned.listingId}`,
      );
    }
    if (
      (planned.outcome === 'repaired') !== (addedFields.length > 0)
    ) {
      throw new Error(
        `Repair outcome is inconsistent for ${planned.listingId}`,
      );
    }
    if (planned.outcome === 'repaired') {
      const record = asRecord(details);
      if (!record) {
        throw new Error(
          `Staged details are not an object: ${planned.listingId}`,
        );
      }
      const expectedDetails = mergeMissingCoreFields(
        current.details,
        details,
      ).details;
      if (
        fingerprintDetailsRepairValue(expectedDetails)
        !== fingerprintDetailsRepairValue(record)
      ) {
        throw new Error(
          `Staged details changed fields outside the missing-core repair: `
          + `${planned.listingId}`,
        );
      }
      updates.push({
        analysisId: planned.analysisId,
        listingId: planned.listingId,
        details: record,
        detailsStatus: toDbDetailsStatus(planned.afterDetailsStatus),
      });
    }
  }

  if (updates.length === 0) {
    throw new Error('Repair plan contains no persisted details updates');
  }
  return updates;
}
