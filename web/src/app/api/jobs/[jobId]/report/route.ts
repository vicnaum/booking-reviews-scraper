import * as fs from 'node:fs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';

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
    select: {
      artifactRoot: true,
      reportPath: true,
    },
  });

  if (!job?.reportPath || !job.artifactRoot || !fs.existsSync(job.reportPath)) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  const html = fs.readFileSync(job.reportPath, 'utf-8');
  const withBase = html.includes('<head>')
    ? html.replace(
        '<head>',
        `<head><base href="/api/jobs/${jobId}/artifacts/">`,
      )
    : html;

  return new NextResponse(withBase, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
