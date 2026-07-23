import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import {
  buildReviewJobArtifactArchiveFilename,
  createReviewJobArtifactArchive,
} from '@/lib/reviewJobArtifactArchive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();
  const job = await prisma.reviewJob.findFirst({
    where: ownerKey
      ? {
          id: jobId,
          OR: [{ ownerKey }, { isPublic: true }],
        }
      : {
          id: jobId,
          isPublic: true,
        },
    select: { artifactRoot: true },
  });

  if (!job?.artifactRoot) {
    return NextResponse.json({ error: 'Artifact archive not found' }, { status: 404 });
  }

  let artifactArchive;
  try {
    artifactArchive = createReviewJobArtifactArchive(job.artifactRoot);
  } catch {
    return NextResponse.json({ error: 'Artifact archive not found' }, { status: 404 });
  }

  if (!artifactArchive) {
    return NextResponse.json({ error: 'Artifact archive not found' }, { status: 404 });
  }

  const body = Readable.toWeb(artifactArchive.stream) as ReadableStream<Uint8Array>;
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition':
        `attachment; filename="${buildReviewJobArtifactArchiveFilename(jobId)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-StayReviewr-Artifact-Files': String(artifactArchive.fileCount),
      'X-StayReviewr-Uncompressed-Bytes': String(artifactArchive.uncompressedBytes),
    },
  });
}
