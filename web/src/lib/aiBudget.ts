export const AI_JOB_BUDGET_ENV = 'STAYREVIEWR_AI_JOB_BUDGET_USD';
export const DEFAULT_AI_JOB_BUDGET_USD = 5;

export type AiBudgetPhase = 'ai-reviews' | 'ai-photos' | 'triage';

export function resolveAiJobBudgetUsd(
  rawValue: string | number | null | undefined = process.env[AI_JOB_BUDGET_ENV],
): number | null {
  if (rawValue == null || rawValue === '') {
    return DEFAULT_AI_JOB_BUDGET_USD;
  }

  if (
    typeof rawValue === 'string'
    && ['off', 'none', 'disabled'].includes(rawValue.trim().toLowerCase())
  ) {
    return null;
  }

  const parsed = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `${AI_JOB_BUDGET_ENV} must be a non-negative USD amount or "off"; received "${rawValue}"`,
    );
  }

  return parsed === 0 ? null : parsed;
}

export function hasReachedAiJobBudget(
  totalCostUsd: number,
  budgetUsd: number | null,
): boolean {
  return budgetUsd != null && totalCostUsd >= budgetUsd;
}

export function buildAiBudgetExceededMessage(input: {
  totalCostUsd: number;
  budgetUsd: number;
}): string {
  return (
    `AI cost budget reached: $${input.totalCostUsd.toFixed(4)} spent against `
    + `$${input.budgetUsd.toFixed(2)} limit. Analysis stopped before the next AI call.`
  );
}

export class AiJobBudgetExceededError extends Error {
  readonly totalCostUsd: number;
  readonly budgetUsd: number;
  readonly phase: AiBudgetPhase;

  constructor(input: {
    totalCostUsd: number;
    budgetUsd: number;
    phase: AiBudgetPhase;
  }) {
    super(buildAiBudgetExceededMessage(input));
    this.name = 'AiJobBudgetExceededError';
    this.totalCostUsd = input.totalCostUsd;
    this.budgetUsd = input.budgetUsd;
    this.phase = input.phase;
  }
}
