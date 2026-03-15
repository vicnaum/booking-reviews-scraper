import * as path from 'node:path';

const REVIEW_JOB_DATA_ROOT = path.resolve(process.cwd(), '..', 'data', 'review-jobs');

export function getReviewJobArtifactRoot(reviewJobId: string): string {
  return path.join(REVIEW_JOB_DATA_ROOT, reviewJobId);
}

export function getReviewJobUrlsFilePath(reviewJobId: string): string {
  return path.join(getReviewJobArtifactRoot(reviewJobId), 'urls.txt');
}

export function getReviewJobAnalyzeConfigPath(reviewJobId: string): string {
  return path.join(getReviewJobArtifactRoot(reviewJobId), 'analyze-config.json');
}

export function getReviewJobManifestPath(reviewJobId: string): string {
  return path.join(getReviewJobArtifactRoot(reviewJobId), 'batch_manifest.json');
}

export function getReviewJobReportPath(reviewJobId: string): string {
  return path.join(getReviewJobArtifactRoot(reviewJobId), 'report.html');
}
