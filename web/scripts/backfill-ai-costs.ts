import * as fs from 'node:fs';
import * as path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  buildAiCostBackfillPlan,
  hasZeroAiCosts,
  type AiCostFields,
} from '../src/lib/ai-cost-backfill.js';

interface CliOptions {
  apply: boolean;
  jobId?: string;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { apply: false };

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--apply') {
      options.apply = true;
    } else if (argument === '--job') {
      const jobId = args[index + 1];
      if (!jobId || jobId.startsWith('--')) {
        throw new Error('--job requires a review-job ID');
      }
      options.jobId = jobId;
      index++;
    } else if (argument === '--help' || argument === '-h') {
      console.log(
        'Usage: npm run backfill:ai-costs -- [--apply] [--job <review-job-id>]\n'
        + 'Dry-run is the default. Pass --apply to persist manifest-derived costs.',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function formatCosts(costs: AiCostFields): string {
  return (
    `reviews=$${costs.aiReviewsCostUsd.toFixed(4)}, `
    + `photos=$${costs.aiPhotosCostUsd.toFixed(4)}, `
    + `triage=$${costs.triageCostUsd.toFixed(4)}, `
    + `total=$${costs.totalAiCostUsd.toFixed(4)}`
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  let eligible = 0;
  let applied = 0;
  let skippedExisting = 0;
  let skippedMissingManifest = 0;
  let skippedNoCosts = 0;

  try {
    const jobs = await prisma.reviewJob.findMany({
      where: {
        artifactRoot: { not: null },
        ...(options.jobId ? { id: options.jobId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: {
        listings: {
          include: {
            analysis: {
              select: {
                id: true,
                aiReviewsCostUsd: true,
                aiPhotosCostUsd: true,
                triageCostUsd: true,
                totalAiCostUsd: true,
              },
            },
          },
        },
      },
    });

    console.log(
      `${options.apply ? 'APPLY' : 'DRY RUN'}: scanning ${jobs.length} review job(s)`,
    );

    for (const job of jobs) {
      const currentCosts: AiCostFields = {
        aiReviewsCostUsd: job.aiReviewsCostUsd,
        aiPhotosCostUsd: job.aiPhotosCostUsd,
        triageCostUsd: job.triageCostUsd,
        totalAiCostUsd: job.totalAiCostUsd,
      };
      if (!hasZeroAiCosts(currentCosts)) {
        skippedExisting++;
        console.log(`skip ${job.id}: already has costs (${formatCosts(currentCosts)})`);
        continue;
      }

      const manifestPath = path.join(job.artifactRoot as string, 'batch_manifest.json');
      if (!fs.existsSync(manifestPath)) {
        skippedMissingManifest++;
        console.warn(`skip ${job.id}: manifest missing at ${manifestPath}`);
        continue;
      }

      let plan;
      try {
        plan = buildAiCostBackfillPlan(readJsonFile(manifestPath));
      } catch (error) {
        skippedMissingManifest++;
        console.warn(
          `skip ${job.id}: cannot read manifest (`
          + `${error instanceof Error ? error.message : String(error)})`,
        );
        continue;
      }

      if (hasZeroAiCosts(plan.costs)) {
        skippedNoCosts++;
        console.log(`skip ${job.id}: manifest contains no positive AI costs`);
        continue;
      }

      eligible++;
      const listingByKey = new Map(
        job.listings.map((listing) => [
          `${listing.platform}/${listing.listingId}`,
          listing,
        ]),
      );
      const updates = plan.entries.flatMap((entry) => {
        const listing = listingByKey.get(`${entry.platform}/${entry.listingId}`);
        if (!listing?.analysis) {
          console.warn(
            `  ${job.id}: no persisted analysis for ${entry.manifestKey}; `
            + 'job totals will still include its manifest cost',
          );
          return [];
        }

        const existing = listing.analysis;
        if (!hasZeroAiCosts(existing)) {
          console.warn(
            `  ${job.id}: preserving existing listing costs for ${entry.manifestKey}`,
          );
          return [];
        }

        return [{
          analysisId: existing.id,
          manifestKey: entry.manifestKey,
          costs: entry.costs,
        }];
      });

      console.log(
        `${options.apply ? 'apply' : 'would apply'} ${job.id}: `
        + `${formatCosts(plan.costs)}; ${updates.length}/${plan.entries.length} listing rows`,
      );

      if (!options.apply) {
        continue;
      }

      await prisma.$transaction(async (tx) => {
        for (const update of updates) {
          await tx.reviewJobListingAnalysis.update({
            where: { id: update.analysisId },
            data: update.costs,
          });
        }

        await tx.reviewJob.update({
          where: { id: job.id },
          data: plan.costs,
        });
        await tx.reviewJobEvent.create({
          data: {
            jobId: job.id,
            phase: 'analysis',
            level: 'info',
            message: 'Backfilled historical AI costs from batch manifest',
            payload: {
              source: manifestPath,
              listingRowsUpdated: updates.length,
              manifestEntriesWithCosts: plan.entries.length,
              ...plan.costs,
            } satisfies Prisma.InputJsonObject,
          },
        });
      });
      applied++;
    }

    console.log(
      `Summary: eligible=${eligible}, applied=${applied}, `
      + `existing=${skippedExisting}, missing_or_invalid_manifest=${skippedMissingManifest}, `
      + `no_manifest_costs=${skippedNoCosts}`,
    );
    if (!options.apply && eligible > 0) {
      console.log('Dry run only; rerun with --apply to persist these updates.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
