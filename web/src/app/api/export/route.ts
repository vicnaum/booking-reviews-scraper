import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ExportSearchRequest } from '@/types';

export const runtime = 'nodejs';

function buildBatchCommandHint(job: {
  checkin: string | null;
  checkout: string | null;
  adults: number;
}): string {
  const parts = ['reviewr batch urls.txt'];
  if (job.checkin) parts.push(`--checkin ${job.checkin}`);
  if (job.checkout) parts.push(`--checkout ${job.checkout}`);
  if (job.adults) parts.push(`--adults ${job.adults}`);
  return parts.join(' ');
}

function buildFilename(job: {
  platform: string;
  completedAt: Date | null;
  createdAt: Date;
  id: string;
}): string {
  const date = (job.completedAt ?? job.createdAt)
    .toISOString()
    .replace(/[:.]/g, '-');
  return `stayreviewr-${job.platform}-${date}-${job.id}.txt`;
}

export async function POST(request: NextRequest) {
  let body: ExportSearchRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  const job = await prisma.searchJob.findUnique({
    where: { id: body.jobId },
    include: {
      results: {
        orderBy: [
          { platform: 'asc' },
          { createdAt: 'asc' },
        ],
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: 'Search job not found' }, { status: 404 });
  }

  if (job.status !== 'completed') {
    return NextResponse.json(
      { error: `Search job must be completed before export (current: ${job.status})` },
      { status: 409 },
    );
  }

  const uniqueUrls = [...new Set(job.results.map((result) => result.url))];
  const lines = [
    '# StayReviewr export',
    '# One URL per line. Comment lines are ignored by reviewr batch.',
    `# jobId: ${job.id}`,
    `# platform: ${job.platform}`,
    `# totalResults: ${uniqueUrls.length}`,
    `# generatedAt: ${new Date().toISOString()}`,
    `# run: ${buildBatchCommandHint(job)}`,
    '',
    ...uniqueUrls,
    '',
  ];

  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${buildFilename(job)}"`,
      'cache-control': 'no-store',
    },
  });
}
