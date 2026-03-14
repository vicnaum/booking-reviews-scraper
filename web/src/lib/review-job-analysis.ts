import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Prisma, ReviewJobListing, ReviewJobListingAnalysis } from '@prisma/client';
import type { MapPoint, PhaseStatus, Platform } from '@/types';

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

export interface ReviewJobListingWorkspace {
  rootDir: string;
  listingDir: string;
  listingFile: string;
  reviewsFile: string;
  photosDir: string;
  aiReviewsFile: string;
  aiPhotosFile: string;
  triageFile: string;
}

export function getReviewJobWorkspaceDir(jobId: string): string {
  return path.join(os.tmpdir(), 'stayreviewr-review-jobs', jobId);
}

export function ensureReviewJobWorkspace(jobId: string): string {
  const dir = getReviewJobWorkspaceDir(jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getReviewJobListingWorkspace(
  jobId: string,
  listing: Pick<ReviewJobListing, 'listingId' | 'platform'>,
): ReviewJobListingWorkspace {
  const rootDir = ensureReviewJobWorkspace(jobId);
  const listingDir = path.join(
    rootDir,
    `${listing.platform}_${sanitize(listing.listingId)}`,
  );
  fs.mkdirSync(listingDir, { recursive: true });

  const photosDir = path.join(listingDir, 'photos');
  fs.mkdirSync(photosDir, { recursive: true });

  return {
    rootDir,
    listingDir,
    listingFile: path.join(listingDir, 'listing.json'),
    reviewsFile: path.join(listingDir, 'reviews.json'),
    photosDir,
    aiReviewsFile: path.join(listingDir, 'ai-reviews.json'),
    aiPhotosFile: path.join(listingDir, 'ai-photos.json'),
    triageFile: path.join(listingDir, 'triage.json'),
  };
}

export function writeJsonFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function removeDirIfExists(dirPath: string) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

export function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function getPoiDistanceMeters(
  poi: MapPoint | null,
  coordinates: { lat: number; lng: number } | null,
): number | null {
  if (!poi || !coordinates) {
    return null;
  }

  const lat1 = (poi.lat * Math.PI) / 180;
  const lat2 = (coordinates.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((coordinates.lng - poi.lng) * Math.PI) / 180;
  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * 6371000 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

export function summarizeAnalysisStatus(
  analyses: Array<Pick<ReviewJobListingAnalysis, 'status'>>,
): 'completed' | 'partial' | 'failed' {
  if (analyses.length === 0) {
    return 'completed';
  }

  const failedCount = analyses.filter((item) => item.status === 'failed').length;
  const partialCount = analyses.filter((item) => item.status === 'partial').length;

  if (failedCount === analyses.length) {
    return 'failed';
  }

  if (failedCount > 0 || partialCount > 0) {
    return 'partial';
  }

  return 'completed';
}

export interface AnalysisManifestPhase {
  status: 'fetched' | 'skipped' | 'failed' | 'partial' | 'not_requested';
  file?: string;
  dir?: string;
  error?: string;
  reason?: string;
  count?: number;
  expected?: number;
  model?: string;
  cost?: number;
}

export interface AnalysisManifestEntry {
  platform: Platform;
  id: string;
  url: string;
  details: AnalysisManifestPhase;
  reviews: AnalysisManifestPhase;
  photos: AnalysisManifestPhase;
  aiReviews: AnalysisManifestPhase;
  aiPhotos: AnalysisManifestPhase;
  triage: AnalysisManifestPhase;
}

export interface AnalysisManifest {
  version: number;
  createdAt: string;
  updatedAt: string;
  dates: { checkIn?: string; checkOut?: string; adults?: number };
  listings: Record<string, AnalysisManifestEntry>;
}

export function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

export function toPhaseStatus(
  status: AnalysisManifestPhase['status'],
): PhaseStatus {
  if (status === 'fetched') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'partial') return 'partial';
  if (status === 'skipped') return 'skipped';
  return 'pending';
}

export function summarizeManifestEntryStatus(
  entry: AnalysisManifestEntry,
): PhaseStatus {
  const phaseStatuses = [
    entry.details.status,
    entry.reviews.status,
    entry.photos.status,
    entry.aiReviews.status,
    entry.aiPhotos.status,
    entry.triage.status,
  ];

  if (entry.triage.status === 'fetched') {
    if (phaseStatuses.includes('failed') || phaseStatuses.includes('partial')) {
      return 'partial';
    }
    return 'completed';
  }

  if (phaseStatuses.includes('failed')) {
    return 'failed';
  }

  if (phaseStatuses.includes('partial') || phaseStatuses.includes('skipped')) {
    return 'partial';
  }

  return 'pending';
}

export function getManifestPathFromRoot(rootDir: string): string {
  return path.join(rootDir, 'batch_manifest.json');
}

export function getReportPathFromRoot(rootDir: string): string {
  return path.join(rootDir, 'report.html');
}

export function pruneAnalysisManifestToListings(input: {
  rootDir: string;
  listings: Array<Pick<ReviewJobListing, 'platform' | 'url'>>;
  dates?: { checkIn?: string; checkOut?: string; adults?: number };
}) {
  const manifestPath = getManifestPathFromRoot(input.rootDir);
  const manifest = readJsonFile<AnalysisManifest>(manifestPath);
  if (!manifest) {
    return;
  }

  const allowedKeys = new Set(
    input.listings.map((listing) => getListingMatchKey(listing.platform, listing.url)),
  );

  manifest.listings = Object.fromEntries(
    Object.entries(manifest.listings).filter(([, entry]) =>
      allowedKeys.has(getListingMatchKey(entry.platform, entry.url))),
  );

  if (input.dates) {
    manifest.dates = {
      checkIn: input.dates.checkIn,
      checkOut: input.dates.checkOut,
      adults: input.dates.adults,
    };
  }

  writeJsonFile(manifestPath, manifest);
}

export function getListingMatchKey(
  platform: Platform,
  url: string,
): string {
  try {
    const parsed = new URL(url);
    if (platform === 'airbnb') {
      const roomMatch = parsed.pathname.match(/\/rooms\/(\d+)/i);
      return roomMatch ? `airbnb:${roomMatch[1]}` : `airbnb:${parsed.pathname.toLowerCase()}`;
    }

    const bookingMatch = parsed.pathname.match(
      /\/hotel\/([^/]+)\/([^/.]+)(?:\.[a-z-]+)?\.html/i,
    );
    if (bookingMatch) {
      return `booking:${bookingMatch[1].toLowerCase()}/${bookingMatch[2].toLowerCase()}`;
    }
    return `booking:${parsed.pathname.toLowerCase()}`;
  } catch {
    return `${platform}:${url.toLowerCase()}`;
  }
}

function asCoordinates(
  value: unknown,
): { lat: number; lng: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const point = value as Record<string, unknown>;
  const lat = typeof point.lat === 'number' ? point.lat : null;
  const lng = typeof point.lng === 'number' ? point.lng : null;

  if (lat == null || lng == null) {
    return null;
  }

  return { lat, lng };
}

export interface ListingArtifactPoiFallback {
  platform: Platform;
  url: string;
  lat: number | null;
  lng: number | null;
  poiDistanceMeters?: number | null;
}

export function injectPoiContextIntoListingArtifacts(input: {
  rootDir: string;
  manifest: AnalysisManifest;
  poi: MapPoint | null;
  fallbackListings?: ListingArtifactPoiFallback[];
}) {
  if (!input.poi) {
    return;
  }

  const fallbackByKey = new Map(
    (input.fallbackListings ?? []).map((listing) => [
      getListingMatchKey(listing.platform, listing.url),
      listing,
    ]),
  );

  for (const entry of Object.values(input.manifest.listings)) {
    if (!entry.details.file) {
      continue;
    }

    const listingPath = path.join(input.rootDir, entry.details.file);
    const listingData = readJsonFile<Record<string, unknown>>(listingPath);
    if (!listingData) {
      continue;
    }

    const fallback = fallbackByKey.get(
      getListingMatchKey(entry.platform, entry.url),
    );
    const listingCoordinates = asCoordinates(listingData.coordinates);
    const fallbackCoordinates =
      fallback && fallback.lat != null && fallback.lng != null
        ? { lat: fallback.lat, lng: fallback.lng }
        : null;
    const resolvedCoordinates = listingCoordinates ?? fallbackCoordinates;

    const poiDistanceMeters =
      resolvedCoordinates
        ? getPoiDistanceMeters(input.poi, resolvedCoordinates)
        : fallback?.poiDistanceMeters ?? null;

    const nextListingData: Record<string, unknown> = {
      ...listingData,
      poi: input.poi,
      poiDistanceMeters,
    };

    if (!listingCoordinates && fallbackCoordinates) {
      nextListingData.coordinates = fallbackCoordinates;
    }

    writeJsonFile(listingPath, nextListingData);
  }
}

export function resolveArtifactPath(rootDir: string, relativePath: string): string {
  const resolved = path.resolve(rootDir, relativePath);
  const normalizedRoot = path.resolve(rootDir);

  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error('Artifact path escapes workspace root');
  }

  return resolved;
}
