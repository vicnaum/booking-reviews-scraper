import { ZipArchive } from 'archiver';
import { PassThrough, type Readable } from 'node:stream';
import { listReviewJobArtifactFiles } from './reviewJobArtifacts.js';

export interface ReviewJobArtifactArchive {
  stream: Readable;
  fileCount: number;
  uncompressedBytes: number;
}

export function buildReviewJobArtifactArchiveFilename(reviewJobId: string): string {
  const safeJobId = reviewJobId
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'job';
  return `stayreviewr-${safeJobId}-artifacts.zip`;
}

export function createReviewJobArtifactArchive(
  artifactRoot: string,
): ReviewJobArtifactArchive | null {
  const files = listReviewJobArtifactFiles(artifactRoot);
  if (files.length === 0) {
    return null;
  }

  const output = new PassThrough({ highWaterMark: 64 * 1024 });
  const archive = new ZipArchive({
    zlib: { level: 6 },
  });
  const failStream = (error: Error) => {
    output.destroy(error);
  };

  archive.on('warning', failStream);
  archive.on('error', failStream);
  archive.pipe(output);
  output.on('close', () => {
    if (!archive.readableEnded) {
      archive.abort();
    }
  });

  for (const file of files) {
    archive.file(file.absolutePath, {
      name: file.relativePath,
      date: file.modifiedAt,
    });
  }

  void archive.finalize().catch(failStream);

  return {
    stream: output,
    fileCount: files.length,
    uncompressedBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
  };
}
