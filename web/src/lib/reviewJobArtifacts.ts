import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const REVIEW_JOB_ARTIFACT_DIR_ENV = 'STAYREVIEWR_ARTIFACT_DIR';
export const REVIEW_JOB_ARTIFACT_RETENTION_DAYS_ENV =
  'STAYREVIEWR_ARTIFACT_RETENTION_DAYS';
export const DEFAULT_REVIEW_JOB_ARTIFACT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReviewJobArtifactPolicy {
  rootDir: string;
  retentionDays: number;
  retentionMs: number;
}

export interface ReviewJobArtifactFile {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: Date;
}

export interface ReviewJobArtifactCleanupEntry {
  runDir: string;
  relativeRunDir: string;
  sizeBytes: number;
  lastModifiedAt: Date;
  protected: boolean;
}

export interface ReviewJobArtifactCleanupError {
  path: string;
  message: string;
}

export interface ReviewJobArtifactCleanupReport {
  rootDir: string;
  retentionDays: number;
  apply: boolean;
  scannedRunDirs: number;
  eligibleRunDirs: number;
  protectedRunDirs: number;
  removedRunDirs: number;
  bytesEligible: number;
  bytesFreed: number;
  entries: ReviewJobArtifactCleanupEntry[];
  errors: ReviewJobArtifactCleanupError[];
}

interface TreeStats {
  sizeBytes: number;
  latestMtimeMs: number;
}

function resolveProjectRoot(cwd: string): string {
  const resolvedCwd = path.resolve(cwd);
  return path.basename(resolvedCwd) === 'web'
    ? path.dirname(resolvedCwd)
    : resolvedCwd;
}

function resolveConfiguredRoot(
  rawValue: string | undefined,
  cwd: string,
): string {
  const projectRoot = resolveProjectRoot(cwd);
  const configured = rawValue?.trim();
  if (!configured) {
    return path.join(projectRoot, 'data', 'review-jobs');
  }

  if (configured === '~') {
    return os.homedir();
  }
  if (configured.startsWith('~/') || configured.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), configured.slice(2));
  }

  return path.resolve(projectRoot, configured);
}

function assertDedicatedArtifactRoot(rootDir: string, cwd: string): void {
  const resolvedRoot = path.resolve(rootDir);
  const projectRoot = resolveProjectRoot(cwd);
  const unsafeRoots = new Set([
    path.parse(resolvedRoot).root,
    path.resolve(os.homedir()),
    path.resolve(os.tmpdir()),
    projectRoot,
    path.join(projectRoot, 'web'),
  ]);

  if (unsafeRoots.has(resolvedRoot)) {
    throw new Error(
      `${REVIEW_JOB_ARTIFACT_DIR_ENV} must name a dedicated subdirectory; `
      + `refusing broad path "${resolvedRoot}"`,
    );
  }
}

function parseRetentionDays(env: NodeJS.ProcessEnv): number {
  const rawValue = env[REVIEW_JOB_ARTIFACT_RETENTION_DAYS_ENV]?.trim();
  if (!rawValue) {
    return DEFAULT_REVIEW_JOB_ARTIFACT_RETENTION_DAYS;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `${REVIEW_JOB_ARTIFACT_RETENTION_DAYS_ENV} must be a non-negative number; `
      + `received "${rawValue}"`,
    );
  }

  return parsed;
}

export function resolveReviewJobArtifactPolicy(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ReviewJobArtifactPolicy {
  const retentionDays = parseRetentionDays(env);
  const rootDir = resolveConfiguredRoot(env[REVIEW_JOB_ARTIFACT_DIR_ENV], cwd);
  assertDedicatedArtifactRoot(rootDir, cwd);
  return {
    rootDir,
    retentionDays,
    retentionMs: retentionDays * DAY_MS,
  };
}

function assertSafePathSegment(value: string, label: string): void {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
    || value === '.'
    || value === '..'
    || value.includes('..')
  ) {
    throw new Error(`${label} contains unsafe path characters`);
  }
}

function isSameOrWithin(rootDir: string, candidatePath: string): boolean {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function resolveWithinRoot(rootDir: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(resolvedRoot, ...segments);
  if (!isSameOrWithin(resolvedRoot, resolved)) {
    throw new Error('Artifact path escapes configured root');
  }
  return resolved;
}

export function getReviewJobArtifactWorkspaceDir(
  reviewJobId: string,
  policy: ReviewJobArtifactPolicy = resolveReviewJobArtifactPolicy(),
): string {
  assertSafePathSegment(reviewJobId, 'Review job ID');
  return resolveWithinRoot(policy.rootDir, reviewJobId);
}

export function getReviewJobArtifactRunDir(
  reviewJobId: string,
  runId: string,
  policy: ReviewJobArtifactPolicy = resolveReviewJobArtifactPolicy(),
): string {
  assertSafePathSegment(reviewJobId, 'Review job ID');
  assertSafePathSegment(runId, 'Review run ID');
  return resolveWithinRoot(policy.rootDir, reviewJobId, 'runs', runId);
}

export function ensureReviewJobArtifactWorkspace(
  reviewJobId: string,
  policy: ReviewJobArtifactPolicy = resolveReviewJobArtifactPolicy(),
): string {
  const workspaceDir = getReviewJobArtifactWorkspaceDir(reviewJobId, policy);
  fs.mkdirSync(workspaceDir, { recursive: true });
  return workspaceDir;
}

export function isReviewJobArtifactRootAvailable(
  artifactRoot: string | null | undefined,
): boolean {
  if (!artifactRoot) {
    return false;
  }

  try {
    const stat = fs.lstatSync(artifactRoot);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function isReviewJobArtifactFileAvailable(
  artifactPath: string | null | undefined,
): boolean {
  if (!artifactPath) {
    return false;
  }

  try {
    const stat = fs.lstatSync(artifactPath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function toPosixRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function scanTree(
  rootDir: string,
  currentDir: string,
  files?: ReviewJobArtifactFile[],
): TreeStats {
  const currentStat = fs.lstatSync(currentDir);
  if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
    throw new Error(`Artifact root is not a regular directory: ${currentDir}`);
  }

  let sizeBytes = 0;
  let latestMtimeMs = currentStat.mtimeMs;

  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const entryPath = path.join(currentDir, entry.name);
    let entryStat: fs.Stats;
    try {
      entryStat = fs.lstatSync(entryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    if (entryStat.isSymbolicLink()) {
      continue;
    }
    latestMtimeMs = Math.max(latestMtimeMs, entryStat.mtimeMs);
    if (entryStat.isDirectory()) {
      const childStats = scanTree(rootDir, entryPath, files);
      sizeBytes += childStats.sizeBytes;
      latestMtimeMs = Math.max(latestMtimeMs, childStats.latestMtimeMs);
      continue;
    }
    if (!entryStat.isFile()) {
      continue;
    }

    sizeBytes += entryStat.size;
    files?.push({
      absolutePath: entryPath,
      relativePath: toPosixRelativePath(rootDir, entryPath),
      sizeBytes: entryStat.size,
      modifiedAt: new Date(entryStat.mtimeMs),
    });
  }

  return { sizeBytes, latestMtimeMs };
}

export function listReviewJobArtifactFiles(
  artifactRoot: string,
): ReviewJobArtifactFile[] {
  const files: ReviewJobArtifactFile[] = [];
  scanTree(path.resolve(artifactRoot), path.resolve(artifactRoot), files);
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath));
}

function isProtectedRun(runDir: string, protectedRoots: Set<string>): boolean {
  const resolvedRunDir = path.resolve(runDir);
  return [...protectedRoots].some((protectedRoot) =>
    isSameOrWithin(resolvedRunDir, protectedRoot)
    || isSameOrWithin(protectedRoot, resolvedRunDir));
}

function removeEmptyDirectory(dirPath: string): void {
  try {
    fs.rmdirSync(dirPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
      throw error;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function cleanupReviewJobArtifacts(options: {
  policy?: ReviewJobArtifactPolicy;
  apply?: boolean;
  now?: number;
  protectedRoots?: Iterable<string>;
} = {}): ReviewJobArtifactCleanupReport {
  const policy = options.policy ?? resolveReviewJobArtifactPolicy();
  const apply = options.apply ?? false;
  const now = options.now ?? Date.now();
  const protectedRoots = new Set(
    [...(options.protectedRoots ?? [])].map((rootDir) => path.resolve(rootDir)),
  );
  const report: ReviewJobArtifactCleanupReport = {
    rootDir: policy.rootDir,
    retentionDays: policy.retentionDays,
    apply,
    scannedRunDirs: 0,
    eligibleRunDirs: 0,
    protectedRunDirs: 0,
    removedRunDirs: 0,
    bytesEligible: 0,
    bytesFreed: 0,
    entries: [],
    errors: [],
  };

  if (!fs.existsSync(policy.rootDir)) {
    return report;
  }

  const rootStat = fs.lstatSync(policy.rootDir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Artifact storage root is not a regular directory: ${policy.rootDir}`);
  }

  const cutoffMs = now - policy.retentionMs;
  for (const jobEntry of fs.readdirSync(policy.rootDir, { withFileTypes: true })) {
    if (!jobEntry.isDirectory() || jobEntry.isSymbolicLink()) {
      continue;
    }

    const jobDir = resolveWithinRoot(policy.rootDir, jobEntry.name);
    const runsDir = resolveWithinRoot(policy.rootDir, jobEntry.name, 'runs');
    if (!fs.existsSync(runsDir)) {
      continue;
    }

    const runsStat = fs.lstatSync(runsDir);
    if (!runsStat.isDirectory() || runsStat.isSymbolicLink()) {
      continue;
    }

    for (const runEntry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!runEntry.isDirectory() || runEntry.isSymbolicLink()) {
        continue;
      }

      const runDir = resolveWithinRoot(
        policy.rootDir,
        jobEntry.name,
        'runs',
        runEntry.name,
      );
      report.scannedRunDirs++;
      if (policy.retentionMs === 0) {
        continue;
      }

      let treeStats: TreeStats;
      try {
        treeStats = scanTree(runDir, runDir);
      } catch (error) {
        report.errors.push({ path: runDir, message: errorMessage(error) });
        continue;
      }

      if (treeStats.latestMtimeMs >= cutoffMs) {
        continue;
      }

      const protectedRun = isProtectedRun(runDir, protectedRoots);
      const entry: ReviewJobArtifactCleanupEntry = {
        runDir,
        relativeRunDir: toPosixRelativePath(policy.rootDir, runDir),
        sizeBytes: treeStats.sizeBytes,
        lastModifiedAt: new Date(treeStats.latestMtimeMs),
        protected: protectedRun,
      };
      report.entries.push(entry);

      if (protectedRun) {
        report.protectedRunDirs++;
        continue;
      }

      report.eligibleRunDirs++;
      report.bytesEligible += entry.sizeBytes;
      if (!apply) {
        continue;
      }

      try {
        fs.rmSync(runDir, { recursive: true, force: true });
        report.removedRunDirs++;
        report.bytesFreed += entry.sizeBytes;
      } catch (error) {
        report.errors.push({ path: runDir, message: errorMessage(error) });
      }
    }

    if (apply) {
      try {
        removeEmptyDirectory(runsDir);
        removeEmptyDirectory(jobDir);
      } catch (error) {
        report.errors.push({ path: jobDir, message: errorMessage(error) });
      }
    }
  }

  return report;
}

export function formatArtifactBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}
