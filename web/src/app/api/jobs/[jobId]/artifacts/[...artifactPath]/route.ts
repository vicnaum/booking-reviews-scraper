import * as fs from 'node:fs';
import * as path from 'node:path';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import { resolveArtifactPath } from '@/lib/review-job-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ jobId: string; artifactPath: string[] }>;
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

export async function GET(_request: Request, { params }: Params) {
  const { jobId, artifactPath } = await params;
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
    return NextResponse.json({ error: 'Artifact root not found' }, { status: 404 });
  }

  let filePath: string;
  try {
    filePath = resolveArtifactPath(job.artifactRoot, artifactPath.join('/'));
  } catch {
    return NextResponse.json({ error: 'Invalid artifact path' }, { status: 400 });
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': getContentType(filePath),
      'Cache-Control': 'no-store',
    },
  });
}
