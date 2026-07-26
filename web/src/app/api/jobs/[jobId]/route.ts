import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getReviewJobOwnerKey } from '@/lib/reviewJobOwner';
import {
  buildAccessibleReviewJobQuery,
  buildOwnedReviewJobQuery,
  toReviewJobResponseRecordForViewer,
} from '@/lib/reviewJobs';
import type { Platform, ReviewJobResponse } from '@/types';
import {
  computeReviewJobSnapshotAffordability,
  getReviewJobStaySnapshotReadModel,
  resolveStaySnapshotTtlMs,
} from '@/lib/staySnapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ jobId: string }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function recomputeJobAffordability(
  tx: Prisma.TransactionClient,
  jobId: string,
) {
  const job = await tx.reviewJob.findUniqueOrThrow({
    where: { id: jobId },
  });
  const analyses = await tx.reviewJobListingAnalysis.findMany({
    where: {
      jobListing: { jobId },
    },
    select: {
      id: true,
      triage: true,
      details: true,
      jobListing: {
        select: {
          platform: true,
          listingId: true,
          url: true,
          staySnapshot: true,
          priceRefreshAttempt: true,
        },
      },
    },
  });
  const ttlMs = resolveStaySnapshotTtlMs();
  const now = new Date();

  for (const analysis of analyses) {
    const triage = asRecord(analysis.triage);
    if (triage?.scoreSource !== 'deterministic_rubric') continue;

    const snapshot = getReviewJobStaySnapshotReadModel({
      job,
      listing: analysis.jobListing,
      analysis,
      ttlMs,
      now,
    });
    const affordability = computeReviewJobSnapshotAffordability({
      job,
      triage,
      snapshot,
      now,
    });

    await tx.reviewJobListingAnalysis.update({
      where: { id: analysis.id },
      data: {
        triage: {
          ...triage,
          affordability,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();

  const job = await prisma.reviewJob.findFirst(
    buildAccessibleReviewJobQuery(jobId, ownerKey),
  );

  if (!job) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  const response: ReviewJobResponse = toReviewJobResponseRecordForViewer(job, ownerKey);

  return NextResponse.json(response);
}

export async function PATCH(request: Request, { params }: Params) {
  const { jobId } = await params;
  const ownerKey = await getReviewJobOwnerKey();

  if (!ownerKey) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  let body: {
    prompt?: string | null;
    analysisBudgetAmount?: number | null;
    analysisBudgetCurrency?: string | null;
    selectedListings?: Array<{ id: string; platform: Platform }> | null;
    isPublic?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const selectedListings = Array.isArray(body.selectedListings)
    ? body.selectedListings.filter(
        (item): item is { id: string; platform: Platform } =>
          !!item
          && typeof item === 'object'
          && typeof item.id === 'string'
          && (item.platform === 'airbnb' || item.platform === 'booking'),
      )
    : null;

  const existingJob = await prisma.reviewJob.findFirst({
    where: {
      id: jobId,
      ownerKey,
    },
    select: {
      id: true,
      analysisStatus: true,
      analysisCurrentPhase: true,
      currency: true,
      analysisBudgetAmount: true,
      analysisBudgetCurrency: true,
      priceRefreshStatus: true,
      priceRefreshCurrentPhase: true,
    },
  });

  if (!existingJob) {
    return NextResponse.json({ error: 'Review job not found' }, { status: 404 });
  }

  if (
    existingJob.analysisStatus === 'running'
    || existingJob.analysisCurrentPhase === 'queued'
    || existingJob.priceRefreshStatus === 'running'
    || existingJob.priceRefreshCurrentPhase === 'queued'
  ) {
    return NextResponse.json(
      { error: 'Wait for the current analysis or price refresh to finish before changing brief, budget, or selection' },
      { status: 409 },
    );
  }

  const hasBudgetUpdate =
    Object.prototype.hasOwnProperty.call(body, 'analysisBudgetAmount')
    || Object.prototype.hasOwnProperty.call(body, 'analysisBudgetCurrency');
  const hasBudgetAmountUpdate =
    Object.prototype.hasOwnProperty.call(body, 'analysisBudgetAmount');
  let normalizedBudgetAmount: number | null | undefined;
  let normalizedBudgetCurrency: string | null | undefined;
  if (hasBudgetUpdate) {
    const requestedAmount = hasBudgetAmountUpdate
      ? body.analysisBudgetAmount
      : existingJob.analysisBudgetAmount;
    if (requestedAmount == null) {
      normalizedBudgetAmount = null;
      normalizedBudgetCurrency = null;
    } else {
      normalizedBudgetAmount = Number(requestedAmount);
      const requestedCurrency =
        body.analysisBudgetCurrency
        ?? existingJob.analysisBudgetCurrency
        ?? existingJob.currency;
      normalizedBudgetCurrency =
        typeof requestedCurrency === 'string'
          ? requestedCurrency.trim().toUpperCase()
          : '';
      if (
        !Number.isFinite(normalizedBudgetAmount)
        || normalizedBudgetAmount <= 0
        || !/^[A-Z]{3}$/.test(normalizedBudgetCurrency)
      ) {
        return NextResponse.json(
          { error: 'Analysis budget requires a positive amount and three-letter currency code' },
          { status: 400 },
        );
      }
    }
  }

  const job = await prisma.$transaction(async (tx) => {
    const updateData: Prisma.ReviewJobUpdateInput = {};
    if (Object.prototype.hasOwnProperty.call(body, 'prompt')) {
      updateData.prompt = body.prompt?.trim() || null;
    }
    if (normalizedBudgetAmount !== undefined) {
      updateData.analysisBudgetAmount = normalizedBudgetAmount;
      updateData.analysisBudgetCurrency = normalizedBudgetCurrency ?? null;
    }
    if (typeof body.isPublic === 'boolean') {
      updateData.isPublic = body.isPublic;
    }

    if (Object.keys(updateData).length > 0) {
      await tx.reviewJob.update({
        where: { id: jobId },
        data: updateData,
      });
    }

    if (normalizedBudgetAmount !== undefined) {
      await recomputeJobAffordability(tx, jobId);
    }

    if (selectedListings) {
      await tx.reviewJobListing.updateMany({
        where: { jobId },
        data: { selected: false },
      });

      if (selectedListings.length > 0) {
        await tx.reviewJobListing.updateMany({
          where: {
            jobId,
            OR: selectedListings.map((item) => ({
              listingId: item.id,
              platform: item.platform,
            })),
          },
          data: { selected: true },
        });
      }
    }

    return tx.reviewJob.findFirstOrThrow(buildOwnedReviewJobQuery(jobId, ownerKey));
  });

  const response: ReviewJobResponse = toReviewJobResponseRecordForViewer(job, ownerKey);

  return NextResponse.json(response);
}
