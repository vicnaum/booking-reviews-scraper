import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  Prisma,
  type ReviewJobListing,
  type ReviewJobListingAnalysis,
} from '@prisma/client';
import { extractHotelInfo } from '../../../src/booking/scraper.js';
import { parseAirbnbUrl } from '../../../src/airbnb/listing.js';
import { prisma } from './prisma.js';
import { buildReviewJobEventData } from './reviewJobs.js';
import { summarizeAnalysisStatus } from './review-job-analysis.js';
import {
  getReviewJobAnalyzeConfigPath,
  getReviewJobArtifactRoot,
  getReviewJobManifestPath,
  getReviewJobReportPath,
  getReviewJobUrlsFilePath,
} from './reviewJobArtifacts.js';

type AnalysisPhaseKey =
  | 'details'
  | 'reviews'
  | 'photos'
  | 'aiReviews'
  | 'aiPhotos'
  | 'triage';

type PersistedPhaseStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'partial';

type ManifestPhaseStatus =
  | 'fetched'
  | 'skipped'
  | 'failed'
  | 'partial'
  | 'not_requested';

interface ManifestPhase {
  status: ManifestPhaseStatus;
  file?: string;
  dir?: string;
  error?: string;
  reason?: string;
  count?: number;
  expected?: number;
  model?: string;
  cost?: number;
}

interface ManifestEntry {
  platform: 'airbnb' | 'booking';
  id: string;
  url: string;
  details: ManifestPhase;
  reviews: ManifestPhase;
  photos: ManifestPhase;
  aiReviews: ManifestPhase;
  aiPhotos: ManifestPhase;
  triage: ManifestPhase;
}

interface BatchManifest {
  version: number;
  createdAt: string;
  updatedAt: string;
  dates: {
    checkIn?: string;
    checkOut?: string;
    adults?: number;
  };
  listings: Record<string, ManifestEntry>;
}

interface ReviewAnalysisConfig {
  reviewJobId: string;
  urlsFile: string;
  outputDir: string;
  reportPath: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  aiModel?: string;
  aiPriorities?: string;
  downloadPhotosAll?: boolean;
}

type ReviewJobListingWithAnalysis = ReviewJobListing & {
  analysis: ReviewJobListingAnalysis | null;
};

interface ChildLogState {
  currentPhase: string;
  progress: number;
  reportPath: string | null;
  lastError: string | null;
}

const ANALYSIS_PHASE_ORDER: AnalysisPhaseKey[] = [
  'details',
  'reviews',
  'photos',
  'aiReviews',
  'aiPhotos',
  'triage',
];

async function appendReviewJobEvent(
  reviewJobId: string,
  input: Parameters<typeof buildReviewJobEventData>[1],
) {
  await prisma.reviewJobEvent.create({
    data: buildReviewJobEventData(reviewJobId, input),
  });
}

async function ensureReviewJobAnalysisRows(reviewJobId: string) {
  const listings = await prisma.reviewJobListing.findMany({
    where: { jobId: reviewJobId },
    select: { id: true },
  });

  if (listings.length === 0) {
    return;
  }

  const existing = await prisma.reviewJobListingAnalysis.findMany({
    where: {
      jobListingId: {
        in: listings.map((listing) => listing.id),
      },
    },
    select: { jobListingId: true },
  });

  const existingIds = new Set(existing.map((row) => row.jobListingId));
  const missing = listings.filter((listing) => !existingIds.has(listing.id));
  if (missing.length === 0) {
    return;
  }

  await prisma.reviewJobListingAnalysis.createMany({
    data: missing.map((listing) => ({
      jobListingId: listing.id,
    })),
    skipDuplicates: true,
  });
}

function getAnalysisTargets(
  listings: ReviewJobListingWithAnalysis[],
): ReviewJobListingWithAnalysis[] {
  const selected = listings.filter((listing) => listing.selected);
  return selected.length > 0 ? selected : listings;
}

function getListingLookupKey(listing: {
  platform: 'airbnb' | 'booking';
  listingId: string;
  url: string;
}): string {
  if (listing.platform === 'airbnb') {
    try {
      return `airbnb:${parseAirbnbUrl(listing.url).roomId}`;
    } catch {
      return `airbnb:${listing.listingId}`;
    }
  }

  const info = extractHotelInfo(listing.url);
  if (info) {
    return `booking:${info.country_code}/${info.hotel_name}`;
  }
  return `booking:${listing.listingId}`;
}

function getManifestLookupKey(entry: ManifestEntry): string {
  if (entry.platform === 'airbnb') {
    try {
      return `airbnb:${parseAirbnbUrl(entry.url).roomId}`;
    } catch {
      return `airbnb:${entry.id}`;
    }
  }

  const info = extractHotelInfo(entry.url);
  if (info) {
    return `booking:${info.country_code}/${info.hotel_name}`;
  }
  return `booking:${entry.id}`;
}

function mapManifestStatus(status: ManifestPhaseStatus): PersistedPhaseStatus {
  switch (status) {
    case 'fetched':
      return 'completed';
    case 'skipped':
      return 'skipped';
    case 'failed':
      return 'failed';
    case 'partial':
      return 'partial';
    case 'not_requested':
      return 'pending';
  }
}

function deriveListingAnalysisStatus(
  entry: ManifestEntry,
): 'completed' | 'partial' | 'failed' {
  const statuses = ANALYSIS_PHASE_ORDER.map((phase) =>
    mapManifestStatus(entry[phase].status),
  );
  const failedCount = statuses.filter((status) => status === 'failed').length;
  const partialCount = statuses.filter((status) => status === 'partial').length;
  const completedCount = statuses.filter((status) => status === 'completed').length;

  if (failedCount > 0 && completedCount === 0 && partialCount === 0) {
    return 'failed';
  }

  if (failedCount > 0 || partialCount > 0) {
    return 'partial';
  }

  return 'completed';
}

function deriveListingCurrentPhase(entry: ManifestEntry): string {
  for (const phase of [...ANALYSIS_PHASE_ORDER].reverse()) {
    if (entry[phase].status !== 'not_requested') {
      return phase;
    }
  }

  return 'pending';
}

function deriveListingError(entry: ManifestEntry): string | null {
  for (const phase of ANALYSIS_PHASE_ORDER) {
    if (entry[phase].status === 'failed') {
      return entry[phase].error || entry[phase].reason || `${phase} failed`;
    }
  }

  for (const phase of ANALYSIS_PHASE_ORDER) {
    if (entry[phase].status === 'partial') {
      return entry[phase].reason || entry[phase].error || `${phase} partial`;
    }
  }

  return null;
}

function readJsonForPrisma(filePath: string | null | undefined): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  if (!filePath || !fs.existsSync(filePath)) {
    return Prisma.DbNull;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Prisma.InputJsonValue;
}

function parseLogLine(
  line: string,
  stream: 'stdout' | 'stderr',
): {
  phase: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  currentPhase?: string;
  progress?: number;
  reportPath?: string | null;
} | null {
  const message = line.trim();
  if (!message) {
    return null;
  }

  if (message.startsWith('__REVIEW_JOB_ANALYSIS_START__')) {
    return {
      phase: 'analysis',
      level: 'info',
      message: 'Started CLI batch analysis runner',
      currentPhase: 'details',
      progress: 0.02,
    };
  }

  if (message.startsWith('__REVIEW_JOB_REPORT__ ')) {
    const reportPath = message.replace('__REVIEW_JOB_REPORT__ ', '').trim();
    return {
      phase: 'report',
      level: 'info',
      message: 'Generated report artifact',
      currentPhase: 'report',
      progress: 0.98,
      reportPath,
    };
  }

  if (message.startsWith('__REVIEW_JOB_ANALYSIS_DONE__')) {
    return {
      phase: 'analysis',
      level: 'info',
      message: 'CLI batch analysis runner finished',
      currentPhase: 'summary',
      progress: 0.99,
    };
  }

  if (message.startsWith('__REVIEW_JOB_ANALYSIS_ERROR__ ')) {
    return {
      phase: 'analysis',
      level: 'error',
      message: message.replace('__REVIEW_JOB_ANALYSIS_ERROR__ ', '').trim(),
    };
  }

  if (message.startsWith('Batch:') || message.startsWith('Dates:') || message.startsWith('Phases:')) {
    return {
      phase: 'analysis',
      level: 'info',
      message,
      currentPhase: 'details',
      progress: 0.03,
    };
  }

  if (message.startsWith('AI review analysis')) {
    return {
      phase: 'aiReviews',
      level: 'info',
      message,
      currentPhase: 'aiReviews',
      progress: 0.55,
    };
  }

  if (message.startsWith('AI photo analysis')) {
    return {
      phase: 'aiPhotos',
      level: 'info',
      message,
      currentPhase: 'aiPhotos',
      progress: 0.72,
    };
  }

  if (message.startsWith('AI triage')) {
    return {
      phase: 'triage',
      level: 'info',
      message,
      currentPhase: 'triage',
      progress: 0.87,
    };
  }

  if (message.startsWith('Summary:')) {
    return {
      phase: 'summary',
      level: 'info',
      message,
      currentPhase: 'summary',
      progress: 0.95,
    };
  }

  if (message.includes('ai-reviews')) {
    return {
      phase: 'aiReviews',
      level:
        stream === 'stderr' || message.includes('✗') ? 'error' : message.includes('Warning')
          ? 'warning'
          : 'info',
      message,
    };
  }

  if (message.includes('ai-photos')) {
    return {
      phase: 'aiPhotos',
      level:
        stream === 'stderr' || message.includes('✗') ? 'error' : message.includes('Warning')
          ? 'warning'
          : 'info',
      message,
    };
  }

  if (message.includes('triage')) {
    return {
      phase: 'triage',
      level:
        stream === 'stderr' || message.includes('✗') ? 'error' : message.includes('Warning')
          ? 'warning'
          : 'info',
      message,
    };
  }

  return {
    phase: 'details',
    level:
      stream === 'stderr' || message.includes('Error:') || message.includes('✗')
        ? 'error'
        : message.includes('Warning')
          ? 'warning'
          : 'info',
    message,
  };
}

async function updateJobAnalysisState(
  reviewJobId: string,
  state: ChildLogState,
  update: { currentPhase?: string; progress?: number; reportPath?: string | null },
) {
  const nextPhase = update.currentPhase ?? state.currentPhase;
  const nextProgress = Math.max(state.progress, update.progress ?? state.progress);
  const nextReportPath = update.reportPath ?? state.reportPath;

  if (
    nextPhase === state.currentPhase &&
    nextProgress === state.progress &&
    nextReportPath === state.reportPath
  ) {
    return;
  }

  state.currentPhase = nextPhase;
  state.progress = nextProgress;
  state.reportPath = nextReportPath;

  await prisma.reviewJob.update({
    where: { id: reviewJobId },
    data: {
      status: 'running',
      currentPhase: 'analysis',
      analysisStatus: 'running',
      analysisCurrentPhase: nextPhase,
      analysisProgress: nextProgress,
      ...(nextReportPath ? { reportPath: nextReportPath } : {}),
    },
  });
}

async function runBatchChild(
  reviewJobId: string,
  configPath: string,
): Promise<{ reportPath: string | null; lastError: string | null }> {
  const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
  const scriptPath = path.resolve(process.cwd(), 'src/lib/run-review-analysis.ts');
  const state: ChildLogState = {
    currentPhase: 'queued',
    progress: 0,
    reportPath: null,
    lastError: null,
  };

  const child = spawn(tsxBin, [scriptPath, configPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const handleStream = async (
    stream: NodeJS.ReadableStream | null,
    kind: 'stdout' | 'stderr',
  ) => {
    if (!stream) {
      return;
    }

    const reader = createInterface({ input: stream });
    for await (const rawLine of reader) {
      const parsed = parseLogLine(rawLine, kind);
      if (!parsed) {
        continue;
      }

      if (parsed.level === 'error') {
        state.lastError = parsed.message;
      }

      await appendReviewJobEvent(reviewJobId, {
        phase: parsed.phase,
        level: parsed.level,
        message: parsed.message,
        payload: kind === 'stderr' ? ({ stream: kind } as Prisma.InputJsonValue) : undefined,
      });

      await updateJobAnalysisState(reviewJobId, state, {
        currentPhase: parsed.currentPhase,
        progress: parsed.progress,
        reportPath: parsed.reportPath,
      });
    }
  };

  const stdoutPromise = handleStream(child.stdout, 'stdout');
  const stderrPromise = handleStream(child.stderr, 'stderr');

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 0));
  });

  await Promise.all([stdoutPromise, stderrPromise]);

  if (exitCode !== 0) {
    throw new Error(state.lastError || `Batch analysis exited with code ${exitCode}`);
  }

  return { reportPath: state.reportPath, lastError: state.lastError };
}

async function syncBatchArtifactsToDatabase(
  reviewJobId: string,
  artifactRoot: string,
  listings: ReviewJobListingWithAnalysis[],
) {
  const manifestPath = getReviewJobManifestPath(reviewJobId);
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf-8'),
  ) as BatchManifest;

  const listingByKey = new Map(
    listings.map((listing) => [getListingLookupKey(listing), listing]),
  );

  const matchedListingIds = new Set<string>();
  const completedAt = new Date();
  const updatedStatuses: Array<{ status: 'completed' | 'partial' | 'failed' }> = [];

  for (const entry of Object.values(manifest.listings)) {
    const listing = listingByKey.get(getManifestLookupKey(entry));
    if (!listing) {
      continue;
    }

    matchedListingIds.add(listing.id);

    const summaryStatus = deriveListingAnalysisStatus(entry);
    updatedStatuses.push({ status: summaryStatus });

    await prisma.reviewJobListingAnalysis.update({
      where: { jobListingId: listing.id },
      data: {
        status: summaryStatus,
        currentPhase: deriveListingCurrentPhase(entry),
        errorMessage: deriveListingError(entry),
        detailsStatus: mapManifestStatus(entry.details.status),
        reviewsStatus: mapManifestStatus(entry.reviews.status),
        photosStatus: mapManifestStatus(entry.photos.status),
        aiReviewsStatus: mapManifestStatus(entry.aiReviews.status),
        aiPhotosStatus: mapManifestStatus(entry.aiPhotos.status),
        triageStatus: mapManifestStatus(entry.triage.status),
        details: readJsonForPrisma(
          entry.details.file ? path.join(artifactRoot, entry.details.file) : null,
        ),
        aiReviews: readJsonForPrisma(
          entry.aiReviews.file ? path.join(artifactRoot, entry.aiReviews.file) : null,
        ),
        aiPhotos: readJsonForPrisma(
          entry.aiPhotos.file ? path.join(artifactRoot, entry.aiPhotos.file) : null,
        ),
        triage: readJsonForPrisma(
          entry.triage.file ? path.join(artifactRoot, entry.triage.file) : null,
        ),
        reviewCount: entry.reviews.count ?? null,
        photoCount: entry.photos.count ?? null,
        completedAt,
      },
    });
  }

  const missingListings = listings.filter((listing) => !matchedListingIds.has(listing.id));
  for (const listing of missingListings) {
    updatedStatuses.push({ status: 'failed' });
    await prisma.reviewJobListingAnalysis.update({
      where: { jobListingId: listing.id },
      data: {
        status: 'failed',
        currentPhase: 'manifest',
        errorMessage: 'No batch manifest entry matched this listing',
        completedAt,
      },
    });
  }

  return updatedStatuses;
}

export async function runReviewJobBatchAnalysis(reviewJobId: string) {
  await ensureReviewJobAnalysisRows(reviewJobId);

  const jobRecord = await prisma.reviewJob.findUnique({
    where: { id: reviewJobId },
    include: {
      listings: {
        where: { hidden: false },
        orderBy: { createdAt: 'asc' },
        include: {
          analysis: true,
        },
      },
    },
  });

  if (!jobRecord) {
    throw new Error(`Review job ${reviewJobId} not found`);
  }

  const targetListings = getAnalysisTargets(jobRecord.listings);
  if (targetListings.length === 0) {
    throw new Error(`Review job ${reviewJobId} has no listings to analyze`);
  }

  const artifactRoot = getReviewJobArtifactRoot(reviewJobId);
  const urlsFile = getReviewJobUrlsFilePath(reviewJobId);
  const configPath = getReviewJobAnalyzeConfigPath(reviewJobId);
  const reportPath = getReviewJobReportPath(reviewJobId);
  const startedAt = new Date();
  const priorities = jobRecord.prompt?.trim() || undefined;

  fs.rmSync(artifactRoot, { recursive: true, force: true });
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(
    urlsFile,
    `${targetListings.map((listing) => listing.url).join('\n')}\n`,
    'utf-8',
  );

  const config: ReviewAnalysisConfig = {
    reviewJobId,
    urlsFile,
    outputDir: artifactRoot,
    reportPath,
    checkIn: jobRecord.checkin ?? undefined,
    checkOut: jobRecord.checkout ?? undefined,
    adults: jobRecord.adults,
    aiModel: process.env.LLM_MODEL || 'gemini-3-flash-preview:high',
    aiPriorities: priorities,
    downloadPhotosAll: false,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  await prisma.$transaction(async (tx) => {
    await tx.reviewJob.update({
      where: { id: reviewJobId },
      data: {
        status: 'running',
        currentPhase: 'analysis',
        analysisStatus: 'running',
        analysisCurrentPhase: 'queued',
        analysisProgress: 0,
        analysisErrorMessage: null,
        analysisStartedAt: startedAt,
        analysisCompletedAt: null,
        analysisDurationMs: null,
        artifactRoot,
        reportPath: null,
      },
    });
    await tx.reviewJobListingAnalysis.updateMany({
      where: {
        jobListingId: {
          in: targetListings.map((listing) => listing.id),
        },
      },
      data: {
        status: 'pending',
        currentPhase: 'queued',
        errorMessage: null,
        startedAt,
        completedAt: null,
        durationMs: null,
        detailsStatus: 'pending',
        reviewsStatus: 'pending',
        photosStatus: 'pending',
        aiReviewsStatus: 'pending',
        aiPhotosStatus: 'pending',
        triageStatus: 'pending',
        details: Prisma.DbNull,
        aiReviews: Prisma.DbNull,
        aiPhotos: Prisma.DbNull,
        triage: Prisma.DbNull,
        reviewCount: null,
        photoCount: null,
      },
    });
  });

  await appendReviewJobEvent(reviewJobId, {
    phase: 'analysis',
    level: 'info',
    message: `Queued CLI-parity analysis for ${targetListings.length} listings`,
    payload: {
      listingCount: targetListings.length,
      artifactRoot,
    },
  });

  try {
    const childResult = await runBatchChild(reviewJobId, configPath);
    const syncedStatuses = await syncBatchArtifactsToDatabase(
      reviewJobId,
      artifactRoot,
      targetListings,
    );
    const overallStatus =
      syncedStatuses.length > 0 ? summarizeAnalysisStatus(syncedStatuses) : 'failed';
    const analysisCompletedAt = new Date();
    const finalReportPath =
      childResult.reportPath && fs.existsSync(childResult.reportPath)
        ? childResult.reportPath
        : fs.existsSync(reportPath)
          ? reportPath
          : null;

    await prisma.$transaction(async (tx) => {
      await tx.reviewJob.update({
        where: { id: reviewJobId },
        data: {
          status: 'completed',
          currentPhase: 'results-ready',
          analysisStatus: overallStatus,
          analysisCurrentPhase: 'completed',
          analysisProgress: 1,
          analysisErrorMessage: null,
          analysisCompletedAt,
          analysisDurationMs: analysisCompletedAt.getTime() - startedAt.getTime(),
          reportPath: finalReportPath,
        },
      });
      await tx.reviewJobEvent.create({
        data: buildReviewJobEventData(reviewJobId, {
          phase: 'analysis',
          level: overallStatus === 'completed' ? 'info' : 'warning',
          message: 'CLI-parity analysis completed',
          payload: {
            status: overallStatus,
            listingCount: targetListings.length,
            reportReady: !!finalReportPath,
          },
        }),
      });
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Review job analysis failed';
    const syncedStatuses = await syncBatchArtifactsToDatabase(
      reviewJobId,
      artifactRoot,
      targetListings,
    ).catch(() => []);
    const derivedStatus =
      syncedStatuses.length > 0 ? summarizeAnalysisStatus(syncedStatuses) : 'failed';
    const analysisCompletedAt = new Date();
    const finalReportPath = fs.existsSync(reportPath) ? reportPath : null;

    await prisma.$transaction(async (tx) => {
      await tx.reviewJob.update({
        where: { id: reviewJobId },
        data: {
          status: 'failed',
          currentPhase: 'analysis',
          analysisStatus: derivedStatus === 'completed' ? 'partial' : derivedStatus,
          analysisCurrentPhase: 'failed',
          analysisErrorMessage: message,
          analysisCompletedAt,
          analysisDurationMs: analysisCompletedAt.getTime() - startedAt.getTime(),
          reportPath: finalReportPath,
        },
      });
      await tx.reviewJobEvent.create({
        data: buildReviewJobEventData(reviewJobId, {
          phase: 'analysis',
          level: 'error',
          message,
        }),
      });
    });

    throw error;
  }
}
