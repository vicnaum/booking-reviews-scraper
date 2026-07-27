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
  validateAppliedDetailsRepairForEvidenceReconciliation,
  type DetailsRepairJobInput,
} from '../src/lib/review-job-details-repair.js';

for (const envPath of [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
]) {
  loadDotEnv({ path: envPath, override: false, quiet: true });
}

const jobInclude = Prisma.validator<Prisma.ReviewJobInclude>()({
  listings: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { analysis: true },
  },
});

type JobRecord = Prisma.ReviewJobGetPayload<{
  include: typeof jobInclude;
}>;
type DbClient = PrismaClient | Prisma.TransactionClient;

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseArgs(args: string[]): {
  jobId: string;
  apply: boolean;
} {
  let jobId = '';
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--job') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--job requires a review-job ID');
      }
      jobId = value;
      index++;
      continue;
    }
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      console.log(
        'Usage: npm run reconcile:job-evidence -- --job <id> [--apply]',
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!jobId) throw new Error('--job is required');
  return { jobId, apply };
}

async function readJob(
  client: DbClient,
  jobId: string,
): Promise<JobRecord | null> {
  return client.reviewJob.findUnique({
    where: { id: jobId },
    include: jobInclude,
  });
}

function toJobInput(job: JobRecord): DetailsRepairJobInput {
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
          `Review job listing ${listing.id} has no analysis row`,
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

function getUpdates(job: JobRecord) {
  if (!job.artifactRoot) {
    throw new Error(`Review job ${job.id} has no artifact root`);
  }
  const plan = readReviewJobDetailsRepairPlan(job.artifactRoot);
  return validateAppliedDetailsRepairForEvidenceReconciliation({
    plan,
    job: toJobInput(job),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const job = await readJob(prisma, options.jobId);
    if (!job) throw new Error(`Review job ${options.jobId} not found`);
    const updates = getUpdates(job);
    console.log('listing_id\tevidence_hash\tregrade_suggested');
    for (const update of updates) {
      console.log([
        update.listingId,
        update.triageEvidenceFingerprint.hash,
        '1',
      ].join('\t'));
    }
    console.log(`Summary: affected=${updates.length}`);
    if (!options.apply || updates.length === 0) {
      console.log(
        options.apply
          ? 'No reconciliation changes were needed.'
          : 'Dry run only. Re-run with --apply to persist.',
      );
      return;
    }

    let appliedCount = 0;
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
          SELECT analysis."id"
          FROM "ReviewJobListingAnalysis" analysis
          INNER JOIN "ReviewJobListing" listing
            ON listing."id" = analysis."jobListingId"
          WHERE listing."jobId" = ${options.jobId}
          FOR UPDATE OF analysis
        `,
      );
      const lockedJob = await readJob(tx, options.jobId);
      if (!lockedJob) {
        throw new Error(
          `Review job ${options.jobId} disappeared during apply`,
        );
      }
      const lockedUpdates = getUpdates(lockedJob);
      appliedCount = lockedUpdates.length;
      for (const update of lockedUpdates) {
        await tx.reviewJobListingAnalysis.update({
          where: { id: update.analysisId },
          data: {
            triageEvidenceFingerprint: toInputJsonValue(
              update.triageEvidenceFingerprint,
            ),
            regradeSuggested: true,
          },
        });
      }
      const suggestedCount =
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
        data: { regradeSuggested: suggestedCount > 0 },
      });
      if (lockedUpdates.length > 0) {
        await tx.reviewJobEvent.create({
          data: {
            jobId: options.jobId,
            phase: 'triage',
            level: 'warning',
            message:
              'Listing evidence improved; saved verdicts should be regraded.',
            payload: {
              reason: 'evidence_improved',
              listingCount: lockedUpdates.length,
              listingIds: lockedUpdates.map(
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

    const applied = await readJob(prisma, options.jobId);
    if (!applied || getUpdates(applied).length !== 0) {
      throw new Error(
        'Evidence reconciliation committed but did not verify',
      );
    }
    console.log(
      `Applied evidence staleness to ${appliedCount} listing`
      + `${appliedCount === 1 ? '' : 's'}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
