# Deterministic triage rubric v1

This document defines what a StayReviewr quality score and tier mean. It is a product contract:
the model classifies evidence, while code alone computes the score, hard caps, ranking eligibility,
and tier.

## Verdict fields and scope

New verdicts carry:

```json
{
  "scoreSource": "deterministic_rubric",
  "rubricVersion": "1",
  "requirementSetId": "reqset_...",
  "classifierVersion": "triage-classifier-v2",
  "modelId": "gemini:gemini-3-flash-preview:high",
  "rawFitScore": 70,
  "fitScore": 44,
  "tier": "unlikely",
  "capReasons": ["weight_gte_3_unmet_high:req-01-quiet-sleep"],
  "coverage": 1,
  "rankingStatus": "ranked"
}
```

`fitScore` and `tier` measure only quality fit against one canonical requirement set. Price,
budget, price freshness, and availability do not contribute to the score and never cap it.
Affordability is a separate structured axis.

`rawFitScore` is the weighted result. `fitScore` is the raw result after every deterministic cap.
`tier` is derived from `fitScore`. `coverage` and `rankingStatus` decide whether the verdict may be
ranked alongside its peers.

Peer comparison uses one derived key:

```text
rubricVersion + requirementSetId + classifierVersion
```

Code builds this key in one shared helper used by the native results page and CLI report. A missing
or different classifier version makes a verdict non-comparable even when its requirement
definitions match. `modelId` is persisted for audit but is deliberately outside the key: provider
model aliases can change on an external release schedule, and that churn must not silently
invalidate every saved verdict.

## Canonical requirement set

The guest brief is parsed once per job or batch at temperature 0. The resulting definitions are
persisted and reused verbatim for every listing. The direct single-listing CLI performs the same
parse for that invocation.

Code creates IDs from persisted order and a normalized label slug, for example
`req-01-quiet-sleep`. The model never creates IDs. `requirementSetId` hashes:

- the requirement schema version;
- the parser/model version;
- every normalized definition, including order, type, rank, weight, source text, and criteria.

The prose brief and parsed budget are not themselves hashed. Equivalent canonical definitions
therefore remain comparable, while any material definition or parser-version change creates a new
set.

These IDs are also the column keys for the priorities matrix. Each listing must classify the same
IDs in the same order. Matrix cells are never aligned by model-authored labels.

### Splitting

Split compound prose only when its parts are independently evaluable. Keep close synonyms as
criteria within one definition. For example, street noise, HVAC noise, and soundproofing can remain
criteria for quiet sleep; bed comfort, blackout conditions, workspace, and walkability are separate
decisions.

When a ranked umbrella is split, its type and rank propagate to every independently evaluable
child. This makes the scoring consequence explicit.

Budget language is extracted separately and is never a quality requirement.

### Types and weights

| Display type | Meaning | Resolved weight |
|---|---|---:|
| `deal_breaker` | Explicit cannot-accept condition or objective safety/accessibility constraint | 4 |
| `must_have` | Explicit must/need/require or objective occupancy/accessibility need | 3 |
| `priority` | Strong or ranked preference that is not non-negotiable | 2 |
| `nice_to_have` | Preference or bonus | 1 |

An explicitly rank-1 or “by far” `priority` resolves to weight 3. Other priority ranks remain weight
2. The type remains `priority` for display, but cap behavior uses the resolved numeric weight.

With no quality brief, v1 uses:

1. Clean and well maintained — `priority`, weight 2
2. Comfortable sleep — `priority`, weight 2
3. Accurate and functional listing — `priority`, weight 2
4. Convenient location — `nice_to_have`, weight 1

## Evidence classification

The listing classifier receives frozen definitions and returns one outcome for every ID:

```json
{
  "requirementId": "req-01-quiet-sleep",
  "status": "unmet",
  "confidence": "high",
  "note": "Repeated HVAC noise conflicts with quiet sleep.",
  "evidence": [
    {
      "layer": "reviews",
      "polarity": "contradicts",
      "text": "The HVAC sounded like a freight train.",
      "frequency": "repeated",
      "years": [2025, 2026]
    }
  ]
}
```

Statuses are `met`, `partial`, `unmet`, and `unknown`. Classifier policy v2 applies these boundaries:

- `met`: clear relevant support with no material contradiction;
- `partial`: evidence is genuinely mixed, or failure is bounded and avoidable through a specific,
  verifiable choice that the evidence says is available for this stay;
- `unmet`: credible actual failure, including a recurring meaningful pattern, a severe confirmed
  failure directly matching the requirement, or a mitigation that defeats the requirement;
- `unknown`: no relevant evidence, a missing evidence layer, or evidence too vague to distinguish
  fit from failure.

Turning off a needed system, tolerating a problem, or merely asking for a better room is not
guest-controlled avoidance. A majority of reviews is not required for `unmet`, but absence of
evidence still produces `unknown`; absence in photos is not evidence of absence.

Every batch supplies the exact job check-in, check-out, stay length, guest count, and listing
destination. Stay context may decide whether a mitigation is usable—for example, disabling a loud
HVAC for a 13-night July/August stay—but the classifier may not invent weather, live inventory,
room assignment, or provider policy. Direct CLI callers can provide the same context explicitly.

Confidence is `high`, `medium`, or `low` and measures evidence strength, not requirement
importance. The model does not output the quality score, tier, definitions, weights, or caps.

## Scoring math

Status values:

| Status | Value |
|---|---:|
| `met` | 1.0 |
| `partial` | 0.5 |
| `unmet` | 0.0 |
| `unknown` | 0.5 |

Confidence factors:

| Confidence | Factor |
|---|---:|
| `high` | 1.0 |
| `medium` | 0.75 |
| `low` | 0.5 |

For a non-unknown outcome:

```text
effective = 0.5 + confidenceFactor × (statusValue - 0.5)
```

Low-confidence `met` is therefore 0.75 and low-confidence `unmet` is 0.25. Every `partial` is 0.5
regardless of confidence. `unknown` is always 0.5.

```text
rawFitScore =
  integerHalfUpRound(
    100 × sum(requirementWeight × effective) / sum(requirementWeight)
  )
```

Evidence gaps do not impose a second hidden penalty. They affect the outcome through explicit
`unknown` classifications and coverage.

## Hard caps

Apply every matching rule and use the lowest cap. Persist every triggering rule in `capReasons`.
“Weight” below means the resolved stored weight after the rank-1 modifier.

| Condition | Maximum |
|---|---:|
| One weight ≥ 4 requirement is `unmet/high` | 24 |
| Two or more weight ≥ 3 requirements are `unmet/high` | 24 |
| One weight ≥ 3 requirement is `unmet/high` | 44 |
| One weight ≥ 4 requirement is `unmet/medium` | 44 |
| A weight ≥ 4 requirement is `unmet/low`, `partial`, or `unknown` | 64 |
| A weight ≥ 3 requirement is `unmet/medium`, `unmet/low`, or `unknown` | 64 |
| A weight ≥ 3 requirement is `met/low` | 79 |
| A weight ≥ 3 requirement is `partial` | 79 |

Weight-based caps protect a rank-1 priority exactly like a base `must_have`. A weight-4
`deal_breaker` also matches weight-3 rules, but lowest-cap-wins makes the stronger critical rule
authoritative.

Price and availability never create a quality cap.

## Tier thresholds

| Tier | Score | Meaning |
|---|---:|---|
| `top_pick` | 80–100 | Strong quality fit; every weight-3-or-higher requirement is confirmed met at medium/high confidence |
| `shortlist` | 65–79 | Good fit with bounded caveats and no confirmed major failure |
| `consider` | 45–64 | Meaningful uncertainty or compromise |
| `unlikely` | 25–44 | A confirmed major failure or poor weighted fit |
| `no_go` | 0–24 | A confirmed critical failure, multiple major failures, or extremely poor fit |

## Coverage and ranking eligibility

```text
coverage = known requirement weight / total requirement weight
```

`met`, `partial`, and `unmet` are known; `unknown` is not.

If coverage is below 0.50, the result gets `rankingStatus: "insufficient_evidence"`. Its calculated
score, tier, cap reasons, and cells remain available for audit, but the UI presents
**Insufficient evidence** and groups the listing outside the peer ranking. Coverage of exactly 0.50
or greater may rank normally.

This prevents an evidence-empty listing with a neutral score from outranking a well-evaluated
listing with documented problems.

## Affordability

The quality verdict and affordability are independent:

```json
{
  "status": "over",
  "budgetAmount": 4500,
  "priceAmount": 4950,
  "currency": "USD",
  "budgetCurrency": "USD",
  "priceCurrency": "USD",
  "basis": "stay",
  "priceBasis": "stay",
  "overByAmount": 450,
  "overByPercent": 10,
  "budgetSource": "explicit",
  "priceSource": "upstream",
  "priceCapturedAt": "2026-07-25T12:00:00Z",
  "freshness": "fresh",
  "rateType": "public",
  "mandatoryChargesResolved": true,
  "availabilityStatus": "yes",
  "availabilityCapturedAt": "2026-07-25T12:00:00Z",
  "availabilityFreshness": "fresh",
  "comparablePrice": {
    "amount": 4950,
    "currency": "USD",
    "basis": "stay",
    "source": "upstream",
    "capturedAt": "2026-07-25T12:00:00Z",
    "freshness": "fresh",
    "rateType": "public",
    "mandatoryChargesResolved": true
  },
  "comparableAvailability": {
    "status": "yes",
    "capturedAt": "2026-07-25T12:00:00Z",
    "freshness": "fresh",
    "reasonCode": "provider_room_inventory"
  }
}
```

An explicit structured budget wins over a budget parsed from the brief. Search `priceMax` is not
silently treated as the analysis budget. A range uses its upper bound. “Slightly over is
acceptable” does not inflate the bound; the result remains visibly over by the computed percentage.

V1 compares exact currency minor units and performs no FX conversion:

```text
within when priceAmount ≤ budgetAmount
overByAmount = priceAmount - budgetAmount
overByPercent =
  halfUpRound(100 × overByAmount / budgetAmount, 2 decimal places)
```

A comparable price must be a public-rate total for the same stay dates and occupancy, in the same
currency and stay basis, with mandatory charges resolved. Fresh/stale is consumed from price
provenance; this rubric does not invent a second TTL.

Availability is an independent booking-eligibility axis. Only a fresh `yes` permits an actionable
affordability comparison. A fresh `no` is excluded from actionable ranking; `partial`, `unknown`,
and stale states remain visible as conditional or unknown. Alternate Airbnb ranges are accepted
only when the provider volunteers them—v1 never probes speculative windows. An Airbnb price quote
does not by itself verify inventory, so Airbnb remains non-actionable `unknown` unless the PDP
provides an explicit availability signal. Fresh-`no` exclusion is therefore Booking-only in the
current v1 evidence set.

Unknown affordability always carries a machine code and user-facing reason. Required examples:

| Code | User-facing reason |
|---|---|
| `no_budget_given` | No analysis budget was given. |
| `price_missing` | Price is missing for the selected stay. |
| `price_stale` | Price is stale (12 days old). |
| `currency_mismatch` | Price currency PLN does not match budget currency USD. |
| `mandatory_charges_unresolved` | Mandatory charges are unresolved in this price. |
| `stay_unavailable` | The property is unavailable for the recorded dates and guest count. |
| `stay_partially_available` | The provider offered only conditional or alternate availability. |
| `availability_stale` | Availability is stale (12 days old). |
| `availability_unknown` | Availability could not be confirmed for the recorded dates and guest count. |

Basis, freshness, invalid-price, and non-public-rate failures have equally specific reasons. The UI
shows the reason after “Budget unknown”; it does not show a bare unknown state.

The default ranking remains quality-first. The native results page also offers an explicit
budget-fit order: `within`, then `over` by ascending percentage, then `unknown`, with the existing
quality order as the tie-breaker. Availability eligibility and comparison-status groups remain
isolated before either ordering is applied. This is not a composite score. Affordability filters
use the listing's current deterministic `within`, `over`, or `unknown` state and can be combined
without changing any quality verdict.

Changing only a structured budget or refreshing a price can recompute affordability without an LLM
call. New rubric results persist the complete comparable-price input used for that calculation.
Budget edits transactionally replace only the `affordability` object; quality classifications,
scores, caps, and tiers stay unchanged. Pre-snapshot and legacy JSON are preserved rather than
reconstructed from guesses. Changing the quality definitions requires a new classification set.

A normalized quality-brief change on a job with completed or partial verdicts durably marks the
job as requiring a regrade. Leading/trailing whitespace and repeated internal whitespace do not
invalidate verdicts. The marker survives queued, running, failed, and partial regrade attempts and
clears only after every listing completes successfully. Structured budget-only edits never set
the marker and never invoke the LLM.

## Legacy and mixed verdicts

Stored JSON without `scoreSource`, `rubricVersion`, and `requirementSetId` is
`scoreSource: "model_legacy"`.

- Preserve legacy JSON; do not silently mutate it or pay to recompute it.
- Display `Legacy AI score`.
- If every result is legacy, preserve the prior score-based display behavior.
- In a mixed job, only deterministic verdicts with the same derived comparability key rank
  together.
- A deterministic verdict without the current `classifierVersion` remains preserved but appears as
  `Classified under an older policy`; it never ranks beside current-policy results.
- Insufficient-evidence, older-policy, legacy, and stale/mismatched-set verdicts appear in labeled
  unranked groups.
- The native results page offers an explicit whole-job regrade with an estimated cost. Regrading
  covers every non-hidden listing, reuses saved review and photo analysis, and runs triage only; at
  the measured ~$0.006/listing, a 54-listing job is estimated at ~$0.32.
- Brief changes, classifier-policy changes, and requirement-set mismatches share one
  `Regrade needed` presentation with distinct reasons. A brief change preserves the prior verdicts
  and paid evidence for audit, labels them as reflecting the previous brief, and excludes them from
  current peer ranks until a fully completed whole-job regrade.
- Never interleave old model-authored or old-classifier scores with current-policy scores.

CLI/report output follows the same source/version and grouping rules.

## Cross-platform identity conflicts

Airbnb and Booking offers are never treated as independent peer evidence when an active
same-property link exposes materially contradictory verdicts. A `likely_same` detector suggestion
or an owner-confirmed link is active; an unconfirmed `possible_same` suggestion is inert. A pair is
materially contradictory when both sides have scored tiers at least two levels apart.

The native results page keeps the offers and their evidence separate, shows them together for
audit, and withholds both from the top-picks hero and comparable peer ranks while the material link
is active. Their matrix rows remain visible in a labeled conflict group with all paid evidence. It
does not merge review corpora, recompute either tier, or use the richer platform's
verdict as a replacement for the thinner one. Dismissing or undoing the link restores the normal
single-listing comparison rules when no active detector suggestion remains; undoing a confirmation
otherwise returns the pair to its current detector state.

## Priorities matrix

The native results page derives one per-job evidence matrix from persisted deterministic triage;
it does not make another model call. `Availability` and `Affordability` are fixed leading axes,
followed by the canonical requirements in their persisted order.

The modal deterministic `requirementSetId` is the active column set. Only verdicts with exact
canonical requirement IDs and the current comparability key populate those columns. A missing ID
stays visibly missing. Insufficient-evidence verdicts keep their auditable cells but remain in a
separate group outside peer ranking. Older-policy, legacy, mismatched-set, and unscored rows are
also labeled and never silently label-aligned into current cells.

When the quality brief changes, the matrix remains visible: its priority columns and verdict labels
say they reflect the previous brief, while evidence snippets, frequencies, years, and sample
provenance remain available as paid audit data. The matrix header hosts the results page's single
whole-job regrade banner, action, and cost estimate.

Each classified priority cell carries:

- status, confidence, note, and evidence gaps;
- all raw matched support and contradiction evidence for drill-down;
- one strongest status-aligned evidence line, preserving model order within a polarity;
- the evidence frequency and years when the classifier supplied them.

For `unmet`, contradiction evidence is strongest; for `met`, support evidence is strongest; for
`partial`, contradiction precedes support. No evidence is synthesized. A missing reviews layer
must say `No review data`.

A ratio such as `42 of 250` in review evidence means **42 mentions among 250 AI-analyzed
reviews**. It is not the provider's hotel review total. The row also exposes, separately, the
number analyzed, the eligible post-filter count, and the total scraped artifact count from
`batch_manifest.json`. When the analysis cap applies, the UI says so explicitly, for example:
`250 analysed (capped from 1,924 eligible) · 2,632 scraped`. If manifest provenance has expired,
these counts remain unknown rather than being guessed from the listing page.

Every evidence axis is sortable. The first click puts risk first, while ranking-status groups stay
isolated. The CLI emits the same versioned read model:

```bash
reviewr report -o data/rome --priorities-matrix
reviewr report -o data/rome --priorities-matrix ./exports/rome-matrix.json
```

Without an explicit file, `priorities-matrix.json` is written beside the HTML report.

## Worked examples

### 1. Clean `top_pick`

| Requirement | Weight | Outcome | Effective | Weighted value |
|---|---:|---|---:|---:|
| Quiet sleep, rank 1 | 3 | `met/high` | 1.0 | 3.00 |
| Comfortable bed, must-have | 3 | `met/high` | 1.0 | 3.00 |
| Blackout conditions | 2 | `met/medium` | 0.875 | 1.75 |
| Workspace | 2 | `met/high` | 1.0 | 2.00 |
| Walkability | 1 | `partial/high` | 0.5 | 0.50 |

Total weighted value is 10.25 of 11. `round(100 × 10.25 / 11) = 93`. Coverage is 11/11 = 1.00.
No cap matches. The final result is **93 / `top_pick` / ranked**.

### 2. Rank-1 priority failure is capped

Sleep quality is explicitly “#1 by far”, so its display type is `priority` but resolved weight is 3.
It is `unmet/high`. Five other satisfied requirements have weights 2, 2, 1, 1, and 1.

```text
rawFitScore = round(100 × 7 / 10) = 70
```

Without the numeric-weight cap, this would be a misleading shortlist. The weight-3 `unmet/high`
rule caps it to 44. Coverage is 1.00. The final result is
**raw 70 → capped 44 / `unlikely` / ranked**.

### 3. Insufficient evidence

| Requirement | Weight | Outcome | Effective | Weighted value |
|---|---:|---|---:|---:|
| Quiet sleep | 3 | `unknown` | 0.5 | 1.50 |
| Comfortable bed | 3 | `unknown` | 0.5 | 1.50 |
| Workspace | 2 | `met/high` | 1.0 | 2.00 |
| Walkability | 2 | `unknown` | 0.5 | 1.00 |

The calculated score is `round(100 × 6 / 10) = 60`, and the calculated tier is `consider`.
Known weight is only 2 of 10, so coverage is 0.20. The final actionable verdict is
**Insufficient evidence / unranked**. The calculated 60 and all cells remain visible for audit.

## Stability acceptance

The issue #62 frozen inputs use the same three listings and one frozen canonical set:

- temperature 0: 3 listings × 5 classifier runs;
- temperature 1.0: 3 listings × 5 classifier runs.

For each listing, requirement ID, and temperature, report the five statuses/confidences, status
distribution, pairwise status flip rate, pairwise confidence flip rate, and modal disagreement.
Report weighted aggregate flips by requirement type.

For every weight-3-or-higher requirement, separately report the
`unmet/high` ↔ `partial/high` pairwise flip rate. This specifically exposes the Candlewood
quiet-sleep drift that can move a verdict across a cap.

Production acceptance at temperature 0 requires:

- all 15 calls succeed on identical frozen inputs and definitions;
- each score remains within 5 points of that listing’s five-run mean;
- the tier is stable across all five runs;
- identical classifications always produce identical code-computed score, caps, and tier;
- residual semantic flips are reported, not hidden with retries, voting, or self-consistency.

Temperature 1.0 is diagnostic only.
