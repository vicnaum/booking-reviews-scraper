import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import {
  buildOwnedReviewJobQuery,
  toReviewJobResponseRecord,
} from '@/lib/reviewJobs';
import { shouldPollReviewJob } from '@/lib/reviewJobStatus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STREAM_POLL_INTERVAL_MS = 1500;
const STREAM_KEEPALIVE_MS = 15000;

interface Params {
  params: Promise<{ jobId: string }>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getOwnedReviewJobResponse(jobId: string, ownerKey: string) {
  const job = await prisma.reviewJob.findFirst(buildOwnedReviewJobQuery(jobId, ownerKey));
  return job ? toReviewJobResponseRecord(job) : null;
}

function writeEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: string) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
}

function writeComment(controller: ReadableStreamDefaultController<Uint8Array>, message: string) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`: ${message}\n\n`));
}

export async function GET(request: Request, { params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();

  if (!ownerKey) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  const initialPayload = await getOwnedReviewJobResponse(jobId, ownerKey);
  if (!initialPayload) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastPayloadJson = JSON.stringify(initialPayload);
      let lastKeepaliveAt = Date.now();

      writeEvent(controller, 'job', lastPayloadJson);

      try {
        while (!request.signal.aborted) {
          await sleep(STREAM_POLL_INTERVAL_MS);
          if (request.signal.aborted) {
            break;
          }

          const nextPayload = await getOwnedReviewJobResponse(jobId, ownerKey);
          if (!nextPayload) {
            writeEvent(controller, 'error', JSON.stringify({ error: 'Review job not found' }));
            break;
          }

          const nextPayloadJson = JSON.stringify(nextPayload);
          if (nextPayloadJson !== lastPayloadJson) {
            lastPayloadJson = nextPayloadJson;
            writeEvent(controller, 'job', nextPayloadJson);
          } else if (Date.now() - lastKeepaliveAt >= STREAM_KEEPALIVE_MS) {
            writeComment(controller, 'keepalive');
            lastKeepaliveAt = Date.now();
          }

          if (!shouldPollReviewJob(nextPayload.job)) {
            break;
          }
        }
      } catch (error) {
        writeEvent(
          controller,
          'error',
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Review job stream failed',
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
