import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveArtifactCachePolicy } from './artifact-cache.js';
import {
  buildPrioritiesMatrix,
  type PrioritiesMatrix,
  type PrioritiesMatrixAffordability,
  type PrioritiesMatrixInputRow,
} from './priorities-matrix.js';
import {
  getStaySnapshotReadModel,
  parseStaySnapshot,
  type StayRequestFingerprint,
} from './stay-snapshot.js';

export interface PrioritiesMatrixReportOptions {
  outputDir: string;
  outputFile?: string;
  generatedAt?: string;
  now?: Date | number;
}

interface ManifestPhase {
  status?: string;
  file?: string;
  count?: number;
  expected?: number;
}

interface ManifestEntry {
  platform: 'airbnb' | 'booking';
  id: string;
  url: string;
  details?: ManifestPhase;
  reviews?: ManifestPhase;
  aiReviews?: ManifestPhase;
  triage?: ManifestPhase;
}

interface BatchManifest {
  dates?: {
    checkIn?: string;
    checkOut?: string;
    adults?: number;
  };
  listings?: Record<string, ManifestEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asNonNegativeInteger(value: unknown): number | null {
  return (
    typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
  )
    ? value
    : null;
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function readArtifact(
  outputDir: string,
  phase: ManifestPhase | undefined,
): unknown {
  if (!phase?.file) return null;
  return readJsonFile(path.join(outputDir, phase.file));
}

function linkedRoomIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const blockId =
      parsed.searchParams.get('matching_block_id')
      ?? parsed.searchParams.get('highlighted_blocks');
    return blockId?.match(/^(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function fallbackStayRequest(
  entry: ManifestEntry,
  dates: BatchManifest['dates'],
): StayRequestFingerprint {
  return {
    platform: entry.platform,
    listingId: entry.id,
    checkIn: dates?.checkIn ?? null,
    checkOut: dates?.checkOut ?? null,
    adults: dates?.adults ?? null,
    linkedRoomId:
      entry.platform === 'booking'
        ? linkedRoomIdFromUrl(entry.url)
        : null,
  };
}

function getAffordability(
  triage: unknown,
): Partial<PrioritiesMatrixAffordability> | null {
  if (!isRecord(triage) || !isRecord(triage.affordability)) {
    return null;
  }
  return triage.affordability as Partial<PrioritiesMatrixAffordability>;
}

export function buildPrioritiesMatrixFromArtifacts(
  options: PrioritiesMatrixReportOptions,
): PrioritiesMatrix {
  const outputDir = path.resolve(options.outputDir);
  const manifestPath = path.join(outputDir, 'batch_manifest.json');
  const manifest = readJsonFile(manifestPath) as BatchManifest | null;
  if (!manifest?.listings) {
    throw new Error(`Manifest not found or invalid: ${manifestPath}`);
  }

  const detailsTtlMs = resolveArtifactCachePolicy().ttlMs.details;
  const rows: PrioritiesMatrixInputRow[] = Object.values(
    manifest.listings,
  ).map((entry) => {
    const details = readArtifact(outputDir, entry.details);
    const detailsRecord = isRecord(details) ? details : null;
    const triage = readArtifact(outputDir, entry.triage);
    const parsedSnapshot = parseStaySnapshot(detailsRecord?.staySnapshot);
    const staySnapshot = getStaySnapshotReadModel({
      snapshot: detailsRecord?.staySnapshot ?? null,
      fallbackRequest:
        parsedSnapshot?.request
        ?? fallbackStayRequest(entry, manifest.dates),
      ttlMs: detailsTtlMs,
      now: options.now,
    });
    const analyzedReviewCount = asNonNegativeInteger(
      entry.aiReviews?.count,
    );
    const eligibleReviewCount = asNonNegativeInteger(
      entry.aiReviews?.expected,
    );

    return {
      id: entry.id,
      platform: entry.platform,
      name:
        (typeof detailsRecord?.title === 'string' && detailsRecord.title)
        || (typeof detailsRecord?.name === 'string' && detailsRecord.name)
        || entry.id,
      url: entry.url,
      triage,
      availability: {
        status: staySnapshot.availability.status,
        freshness: staySnapshot.freshness.availability,
        eligibility: staySnapshot.bookingEligibility.status,
        reasonCode: staySnapshot.bookingEligibility.reasonCode,
        reason: staySnapshot.bookingEligibility.reason,
        capturedAt: staySnapshot.availability.capturedAt,
        availableRange: staySnapshot.availability.availableRange ?? null,
      },
      affordability: getAffordability(triage),
      reviewSample: {
        totalScrapedReviewCount:
          asNonNegativeInteger(entry.reviews?.count),
        eligibleReviewCount,
        analyzedReviewCount,
        capped:
          analyzedReviewCount != null && eligibleReviewCount != null
            ? analyzedReviewCount < eligibleReviewCount
            : null,
        source:
          analyzedReviewCount != null || eligibleReviewCount != null
            ? 'batch_manifest'
            : 'unknown',
      },
    };
  });

  return buildPrioritiesMatrix(rows, {
    generatedAt: options.generatedAt,
  });
}

export function generatePrioritiesMatrixJson(
  options: PrioritiesMatrixReportOptions,
): string {
  const matrix = buildPrioritiesMatrixFromArtifacts(options);
  const outputDir = path.resolve(options.outputDir);
  const outputFile = options.outputFile
    ? path.resolve(options.outputFile)
    : path.join(outputDir, 'priorities-matrix.json');
  fs.writeFileSync(outputFile, JSON.stringify(matrix, null, 2), 'utf8');
  return outputFile;
}
