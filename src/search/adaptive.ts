import { bboxHeightMeters, bboxIntersectsCircle, bboxWidthMeters, subdivideBbox } from './geo.js';
import type { BoundingBox, CircleFilter } from './types.js';

export interface AdaptiveSubdivisionConfig {
  maxDepth: number;
  minCellSideMeters: number;
  forceProbeDepth: number;
  minResultsToProbe: number;
  minNewIds: number;
  minGainRatio: number;
}

export interface AdaptiveQuadrantCellContext {
  depth: number;
  index: number;
  label: string;
}

export interface AdaptiveQuadrantCellOutcome {
  filteredResultCount: number;
  newUniqueResultCount: number;
  reportedTotal?: number | null;
}

export interface AdaptiveQuadrantSearchOptions {
  root: BoundingBox;
  circle?: CircleFilter;
  forceSubdivisionDepth: number;
  maxSubdivisionDepth: number;
  minSubdivisionResults: number;
  minNewUniqueResults: number;
  minCellSideMeters: number;
  cellDelayMs?: number;
  logger?: (message: string) => void;
  shouldStop?: () => boolean;
  visitCell: (
    cell: BoundingBox,
    context: AdaptiveQuadrantCellContext,
  ) => Promise<AdaptiveQuadrantCellOutcome>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function shouldProbeChildren(options: {
  bbox: BoundingBox;
  depth: number;
  resultCount: number;
  config: AdaptiveSubdivisionConfig;
}): boolean {
  if (options.depth >= options.config.maxDepth) {
    return false;
  }

  if (options.resultCount === 0) {
    return false;
  }

  const maxSideMeters = Math.max(
    bboxWidthMeters(options.bbox),
    bboxHeightMeters(options.bbox),
  );
  if (maxSideMeters <= options.config.minCellSideMeters) {
    return false;
  }

  if (options.depth < options.config.forceProbeDepth) {
    return true;
  }

  return options.resultCount >= options.config.minResultsToProbe;
}

export function countNewChildIds(
  parentIds: Iterable<string>,
  childIds: Iterable<string>,
): number {
  const parentSet = new Set(parentIds);
  let count = 0;

  for (const id of childIds) {
    if (!parentSet.has(id)) {
      count++;
    }
  }

  return count;
}

export function hasMeaningfulChildGain(options: {
  parentCount: number;
  newIdCount: number;
  config: AdaptiveSubdivisionConfig;
}): boolean {
  if (options.newIdCount <= 0) {
    return false;
  }

  if (options.newIdCount >= options.config.minNewIds) {
    return true;
  }

  if (options.parentCount <= 0) {
    return true;
  }

  return options.newIdCount / options.parentCount >= options.config.minGainRatio;
}

function shouldSubdivideCell(
  cell: BoundingBox,
  depth: number,
  outcome: AdaptiveQuadrantCellOutcome,
  options: AdaptiveQuadrantSearchOptions,
): boolean {
  const config: AdaptiveSubdivisionConfig = {
    maxDepth: options.maxSubdivisionDepth,
    minCellSideMeters: options.minCellSideMeters,
    forceProbeDepth: options.forceSubdivisionDepth,
    minResultsToProbe: options.minSubdivisionResults,
    minNewIds: options.minNewUniqueResults,
    minGainRatio: 0,
  };

  if (!shouldProbeChildren({
    bbox: cell,
    depth,
    resultCount: outcome.filteredResultCount,
    config,
  })) {
    return false;
  }

  if (depth < options.forceSubdivisionDepth) {
    return true;
  }

  return outcome.newUniqueResultCount >= options.minNewUniqueResults;
}

export async function runAdaptiveQuadrantSearch(
  options: AdaptiveQuadrantSearchOptions,
): Promise<{ visitedCells: number }> {
  let visitedCells = 0;

  const visit = async (cell: BoundingBox, depth: number): Promise<void> => {
    if (options.shouldStop?.()) {
      return;
    }

    visitedCells++;
    const context: AdaptiveQuadrantCellContext = {
      depth,
      index: visitedCells,
      label: `Cell ${visitedCells} (depth ${depth})`,
    };

    options.logger?.(`  📍 ${context.label}`);
    const outcome = await options.visitCell(cell, context);

    const reportedSuffix =
      outcome.reportedTotal != null ? ` / ${outcome.reportedTotal} reported results` : '';
    options.logger?.(
      `    ↳ ${outcome.filteredResultCount} filtered, ${outcome.newUniqueResultCount} new${reportedSuffix}`,
    );

    if (!shouldSubdivideCell(cell, depth, outcome, options)) {
      return;
    }

    const childCells = subdivideBbox(cell).filter(
      (child) => !options.circle || bboxIntersectsCircle(child, options.circle),
    );
    options.logger?.(`    ↳ subdividing into ${childCells.length} exact quadrants`);

    for (const child of childCells) {
      if (options.shouldStop?.()) {
        break;
      }

      if (options.cellDelayMs) {
        await sleep(options.cellDelayMs);
      }
      await visit(child, depth + 1);
    }
  };

  await visit(options.root, 0);
  return { visitedCells };
}
