'use client';

import React, { Fragment, useMemo, useState } from 'react';
import {
  getPrioritiesMatrixRankingGroup,
  sortPrioritiesMatrixRows,
  type PrioritiesMatrixEvidence,
  type PrioritiesMatrixPriorityCell,
  type PrioritiesMatrixRankingStatus,
  type PrioritiesMatrixRow,
  type PrioritiesMatrixSortDirection,
} from '@cli/priorities-matrix';
import { buildReviewJobPrioritiesMatrix } from '@/lib/prioritiesMatrix';
import type { ReviewJobListing } from '@/types';
import { formatUsdCost } from '@/lib/aiCosts';
import {
  TRIAGE_REGRADE_REASON_COPY,
  type TriageRegradeReason,
} from '@/lib/results';
import PlatformBadge from './PlatformBadge';

type SortState = {
  key: string | null;
  direction: PrioritiesMatrixSortDirection;
};
const EMPTY_DUPLICATE_CONFLICT_KEYS: ReadonlySet<string> =
  new Set();

function statusClassName(status: string): string {
  switch (status) {
    case 'met':
    case 'within':
    case 'yes':
    case 'eligible':
      return 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100';
    case 'partial':
    case 'conditional':
      return 'border-amber-300/20 bg-amber-300/10 text-amber-100';
    case 'unmet':
    case 'over':
    case 'no':
    case 'excluded':
      return 'border-rose-300/20 bg-rose-300/10 text-rose-100';
    default:
      return 'border-white/10 bg-white/[0.05] text-stone-300';
  }
}

function rankingLabel(status: PrioritiesMatrixRankingStatus): string {
  switch (status) {
    case 'ranked':
      return 'Ranked';
    case 'insufficient_evidence':
      return 'Insufficient evidence';
    case 'stale_classifier_policy':
      return 'Older policy';
    case 'stale_requirement_set':
      return 'Different priority set';
    case 'legacy':
      return 'Legacy';
    case 'unscored':
      return 'Unscored';
  }
}

function rankingGroupLabel(status: PrioritiesMatrixRankingStatus): string {
  switch (status) {
    case 'ranked':
      return 'Comparable ranked results';
    case 'insufficient_evidence':
      return 'Insufficient evidence — visible for audit, outside peer ranking';
    case 'stale_classifier_policy':
      return 'Classified under an older policy — regrade before comparing';
    case 'legacy':
    case 'stale_requirement_set':
      return 'Legacy or different priority set — not aligned into current columns';
    case 'unscored':
      return 'Unscored candidates';
  }
}

function gapLabel(gap: string): string {
  switch (gap) {
    case 'reviews':
      return 'No review data';
    case 'photos':
      return 'No photo analysis';
    case 'details':
      return 'No listing details';
    default:
      return gap;
  }
}

function formatEvidenceMeta(evidence: PrioritiesMatrixEvidence): string | null {
  const parts = [
    evidence.frequency.display,
    evidence.years.length > 0
      ? evidence.years.join(', ')
      : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}

function EvidenceLine({
  evidence,
  compact = false,
}: {
  evidence: PrioritiesMatrixEvidence;
  compact?: boolean;
}) {
  const prefix =
    evidence.polarity === 'contradicts'
      ? '[-]'
      : evidence.polarity === 'supports'
        ? '[+]'
        : '[?]';
  const meta = formatEvidenceMeta(evidence);
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <p
        className={
          compact
            ? 'line-clamp-3 text-[11px] leading-4 text-stone-300'
            : 'text-xs leading-5 text-stone-300'
        }
      >
        <span
          className={
            evidence.polarity === 'contradicts'
              ? 'font-bold text-rose-300'
              : evidence.polarity === 'supports'
                ? 'font-bold text-emerald-300'
                : 'font-bold text-stone-400'
          }
        >
          {prefix}
        </span>{' '}
        {evidence.text}
      </p>
      {meta && (
        <p className="text-[10px] font-medium leading-4 text-stone-500">
          {meta}
        </p>
      )}
    </div>
  );
}

function PriorityCell({
  cell,
}: {
  cell: PrioritiesMatrixPriorityCell;
}) {
  return (
    <div className="min-w-[220px] max-w-[280px] space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${statusClassName(
            cell.status,
          )}`}
        >
          {cell.status}
        </span>
        {cell.confidence && (
          <span className="text-[10px] text-stone-500">
            {cell.confidence} confidence
          </span>
        )}
      </div>
      {cell.strongestEvidence ? (
        <EvidenceLine evidence={cell.strongestEvidence} compact />
      ) : (
        <p className="text-[11px] leading-4 text-stone-500">
          {cell.unavailableReason === 'requirement_missing'
            ? 'Priority cell missing from this verdict.'
            : cell.state === 'unavailable'
              ? 'Not aligned with the active priority set.'
              : cell.note ?? 'No matched evidence.'}
        </p>
      )}
      {cell.note && cell.strongestEvidence && (
        <p className="line-clamp-2 text-[10px] leading-4 text-stone-500">
          {cell.note}
        </p>
      )}
      {cell.evidenceGaps.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {cell.evidenceGaps.map((gap) => (
            <span
              key={gap}
              className="rounded-full border border-amber-300/15 bg-amber-300/[0.07] px-1.5 py-0.5 text-[9px] font-semibold text-amber-100/80"
            >
              {gapLabel(gap)}
            </span>
          ))}
        </div>
      )}
      {cell.evidence.length > 1 && (
        <details className="text-[10px] text-stone-500">
          <summary className="cursor-pointer font-semibold hover:text-stone-300">
            {cell.evidence.length} matched evidence lines
          </summary>
          <div className="mt-2 space-y-2 border-l border-white/10 pl-2">
            {cell.evidence.map((evidence, index) => (
              <EvidenceLine
                key={`${evidence.layer}:${evidence.text}:${index}`}
                evidence={evidence}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function reviewSampleLabel(row: PrioritiesMatrixRow): string {
  const sample = row.reviewSample;
  const total =
    sample.totalScrapedReviewCount != null
      ? `${sample.totalScrapedReviewCount.toLocaleString('en-US')} scraped`
      : 'scraped total unknown';
  if (sample.analyzedReviewCount == null) {
    return `Analysed sample unknown · ${total}`;
  }

  const analyzed =
    `${sample.analyzedReviewCount.toLocaleString('en-US')} analysed`;
  if (sample.capped && sample.eligibleReviewCount != null) {
    return (
      `${analyzed} (capped from `
      + `${sample.eligibleReviewCount.toLocaleString('en-US')} eligible) · ${total}`
    );
  }
  if (
    sample.eligibleReviewCount != null
    && sample.eligibleReviewCount !== sample.analyzedReviewCount
  ) {
    return (
      `${analyzed} of ${sample.eligibleReviewCount.toLocaleString('en-US')} eligible`
      + ` · ${total}`
    );
  }
  return `${analyzed} · ${total}`;
}

function HeaderButton({
  label,
  sortKey,
  sort,
  onSort,
  subtitle,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  subtitle?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="min-w-[160px] text-left transition hover:text-white"
      title="Sort this column; first click puts risks first"
    >
      <span className="font-semibold text-stone-300">
        {label}
        {active ? (sort.direction === 'risk' ? ' ↓ risk' : ' ↑ fit') : ''}
      </span>
      {subtitle && (
        <span className="mt-1 block text-[9px] normal-case tracking-normal text-stone-600">
          {subtitle}
        </span>
      )}
    </button>
  );
}

export default function PrioritiesMatrix({
  listings,
  duplicateConflictKeys = EMPTY_DUPLICATE_CONFLICT_KEYS,
  onSelectListing,
  regradeReasons = [],
  regradeLocked = false,
  regradeListingCount,
  estimatedRegradeCostUsd,
  regradeMessage,
  onRegrade,
}: {
  listings: ReviewJobListing[];
  duplicateConflictKeys?: ReadonlySet<string>;
  onSelectListing?: (listingKey: string) => void;
  regradeReasons?: TriageRegradeReason[];
  regradeLocked?: boolean;
  regradeListingCount?: number;
  estimatedRegradeCostUsd?: number;
  regradeMessage?: string | null;
  onRegrade?: () => void;
}) {
  const regradeNeeded = regradeReasons.length > 0;
  const briefChanged = regradeReasons.includes('brief_changed');
  const wholeJobListingCount =
    regradeListingCount
    ?? listings.filter((listing) => !listing.hidden).length;
  const [sort, setSort] = useState<SortState>({
    key: null,
    direction: 'risk',
  });
  const matrix = useMemo(
    () => buildReviewJobPrioritiesMatrix(listings),
    [listings],
  );
  const sortedRows = useMemo(
    () => sortPrioritiesMatrixRows(matrix.rows, sort.key, sort.direction),
    [matrix.rows, sort],
  );
  const rows = useMemo(() => {
    const comparable: PrioritiesMatrixRow[] = [];
    const conflicts: PrioritiesMatrixRow[] = [];
    const other: PrioritiesMatrixRow[] = [];
    for (const row of sortedRows) {
      const key = `${row.platform}:${row.id}`;
      if (duplicateConflictKeys.has(key)) {
        conflicts.push(row);
      } else if (
        getPrioritiesMatrixRankingGroup(row.rankingStatus) === 0
      ) {
        comparable.push(row);
      } else {
        other.push(row);
      }
    }
    return [...comparable, ...conflicts, ...other];
  }, [duplicateConflictKeys, sortedRows]);

  function rowGroupKey(row: PrioritiesMatrixRow): string {
    return duplicateConflictKeys.has(`${row.platform}:${row.id}`)
      ? 'duplicate_conflict'
      : `ranking:${getPrioritiesMatrixRankingGroup(row.rankingStatus)}`;
  }

  function applySort(key: string) {
    setSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === 'risk' ? 'fit' : 'risk',
          }
        : { key, direction: 'risk' });
  }

  if (listings.length === 0) return null;

  return (
    <section className="rounded-[28px] border border-white/10 bg-black/[0.24] shadow-[0_28px_90px_rgba(0,0,0,0.34)] backdrop-blur-xl">
      <div className="border-b border-white/10 px-5 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">
          Evidence comparison
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-white">
            Priorities matrix
          </h2>
          {briefChanged && (
            <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100">
              Reflects previous quality brief
            </span>
          )}
        </div>
        <p className="mt-2 max-w-4xl text-xs leading-5 text-stone-500">
          Availability and affordability stay separate from quality. Each
          priority cell shows the strongest status-aligned evidence, its
          AI-analyzed frequency and years, plus missing evidence layers.
          Column sorting never mixes cross-platform conflicts, insufficient,
          legacy, or stale rows into the comparable ranked group.
        </p>
        {regradeNeeded && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-amber-100">
                Regrade needed before comparing verdicts
              </p>
              <ul className="mt-1 max-w-3xl space-y-1 text-[11px] leading-5 text-amber-100/70">
                {regradeReasons.map((reason) => (
                  <li key={reason}>
                    {TRIAGE_REGRADE_REASON_COPY[reason]}
                  </li>
                ))}
              </ul>
              <p className="mt-1 max-w-3xl text-[11px] leading-5 text-amber-100/70">
                Evidence snippets, frequencies, and years remain valid audit
                data.
                {briefChanged
                  ? ' The priority columns reflect the previous brief.'
                  : ' Some verdicts use a different policy or priority set.'}
                {' '}Peer comparison is not current until the whole job is
                regraded. Regrading reuses saved review and photo analysis and
                calls only triage.
              </p>
              <p className="mt-1 text-[11px] leading-5 text-amber-100/60">
                Whole-job scope: {wholeJobListingCount} listing
                {wholeJobListingCount === 1 ? '' : 's'}.
                {estimatedRegradeCostUsd != null
                  ? ` Estimated triage cost: ${
                      formatUsdCost(estimatedRegradeCostUsd)
                    } at about $0.006 per listing.`
                  : ''}
              </p>
              {regradeMessage && (
                <p className="mt-2 text-xs font-semibold text-amber-100">
                  {regradeMessage}
                </p>
              )}
            </div>
            {onRegrade ? (
              <button
                type="button"
                onClick={onRegrade}
                disabled={regradeLocked}
                className="rounded-xl border border-amber-200/25 bg-amber-100/10 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:bg-amber-100/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {regradeLocked
                  ? 'Regrade queued or running…'
                  : 'Regrade whole job'}
              </button>
            ) : (
              <span className="text-xs font-semibold text-amber-100/70">
                Ask the job owner to regrade.
              </span>
            )}
          </div>
        )}
      </div>

      {matrix.columns.length === 0 ? (
        <p className="px-5 py-8 text-sm text-stone-400">
          No current canonical priority set is available. Regrade the whole
          job before comparing evidence by priority.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-max border-collapse text-left">
            <thead>
              <tr className="border-b border-white/10 bg-black/20 text-[10px] uppercase tracking-[0.12em] text-stone-500">
                <th className="sticky left-0 z-10 min-w-[260px] bg-[#100d0c] px-4 py-3">
                  Candidate
                </th>
                <th className="min-w-[190px] px-4 py-3 align-top">
                  <HeaderButton
                    label="Availability"
                    sortKey="availability"
                    sort={sort}
                    onSort={applySort}
                    subtitle="Exact stay booking eligibility"
                  />
                </th>
                <th className="min-w-[190px] px-4 py-3 align-top">
                  <HeaderButton
                    label="Affordability"
                    sortKey="affordability"
                    sort={sort}
                    onSort={applySort}
                    subtitle="Deterministic budget axis"
                  />
                </th>
                {matrix.columns.map((column) => (
                  <th
                    key={column.requirementId}
                    className="min-w-[240px] px-4 py-3 align-top"
                  >
                    <HeaderButton
                      label={column.label}
                      sortKey={column.requirementId}
                      sort={sort}
                      onSort={applySort}
                      subtitle={[
                        column.type?.replace(/_/g, ' '),
                        column.weight != null
                          ? `weight ${column.weight}`
                          : null,
                      ].filter(Boolean).join(' · ')}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const duplicateConflict = duplicateConflictKeys.has(
                  `${row.platform}:${row.id}`,
                );
                const showGroup =
                  index === 0
                  || rowGroupKey(row) !== rowGroupKey(rows[index - 1]);
                return (
                  <Fragment key={`${row.platform}:${row.id}`}>
                    {showGroup && (
                      <tr>
                        <td
                          colSpan={matrix.columns.length + 3}
                          className="border-b border-white/10 bg-white/[0.035] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500"
                        >
                          {duplicateConflict
                            ? 'Cross-platform conflict — linked offers visible for audit, outside peer ranking'
                            : briefChanged
                              && row.rankingStatus !== 'unscored'
                              ? `Previous brief · ${
                                  rankingGroupLabel(row.rankingStatus)
                                }`
                              : rankingGroupLabel(row.rankingStatus)}
                        </td>
                      </tr>
                    )}
                    <tr className="border-b border-white/5 align-top hover:bg-white/[0.025]">
                      <td className="sticky left-0 z-[5] bg-[#0f0c0b] px-4 py-4">
                        <button
                          type="button"
                          onClick={() =>
                            onSelectListing?.(`${row.platform}:${row.id}`)}
                          className="max-w-[250px] text-left"
                        >
                          <PlatformBadge
                            platform={
                              row.platform === 'airbnb'
                                ? 'airbnb'
                                : 'booking'
                            }
                          />
                          <span className="mt-2 block text-xs font-semibold leading-5 text-white hover:text-sky-100">
                            {row.name}
                          </span>
                        </button>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${
                              duplicateConflict
                                ? statusClassName('unmet')
                                : briefChanged
                                && row.rankingStatus !== 'unscored'
                                ? statusClassName('partial')
                                : row.rankingStatus === 'ranked'
                                ? statusClassName('met')
                                : row.rankingStatus === 'insufficient_evidence'
                                  ? statusClassName('partial')
                                  : statusClassName('unknown')
                            }`}
                          >
                            {duplicateConflict
                              ? 'Cross-platform conflict'
                              : briefChanged
                              && row.rankingStatus !== 'unscored'
                              ? 'Regrade needed'
                              : rankingLabel(row.rankingStatus)}
                          </span>
                          {row.coverage != null && (
                            <span className="text-[10px] text-stone-500">
                              {Math.round(row.coverage * 100)}% coverage
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-[10px] leading-4 text-stone-500">
                          {reviewSampleLabel(row)}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <div className="min-w-[170px] space-y-2">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${statusClassName(
                              row.availability.eligibility,
                            )}`}
                          >
                            {row.availability.status} ·{' '}
                            {row.availability.freshness}
                          </span>
                          <p className="text-[10px] leading-4 text-stone-500">
                            {row.availability.reason
                              ?? 'Exact-stay availability is unknown.'}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="min-w-[170px] space-y-2">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${statusClassName(
                              row.affordability.status,
                            )}`}
                          >
                            {row.affordability.status}
                            {row.affordability.overByPercent != null
                              ? ` · ${row.affordability.overByPercent}% over`
                              : ''}
                          </span>
                          <p className="text-[10px] leading-4 text-stone-500">
                            {row.affordability.reason
                              ?? 'No affordability caveat.'}
                          </p>
                        </div>
                      </td>
                      {matrix.columns.map((column) => (
                        <td
                          key={column.requirementId}
                          className="px-4 py-4"
                        >
                          <PriorityCell
                            cell={row.priorities[column.requirementId]}
                          />
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
