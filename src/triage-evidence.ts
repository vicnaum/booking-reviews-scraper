import { createHash } from 'node:crypto';
import * as fs from 'node:fs';

export const TRIAGE_EVIDENCE_FINGERPRINT_VERSION = 1;

export const TRIAGE_DETAILS_CORE_FIELDS = [
  'title',
  'rating',
  'reviewCount',
  'subRatings',
  'amenities',
] as const;

export type TriageDetailsCoreField =
  typeof TRIAGE_DETAILS_CORE_FIELDS[number];

export interface TriageDetailsCoreCoverage {
  title: boolean;
  rating: boolean;
  reviewCount: boolean;
  subRatings: boolean;
  amenities: boolean;
  total: number;
}

export interface TriageEvidenceFingerprint {
  version: typeof TRIAGE_EVIDENCE_FINGERPRINT_VERSION;
  hash: string;
  layers: {
    details: true;
    reviews: boolean;
    photos: boolean;
  };
  artifacts: {
    detailsSha256: string;
    reviewsSha256: string | null;
    photosSha256: string | null;
  };
  detailsCoreCoverage: TriageDetailsCoreCoverage;
}

interface EvidenceArtifact {
  content: string;
  data: unknown;
}

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

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isCoverage(value: unknown): value is TriageDetailsCoreCoverage {
  const record = asRecord(value);
  if (!record) return false;
  const coveredFields = TRIAGE_DETAILS_CORE_FIELDS.filter(
    (field) => record[field] === true,
  ).length;
  return (
    TRIAGE_DETAILS_CORE_FIELDS.every(
      (field) => typeof record[field] === 'boolean',
    )
    && typeof record.total === 'number'
    && Number.isInteger(record.total)
    && record.total >= 0
    && record.total <= TRIAGE_DETAILS_CORE_FIELDS.length
    && record.total === coveredFields
  );
}

export function getTriageDetailsCoreCoverage(
  value: unknown,
): TriageDetailsCoreCoverage {
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
    total: TRIAGE_DETAILS_CORE_FIELDS.filter(
      (field) => coverage[field],
    ).length,
  };
}

export function createTriageEvidenceFingerprint(input: {
  details: EvidenceArtifact;
  reviews?: EvidenceArtifact | null;
  photos?: EvidenceArtifact | null;
}): TriageEvidenceFingerprint {
  const payload: Omit<TriageEvidenceFingerprint, 'hash'> = {
    version: TRIAGE_EVIDENCE_FINGERPRINT_VERSION,
    layers: {
      details: true as const,
      reviews: !!input.reviews,
      photos: !!input.photos,
    },
    artifacts: {
      detailsSha256: sha256(input.details.content),
      reviewsSha256:
        input.reviews ? sha256(input.reviews.content) : null,
      photosSha256:
        input.photos ? sha256(input.photos.content) : null,
    },
    detailsCoreCoverage:
      getTriageDetailsCoreCoverage(input.details.data),
  };

  return {
    ...payload,
    hash: sha256(JSON.stringify(payload)),
  };
}

export function parseTriageEvidenceFingerprint(
  value: unknown,
): TriageEvidenceFingerprint | null {
  const record = asRecord(value);
  const layers = asRecord(record?.layers);
  const artifacts = asRecord(record?.artifacts);
  if (
    record?.version !== TRIAGE_EVIDENCE_FINGERPRINT_VERSION
    || !isSha256(record.hash)
    || layers?.details !== true
    || typeof layers.reviews !== 'boolean'
    || typeof layers.photos !== 'boolean'
    || !isSha256(artifacts?.detailsSha256)
    || !(
      artifacts?.reviewsSha256 === null
      || isSha256(artifacts?.reviewsSha256)
    )
    || !(
      artifacts?.photosSha256 === null
      || isSha256(artifacts?.photosSha256)
    )
    || layers.reviews !== (artifacts?.reviewsSha256 != null)
    || layers.photos !== (artifacts?.photosSha256 != null)
    || !isCoverage(record.detailsCoreCoverage)
  ) {
    return null;
  }

  const candidate = record as unknown as TriageEvidenceFingerprint;
  const canonicalPayload: Omit<TriageEvidenceFingerprint, 'hash'> = {
    version: candidate.version,
    layers: {
      details: true,
      reviews: candidate.layers.reviews,
      photos: candidate.layers.photos,
    },
    artifacts: {
      detailsSha256: candidate.artifacts.detailsSha256,
      reviewsSha256: candidate.artifacts.reviewsSha256,
      photosSha256: candidate.artifacts.photosSha256,
    },
    detailsCoreCoverage: {
      title: candidate.detailsCoreCoverage.title,
      rating: candidate.detailsCoreCoverage.rating,
      reviewCount: candidate.detailsCoreCoverage.reviewCount,
      subRatings: candidate.detailsCoreCoverage.subRatings,
      amenities: candidate.detailsCoreCoverage.amenities,
      total: candidate.detailsCoreCoverage.total,
    },
  };
  const expected = createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');
  return candidate.hash === expected ? candidate : null;
}

export function didTriageEvidenceMateriallyImprove(
  before: TriageEvidenceFingerprint,
  after: TriageEvidenceFingerprint,
): boolean {
  return TRIAGE_DETAILS_CORE_FIELDS.some(
    (field) =>
      !before.detailsCoreCoverage[field]
      && after.detailsCoreCoverage[field],
  );
}

function readJsonArtifact(filePath: string): EvidenceArtifact {
  const content = fs.readFileSync(filePath, 'utf8');
  return {
    content,
    data: JSON.parse(content) as unknown,
  };
}

function readOptionalJsonArtifact(
  filePath: string | null | undefined,
): EvidenceArtifact | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const artifact = readJsonArtifact(filePath);
    return artifact.data ? artifact : null;
  } catch {
    return null;
  }
}

export function fingerprintTriageEvidenceFiles(input: {
  detailsFile: string;
  reviewsFile?: string | null;
  photosFile?: string | null;
}): TriageEvidenceFingerprint {
  return createTriageEvidenceFingerprint({
    details: readJsonArtifact(input.detailsFile),
    reviews: readOptionalJsonArtifact(input.reviewsFile),
    photos: readOptionalJsonArtifact(input.photosFile),
  });
}
