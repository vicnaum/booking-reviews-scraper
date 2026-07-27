import * as path from 'node:path';
import {
  Prisma,
  PrismaClient,
  type Platform,
} from '@prisma/client';
import { config as loadDotEnv } from 'dotenv';
import {
  fingerprintDetailsRepairValue,
  readReviewJobDetailsRepairPlan,
  stageReviewJobDetailsRepair,
  validateReviewJobDetailsRepairForApply,
  type DetailsRepairCoverage,
  type DetailsRepairJobInput,
  type DetailsRepairPlatform,
  type DetailsRepairPlan,
} from '../src/lib/review-job-details-repair.js';

for (const envPath of [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
]) {
  loadDotEnv({ path: envPath, override: false, quiet: true });
}

interface CliOptions {
  apply: boolean;
  jobId: string;
  platform: DetailsRepairPlatform;
  stagedRoot?: string;
}

const jobInclude = Prisma.validator<Prisma.ReviewJobInclude>()({
  listings: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { analysis: true },
  },
  duplicatePairs: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
});

type RepairJobRecord = Prisma.ReviewJobGetPayload<{
  include: typeof jobInclude;
}>;

type RepairDbClient = PrismaClient | Prisma.TransactionClient;

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function usage(): string {
  return (
    'Usage:\n'
    + '  npm run repair:job-details -- --job <id> --platform airbnb\n'
    + '  npm run repair:job-details -- --job <id> --platform airbnb '
    + '--apply --staged-root <dry-run-root>\n\n'
    + 'Dry-run is the default. It fetches details into a cloned artifact run, '
    + 'prints per-listing coverage, and does not write the database. '
    + 'Apply revalidates that exact staged run and the unchanged live-job '
    + 'baseline before one atomic database transaction.'
  );
}

function parseArgs(args: string[]): CliOptions {
  let apply = false;
  let jobId = '';
  let platform: DetailsRepairPlatform | null = null;
  let stagedRoot: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--job') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--job requires a review-job ID');
      }
      jobId = value;
      index++;
      continue;
    }
    if (argument === '--platform') {
      const value = args[index + 1];
      if (value !== 'airbnb') {
        throw new Error('--platform currently supports only "airbnb"');
      }
      platform = value;
      index++;
      continue;
    }
    if (argument === '--staged-root') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--staged-root requires a path');
      }
      stagedRoot = value;
      index++;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!jobId) {
    throw new Error('--job is required');
  }
  if (!platform) {
    throw new Error('--platform airbnb is required');
  }
  if (apply && !stagedRoot) {
    throw new Error('--apply requires --staged-root from a completed dry run');
  }
  if (!apply && stagedRoot) {
    throw new Error('--staged-root is accepted only with --apply');
  }

  return {
    apply,
    jobId,
    platform,
    ...(stagedRoot ? { stagedRoot: path.resolve(stagedRoot) } : {}),
  };
}

async function readRepairJob(
  client: RepairDbClient,
  jobId: string,
): Promise<RepairJobRecord | null> {
  return client.reviewJob.findUnique({
    where: { id: jobId },
    include: jobInclude,
  });
}

function toRepairJobInput(job: RepairJobRecord): DetailsRepairJobInput {
  return {
    id: job.id,
    status: job.status,
    currentPhase: job.currentPhase,
    analysisStatus: job.analysisStatus,
    analysisCurrentPhase: job.analysisCurrentPhase,
    priceRefreshStatus: job.priceRefreshStatus,
    priceRefreshCurrentPhase: job.priceRefreshCurrentPhase,
    artifactRoot: job.artifactRoot,
    reportPath: job.reportPath,
    checkin: job.checkin,
    checkout: job.checkout,
    adults: job.adults,
    sourceStateFingerprint: fingerprintDetailsRepairValue(job),
    listings: job.listings.map((listing) => {
      if (!listing.analysis) {
        throw new Error(
          `Review job listing ${listing.id} has no persisted analysis row`,
        );
      }
      return {
        rowId: listing.id,
        analysisId: listing.analysis.id,
        listingId: listing.listingId,
        platform: listing.platform as Platform,
        url: listing.url,
        detailsStatus: listing.analysis.detailsStatus,
        details: listing.analysis.details,
        triageEvidenceFingerprint:
          listing.analysis.triageEvidenceFingerprint,
        regradeSuggested: listing.analysis.regradeSuggested,
        hasTriageVerdict: listing.analysis.triage != null,
      };
    }),
  };
}

function flag(value: boolean): string {
  return value ? '1' : '0';
}

function coverageCells(coverage: DetailsRepairCoverage): string {
  return [
    flag(coverage.title),
    flag(coverage.rating),
    flag(coverage.reviewCount),
    flag(coverage.subRatings),
    flag(coverage.amenities),
  ].join('/');
}

function printPlan(plan: DetailsRepairPlan): void {
  console.log(
    'listing_id\toutcome\tadded_fields\t'
    + 'before(title/rating/reviews/subratings/amenities)\t'
    + 'after(title/rating/reviews/subratings/amenities)\tmessage',
  );
  for (const listing of plan.listings) {
    console.log([
      listing.listingId,
      listing.outcome,
      listing.addedFields.join(',') || '-',
      coverageCells(listing.beforeCoverage),
      coverageCells(listing.afterCoverage),
      listing.message ?? '-',
    ].join('\t'));
  }
  console.log(
    `Summary: listings=${plan.listings.length}; `
    + `repaired=${plan.listings.filter(
      (listing) => listing.outcome === 'repaired',
    ).length}; `
    + `preserved=${plan.listings.filter(
      (listing) => listing.outcome === 'preserved',
    ).length}; `
    + `added_core_fields=${plan.totalAddedFields}`,
  );
}

function postApplyInvariant(
  job: RepairJobRecord,
  repairedRowIds: Set<string>,
): string {
  const clone = JSON.parse(JSON.stringify(job)) as {
    artifactRoot?: unknown;
    reportPath?: unknown;
    listings?: Array<{
      id: string;
      analysis?: {
        details?: unknown;
        detailsStatus?: unknown;
        updatedAt?: unknown;
        [key: string]: unknown;
      } | null;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  delete clone.artifactRoot;
  delete clone.reportPath;
  delete clone.regradeSuggested;
  for (const listing of clone.listings ?? []) {
    if (!repairedRowIds.has(listing.id) || !listing.analysis) continue;
    delete listing.analysis.details;
    delete listing.analysis.detailsStatus;
    delete listing.analysis.triageEvidenceFingerprint;
    delete listing.analysis.regradeSuggested;
    delete listing.analysis.updatedAt;
  }
  return fingerprintDetailsRepairValue(clone);
}

async function dryRun(
  prisma: PrismaClient,
  options: CliOptions,
): Promise<void> {
  const job = await readRepairJob(prisma, options.jobId);
  if (!job) {
    throw new Error(`Review job ${options.jobId} not found`);
  }
  const plan = await stageReviewJobDetailsRepair({
    job: toRepairJobInput(job),
    platform: options.platform,
  });

  console.log(
    `DRY RUN complete: source=${plan.sourceArtifactRoot}`,
  );
  console.log(`Staged root retained at: ${plan.stagedArtifactRoot}`);
  printPlan(plan);
  console.log(
    '\nNo database rows were changed. After review and explicit approval, apply '
    + 'this exact staged run with:\n'
    + `npm --prefix web run repair:job-details -- --job ${plan.jobId} `
    + `--platform ${plan.platform} --apply --staged-root `
    + `${JSON.stringify(plan.stagedArtifactRoot)}`,
  );
}

async function applyPlan(
  prisma: PrismaClient,
  options: CliOptions,
): Promise<void> {
  const plan = readReviewJobDetailsRepairPlan(
    options.stagedRoot as string,
  );
  if (plan.jobId !== options.jobId || plan.platform !== options.platform) {
    throw new Error('CLI job/platform do not match the staged repair plan');
  }

  const preflightJob = await readRepairJob(prisma, options.jobId);
  if (!preflightJob) {
    throw new Error(`Review job ${options.jobId} not found`);
  }
  const preflightUpdates = validateReviewJobDetailsRepairForApply({
    plan,
    job: toRepairJobInput(preflightJob),
  });
  console.log(
    `APPLY preflight: ${preflightUpdates.length} listing update(s); `
    + `source=${plan.sourceArtifactRoot}; staged=${plan.stagedArtifactRoot}`,
  );

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`
        SELECT "id"
        FROM "ReviewJob"
        WHERE "id" = ${options.jobId}
        FOR UPDATE
      `,
    );
    await tx.$queryRaw(
      Prisma.sql`
        SELECT "id"
        FROM "ReviewJobListing"
        WHERE "jobId" = ${options.jobId}
        FOR UPDATE
      `,
    );
    await tx.$queryRaw(
      Prisma.sql`
        SELECT analysis."id"
        FROM "ReviewJobListingAnalysis" analysis
        INNER JOIN "ReviewJobListing" listing
          ON listing."id" = analysis."jobListingId"
        WHERE listing."jobId" = ${options.jobId}
        FOR UPDATE OF analysis
      `,
    );
    await tx.$queryRaw(
      Prisma.sql`
        SELECT "id"
        FROM "ReviewJobDuplicatePair"
        WHERE "jobId" = ${options.jobId}
        FOR SHARE
      `,
    );

    const lockedJob = await readRepairJob(tx, options.jobId);
    if (!lockedJob) {
      throw new Error(`Review job ${options.jobId} disappeared during apply`);
    }
    const updates = validateReviewJobDetailsRepairForApply({
      plan,
      job: toRepairJobInput(lockedJob),
    });

    for (const update of updates) {
      await tx.reviewJobListingAnalysis.update({
        where: { id: update.analysisId },
        data: {
          details:
            update.details as unknown as Prisma.InputJsonValue,
          detailsStatus: update.detailsStatus,
          triageEvidenceFingerprint:
            update.triageEvidenceFingerprint == null
              ? Prisma.DbNull
              : toInputJsonValue(
                  update.triageEvidenceFingerprint,
                ),
          regradeSuggested: update.regradeSuggested,
        },
      });
    }
    const regradeSuggestedListingCount =
      await tx.reviewJobListingAnalysis.count({
        where: {
          jobListing: {
            jobId: options.jobId,
            hidden: false,
          },
          regradeSuggested: true,
        },
      });
    await tx.reviewJob.update({
      where: { id: options.jobId },
      data: {
        artifactRoot: plan.stagedArtifactRoot,
        reportPath: plan.stagedReportPath,
        regradeSuggested: regradeSuggestedListingCount > 0,
      },
    });
    const suggestedUpdates = updates.filter(
      (update) => update.regradeSuggested,
    );
    if (suggestedUpdates.length > 0) {
      await tx.reviewJobEvent.create({
        data: {
          jobId: options.jobId,
          phase: 'triage',
          level: 'warning',
          message:
            'Listing evidence improved; saved verdicts should be regraded.',
          payload: {
            reason: 'evidence_improved',
            listingCount: suggestedUpdates.length,
            listingIds: suggestedUpdates.map(
              (update) => update.listingId,
            ),
          },
        },
      });
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 30_000,
  });

  const appliedJob = await readRepairJob(prisma, options.jobId);
  if (
    !appliedJob
    || path.resolve(appliedJob.artifactRoot ?? '')
      !== plan.stagedArtifactRoot
    || appliedJob.reportPath !== plan.stagedReportPath
  ) {
    throw new Error(
      'Apply transaction committed but the canonical artifact pointers '
      + 'did not verify',
    );
  }
  const repairedRowIds = new Set(
    plan.listings
      .filter((listing) => listing.outcome === 'repaired')
      .map((listing) => listing.rowId),
  );
  if (
    postApplyInvariant(appliedJob, repairedRowIds)
    !== postApplyInvariant(preflightJob, repairedRowIds)
  ) {
    throw new Error(
      'Apply committed but a field outside the approved details/pointer '
      + 'scope changed',
    );
  }
  const appliedListings = new Map(
    appliedJob.listings.map((listing) => [listing.id, listing]),
  );
  for (const planned of plan.listings) {
    if (planned.outcome !== 'repaired') continue;
    const applied = appliedListings.get(planned.rowId)?.analysis;
    const expectedStatus =
      planned.afterDetailsStatus === 'partial' ? 'partial' : 'completed';
    if (
      !applied
      || fingerprintDetailsRepairValue(applied.details)
        !== planned.afterDetailsFingerprint
      || applied.detailsStatus !== expectedStatus
    ) {
      throw new Error(
        `Apply committed but repaired details did not verify: `
        + `${planned.listingId}`,
      );
    }
  }

  console.log(
    `APPLY complete: ${preflightUpdates.length} listing detail row(s) updated`,
  );
  printPlan(plan);
  console.log(
    `Original artifact root retained at: ${plan.sourceArtifactRoot}`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    if (options.apply) {
      await applyPlan(prisma, options);
    } else {
      await dryRun(prisma, options);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
