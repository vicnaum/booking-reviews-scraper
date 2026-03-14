import 'dotenv/config';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { bootstrapRuntimeProxyEnv } from '../../../src/config.js';
import type { BatchOptions } from '../../../src/batch.js';
import { runBatch } from '../../../src/batch.js';
import { generateReport } from '../../../src/report.js';

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

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error('Missing review analysis config path');
  }

  const resolvedConfigPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedConfigPath)) {
    throw new Error(`Config file not found: ${resolvedConfigPath}`);
  }

  const config = JSON.parse(
    fs.readFileSync(resolvedConfigPath, 'utf-8'),
  ) as ReviewAnalysisConfig;

  bootstrapRuntimeProxyEnv();

  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  if (!fs.existsSync(config.urlsFile)) {
    throw new Error(`URLs file not found: ${config.urlsFile}`);
  }

  console.log(`__REVIEW_JOB_ANALYSIS_START__ ${config.reviewJobId}`);

  const batchOptions: BatchOptions = {
    fetchDetails: true,
    fetchReviews: true,
    fetchPhotos: true,
    aiReviews: true,
    aiPhotos: true,
    triage: true,
    aiModel: config.aiModel,
    aiPriorities: config.aiPriorities,
    aiReviewsExplicit: true,
    aiPhotosExplicit: true,
    triageExplicit: true,
    checkIn: config.checkIn,
    checkOut: config.checkOut,
    adults: config.adults,
    force: false,
    retryFailed: false,
    downloadPhotosAll: !!config.downloadPhotosAll,
    outputDir: config.outputDir,
    print: false,
  };

  await runBatch([config.urlsFile], batchOptions);

  const outFile = await generateReport({
    outputDir: config.outputDir,
    outputFile: config.reportPath,
  });

  console.log(`__REVIEW_JOB_REPORT__ ${outFile}`);
  console.log(`__REVIEW_JOB_ANALYSIS_DONE__ ${config.reviewJobId}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`__REVIEW_JOB_ANALYSIS_ERROR__ ${message}`);
  process.exit(1);
});
