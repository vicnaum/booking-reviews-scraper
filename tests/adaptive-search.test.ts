import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countNewChildIds,
  hasMeaningfulChildGain,
  runAdaptiveQuadrantSearch,
  shouldRecurseIntoChildren,
  shouldProbeChildren,
  type AdaptiveSubdivisionConfig,
} from '../src/search/adaptive';

const config: AdaptiveSubdivisionConfig = {
  maxDepth: 3,
  minCellSideMeters: 900,
  forceProbeDepth: 1,
  minResultsToProbe: 10,
  minNewIds: 2,
  minGainRatio: 0.05,
};

test('shouldProbeChildren forces one exploratory split near the root', () => {
  assert.equal(
    shouldProbeChildren({
      bbox: { neLat: 51.52, neLng: -0.12, swLat: 51.50, swLng: -0.16 },
      depth: 0,
      resultCount: 3,
      config,
    }),
    true,
  );
});

test('shouldProbeChildren stops on tiny cells and deep recursion', () => {
  assert.equal(
    shouldProbeChildren({
      bbox: { neLat: 51.5005, neLng: -0.1205, swLat: 51.5, swLng: -0.121 },
      depth: 1,
      resultCount: 50,
      config,
    }),
    false,
  );

  assert.equal(
    shouldProbeChildren({
      bbox: { neLat: 51.52, neLng: -0.12, swLat: 51.50, swLng: -0.16 },
      depth: 3,
      resultCount: 50,
      config,
    }),
    false,
  );
});

test('countNewChildIds only counts IDs absent from the parent query', () => {
  assert.equal(
    countNewChildIds(['a', 'b', 'c'], ['b', 'c', 'd', 'e']),
    2,
  );
});

test('hasMeaningfulChildGain accepts either absolute or relative uplift', () => {
  assert.equal(
    hasMeaningfulChildGain({
      parentCount: 30,
      newIdCount: 0,
      config,
    }),
    false,
  );

  assert.equal(
    hasMeaningfulChildGain({
      parentCount: 30,
      newIdCount: 1,
      config,
    }),
    false,
  );

  assert.equal(
    hasMeaningfulChildGain({
      parentCount: 30,
      newIdCount: 2,
      config,
    }),
    true,
  );

  assert.equal(
    hasMeaningfulChildGain({
      parentCount: 10,
      newIdCount: 1,
      config,
    }),
    true,
  );
});

test('shouldRecurseIntoChildren honors forced depth before gain checks', () => {
  assert.equal(
    shouldRecurseIntoChildren({
      depth: 0,
      parentCount: 30,
      newIdCount: 0,
      config,
    }),
    true,
  );

  assert.equal(
    shouldRecurseIntoChildren({
      depth: 1,
      parentCount: 30,
      newIdCount: 0,
      config,
    }),
    false,
  );

  assert.equal(
    shouldRecurseIntoChildren({
      depth: 0,
      parentCount: 30,
      newIdCount: 0,
      config: { ...config, forceProbeDepth: 2 },
    }),
    true,
  );

  assert.equal(
    shouldRecurseIntoChildren({
      depth: 1,
      parentCount: 30,
      newIdCount: 0,
      config: { ...config, forceProbeDepth: 2 },
    }),
    true,
  );

  assert.equal(
    shouldRecurseIntoChildren({
      depth: 2,
      parentCount: 30,
      newIdCount: 0,
      config: { ...config, forceProbeDepth: 2 },
    }),
    false,
  );
});

test('runAdaptiveQuadrantSearch keeps subdividing until forced depth even without uplift', async () => {
  const visitedDepths: number[] = [];

  const result = await runAdaptiveQuadrantSearch({
    root: { neLat: 51.52, neLng: -0.12, swLat: 51.50, swLng: -0.16 },
    forceSubdivisionDepth: 2,
    maxSubdivisionDepth: 3,
    minSubdivisionResults: 10,
    minNewUniqueResults: 2,
    minCellSideMeters: 900,
    visitCell: async (_cell, context) => {
      visitedDepths.push(context.depth);
      if (context.depth === 0) {
        return { filteredResultCount: 12, newUniqueResultCount: 12 };
      }
      if (context.depth === 1) {
        return { filteredResultCount: 12, newUniqueResultCount: 0 };
      }
      return { filteredResultCount: 1, newUniqueResultCount: 0 };
    },
  });

  assert.equal(result.visitedCells, 21);
  assert.equal(visitedDepths.filter((depth) => depth === 2).length, 16);
});
