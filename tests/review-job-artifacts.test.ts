import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  DEFAULT_REVIEW_JOB_ARTIFACT_RETENTION_DAYS,
  REVIEW_JOB_ARTIFACT_DIR_ENV,
  REVIEW_JOB_ARTIFACT_RETENTION_DAYS_ENV,
  cleanupReviewJobArtifacts,
  getReviewJobArtifactRunDir,
  listReviewJobArtifactFiles,
  resolveReviewJobArtifactPolicy,
  type ReviewJobArtifactPolicy,
} from '../web/src/lib/reviewJobArtifacts.js';
import {
  buildReviewJobArtifactArchiveFilename,
  createReviewJobArtifactArchive,
} from '../web/src/lib/reviewJobArtifactArchive.js';

function setTreeMtime(rootDir: string, timestampMs: number) {
  const date = new Date(timestampMs);
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      setTreeMtime(entryPath, timestampMs);
    } else if (!entry.isSymbolicLink()) {
      fs.utimesSync(entryPath, date, date);
    }
  }
  fs.utimesSync(rootDir, date, date);
}

function makePolicy(rootDir: string, retentionMs: number): ReviewJobArtifactPolicy {
  return {
    rootDir,
    retentionDays: retentionMs / (24 * 60 * 60 * 1000),
    retentionMs,
  };
}

test('review-job artifact policy defaults to durable repo data and validates overrides', () => {
  const projectRoot = path.join(os.tmpdir(), 'stayreviewr-policy-project');
  const defaultPolicy = resolveReviewJobArtifactPolicy({}, path.join(projectRoot, 'web'));
  assert.equal(
    defaultPolicy.rootDir,
    path.join(projectRoot, 'data', 'review-jobs'),
  );
  assert.equal(
    defaultPolicy.retentionDays,
    DEFAULT_REVIEW_JOB_ARTIFACT_RETENTION_DAYS,
  );

  const configuredPolicy = resolveReviewJobArtifactPolicy({
    [REVIEW_JOB_ARTIFACT_DIR_ENV]: 'var/artifacts',
    [REVIEW_JOB_ARTIFACT_RETENTION_DAYS_ENV]: '0',
  }, projectRoot);
  assert.equal(configuredPolicy.rootDir, path.join(projectRoot, 'var', 'artifacts'));
  assert.equal(configuredPolicy.retentionMs, 0);

  assert.throws(
    () => resolveReviewJobArtifactPolicy({
      [REVIEW_JOB_ARTIFACT_RETENTION_DAYS_ENV]: '-1',
    }, projectRoot),
    /must be a non-negative number/,
  );
  assert.throws(
    () => resolveReviewJobArtifactPolicy({
      [REVIEW_JOB_ARTIFACT_DIR_ENV]: '~',
    }, projectRoot),
    /refusing broad path/,
  );
  assert.throws(
    () => getReviewJobArtifactRunDir('../escape', 'run-1', configuredPolicy),
    /unsafe path characters/,
  );
});

test('artifact cleanup is dry-run-first, root-confined, byte-accounted, and protective', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-job-cleanup-'));
  const artifactRoot = path.join(tempDir, 'artifacts');
  const externalFile = path.join(tempDir, 'outside.txt');
  const now = Date.now();
  const policy = makePolicy(artifactRoot, 24 * 60 * 60 * 1000);
  const oldRun = getReviewJobArtifactRunDir('job-old', 'run-old', policy);
  const protectedRun = getReviewJobArtifactRunDir('job-protected', 'run-old', policy);
  const freshRun = getReviewJobArtifactRunDir('job-fresh', 'run-new', policy);

  try {
    fs.mkdirSync(oldRun, { recursive: true });
    fs.mkdirSync(protectedRun, { recursive: true });
    fs.mkdirSync(freshRun, { recursive: true });
    fs.writeFileSync(path.join(oldRun, 'old.txt'), 'old');
    fs.writeFileSync(path.join(protectedRun, 'protected.txt'), 'keep');
    fs.writeFileSync(path.join(freshRun, 'fresh.txt'), 'fresh');
    fs.writeFileSync(externalFile, 'outside data must never be counted or deleted');
    fs.symlinkSync(externalFile, path.join(oldRun, 'outside-link'));
    setTreeMtime(oldRun, now - 3 * 24 * 60 * 60 * 1000);
    setTreeMtime(protectedRun, now - 3 * 24 * 60 * 60 * 1000);
    setTreeMtime(freshRun, now);

    const dryRun = cleanupReviewJobArtifacts({
      policy,
      now,
      protectedRoots: [protectedRun],
    });
    assert.equal(dryRun.scannedRunDirs, 3);
    assert.equal(dryRun.eligibleRunDirs, 1);
    assert.equal(dryRun.protectedRunDirs, 1);
    assert.equal(dryRun.removedRunDirs, 0);
    assert.equal(dryRun.bytesEligible, 3);
    assert.equal(dryRun.bytesFreed, 0);
    assert.equal(fs.existsSync(oldRun), true);

    const applied = cleanupReviewJobArtifacts({
      policy,
      apply: true,
      now,
      protectedRoots: [protectedRun],
    });
    assert.equal(applied.removedRunDirs, 1);
    assert.equal(applied.bytesFreed, 3);
    assert.equal(applied.errors.length, 0);
    assert.equal(fs.existsSync(oldRun), false);
    assert.equal(fs.existsSync(protectedRun), true);
    assert.equal(fs.existsSync(freshRun), true);
    assert.equal(fs.readFileSync(externalFile, 'utf-8'), 'outside data must never be counted or deleted');

    const keepForever = cleanupReviewJobArtifacts({
      policy: makePolicy(artifactRoot, 0),
      apply: true,
      now,
    });
    assert.equal(keepForever.removedRunDirs, 0);
    assert.equal(fs.existsSync(protectedRun), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('artifact ZIP inventory skips symlinks and streams regular files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-job-archive-'));
  const artifactRoot = path.join(tempDir, 'run');
  const externalFile = path.join(tempDir, 'secret.txt');

  try {
    fs.mkdirSync(path.join(artifactRoot, 'photos'), { recursive: true });
    fs.writeFileSync(path.join(artifactRoot, 'batch_manifest.json'), '{"version":2}');
    fs.writeFileSync(path.join(artifactRoot, 'photos', 'one.jpg'), 'image bytes');
    fs.writeFileSync(externalFile, 'must not enter archive');
    fs.symlinkSync(externalFile, path.join(artifactRoot, 'secret-link.txt'));

    const files = listReviewJobArtifactFiles(artifactRoot);
    assert.deepEqual(
      files.map((file) => file.relativePath),
      ['batch_manifest.json', 'photos/one.jpg'],
    );
    assert.equal(
      files.reduce((total, file) => total + file.sizeBytes, 0),
      Buffer.byteLength('{"version":2}') + Buffer.byteLength('image bytes'),
    );

    const artifactArchive = createReviewJobArtifactArchive(artifactRoot);
    assert.ok(artifactArchive);
    assert.ok(artifactArchive.stream instanceof Readable);
    assert.equal(artifactArchive.stream.readableHighWaterMark, 64 * 1024);
    assert.equal(artifactArchive.fileCount, 2);

    const chunks: Buffer[] = [];
    for await (const chunk of artifactArchive.stream) {
      chunks.push(Buffer.from(chunk));
    }
    const zip = Buffer.concat(chunks);
    assert.equal(zip.subarray(0, 2).toString('ascii'), 'PK');
    assert.equal(zip.includes(Buffer.from('batch_manifest.json')), true);
    assert.equal(zip.includes(Buffer.from('photos/one.jpg')), true);
    assert.equal(zip.includes(Buffer.from('secret-link.txt')), false);
    assert.equal(
      buildReviewJobArtifactArchiveFilename('job/with unsafe value'),
      'stayreviewr-job-with-unsafe-value-artifacts.zip',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
