import {
  cleanupReviewJobArtifacts,
  formatArtifactBytes,
  resolveReviewJobArtifactPolicy,
} from '../src/lib/reviewJobArtifacts.js';

interface CliOptions {
  apply: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { apply: false };

  for (const argument of args) {
    if (argument === '--apply') {
      options.apply = true;
    } else if (argument === '--help' || argument === '-h') {
      console.log(
        'Usage: npm run cleanup:artifacts -- [--apply]\n'
        + 'Dry-run is the default. Pass --apply to remove expired review-job runs.',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const policy = resolveReviewJobArtifactPolicy();
  const report = cleanupReviewJobArtifacts({
    policy,
    apply: options.apply,
  });

  console.log(
    `${options.apply ? 'APPLY' : 'DRY RUN'}: root=${policy.rootDir}; `
    + `retention=${policy.retentionDays === 0 ? 'indefinite' : `${policy.retentionDays} day(s)`}`,
  );

  for (const entry of report.entries) {
    const action = entry.protected
      ? 'protected'
      : options.apply
        ? 'removed'
        : 'would remove';
    console.log(
      `${action} ${entry.relativeRunDir}: ${formatArtifactBytes(entry.sizeBytes)}; `
      + `last_modified=${entry.lastModifiedAt.toISOString()}`,
    );
  }

  for (const error of report.errors) {
    console.warn(`cleanup error ${error.path}: ${error.message}`);
  }

  console.log(
    `Summary: scanned=${report.scannedRunDirs}, eligible=${report.eligibleRunDirs}, `
    + `removed=${report.removedRunDirs}, `
    + `eligible_bytes=${report.bytesEligible} (${formatArtifactBytes(report.bytesEligible)}), `
    + `freed_bytes=${report.bytesFreed} (${formatArtifactBytes(report.bytesFreed)}), `
    + `protected=${report.protectedRunDirs}, errors=${report.errors.length}`,
  );

  if (!options.apply && report.eligibleRunDirs > 0) {
    console.log('Dry run only; rerun with --apply to remove these directories.');
  }
  if (report.errors.length > 0) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
