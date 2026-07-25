# Issue #62 deterministic-rubric stability measurement

- Run date: 2026-07-25
- Model: `gemini-3-flash-preview:high`
- Classifier calls: 30/30 completed (3 listings × 5 runs × 2 temperatures)
- Requirement-parser calls: 1, at temperature 0
- Observed retries: 0
- Measured cost: $0.2197

Raw local evidence: `data/experiments/issue-62/rubric-summary.json` and
`data/experiments/issue-62/rubric-runs/` (gitignored working data)

## Acceptance result

**PASS for production temperature 0.**

| Listing | Five final scores | Mean | Maximum absolute deviation | Tiers |
|---|---|---:|---:|---|
| Club Quarters Midtown | 44, 44, 44, 44, 44 | 44 | 0 | `unlikely` ×5 |
| Candlewood Suites | 79, 79, 79, 79, 79 | 79 | 0 | `shortlist` ×5 |
| The Michelangelo | 77, 77, 77, 77, 77 | 77 | 0 | `shortlist` ×5 |

All 15 temperature-0 calls used identical frozen inputs and definitions. Every listing stayed
within five points of its five-run mean and retained one tier. Repeated classification signatures
always produced the same raw score, capped score, cap reasons, coverage, ranking status, and tier;
the invariant-violation count was zero.

Temperature 1 was diagnostic only. It also retained the same final scores and tiers, but it exposed
two underlying outcome variations documented below.

## Frozen requirement set

- Requirement-set ID: `reqset_6b9344b3d4089e4bcad6`

Parser version: `triage-requirements-v1:gemini:gemini-3-flash-preview:high`

| ID | Definition | Type/rank | Weight |
|---|---|---|---:|
| `req-01-quiet-environment` | Quiet Environment | `priority`, rank 1 | 3 |
| `req-02-bed-comfort` | Bed Comfort | `priority`, rank 1 | 3 |
| `req-03-blackout-conditions` | Blackout Conditions | `priority`, rank 1 | 3 |
| `req-04-walkable-location` | Walkable Location | `priority`, rank 3 | 2 |
| `req-05-in-room-workspace` | In-room Workspace | `priority`, rank 3 | 2 |

The separate parsed budget was 3,000–4,500 USD for the full stay. It was not emitted as a quality
requirement and did not contribute to the scores.

## Per-requirement outcomes

Each five-run group has 10 unordered run pairs. `S flips` and `C flips` are status and confidence
pairwise flips. `S modal` and `C modal` are runs disagreeing with the modal status and confidence,
out of five. `UH↔PH` is the specifically requested `unmet/high` ↔ `partial/high` pairwise count;
it applies only to weight-3-or-higher rows.

### Temperature 0

| Listing | Requirement (weight) | Five status/confidence outcomes | Status distribution | Confidence distribution | S flips | C flips | S modal | C modal | UH↔PH |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| Club Quarters | Quiet (3) | `unmet/high` ×5 | unmet 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Club Quarters | Bed (3) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Club Quarters | Blackout (3) | `partial/medium` ×5 | partial 5 | medium 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Club Quarters | Walkability (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |
| Club Quarters | Workspace (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |
| Candlewood | Quiet (3) | `partial/high` ×5 | partial 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Candlewood | Bed (3) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Candlewood | Blackout (3) | `met/medium` ×5 | met 5 | medium 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Candlewood | Walkability (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |
| Candlewood | Workspace (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |
| Michelangelo | Quiet (3) | `partial/high` ×5 | partial 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Michelangelo | Bed (3) | `partial/high` ×5 | partial 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Michelangelo | Blackout (3) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Michelangelo | Walkability (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |
| Michelangelo | Workspace (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |

Temperature 0 therefore had zero status flips, zero confidence flips, and zero modal
disagreements across all 15 listing/requirement groups.

### Temperature 1

| Listing | Requirement (weight) | Five status/confidence outcomes | Status distribution | Confidence distribution | S flips | C flips | S modal | C modal | UH↔PH |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| Club Quarters | Quiet (3) | `unmet/high` ×5 | unmet 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Club Quarters | Bed (3) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Club Quarters | Blackout (3) | `unknown/low`, then `partial/medium` ×4 | unknown 1; partial 4 | low 1; medium 4 | 4/10 | 4/10 | 1/5 | 1/5 | 0/10 |
| Club Quarters | Walkability (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |
| Club Quarters | Workspace (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |
| Candlewood | Quiet (3) | `partial/high` ×5 | partial 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Candlewood | Bed (3) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Candlewood | Blackout (3) | `met/medium` ×5 | met 5 | medium 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Candlewood | Walkability (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |
| Candlewood | Workspace (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |
| Michelangelo | Quiet (3) | `partial/high` ×5 | partial 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Michelangelo | Bed (3) | `partial/medium`, `partial/high`, then `partial/medium` ×3 | partial 5 | medium 4; high 1 | 0/10 | 4/10 | 0/5 | 1/5 | 0/10 |
| Michelangelo | Blackout (3) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | 0/10 |
| Michelangelo | Walkability (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |
| Michelangelo | Workspace (2) | `met/high` ×5 | met 5 | high 5 | 0/10 | 0/10 | 0/5 | 0/5 | — |

## Aggregate flips

All frozen definitions happened to retain display type `priority`, so this run has one type bucket.
Weighting each pairwise observation by the definition's resolved numeric weight gives:

| Temperature | Weighted pair denominator | Weighted status flips | Weighted status flip rate | Weighted confidence flips | Weighted confidence flip rate |
|---|---:|---:|---:|---:|---:|
| 0 | 390 | 0 | 0% | 0 | 0% |
| 1 | 390 | 12 | 3.08% | 24 | 6.15% |

At temperature 1, the 12 weighted status-flip units are the four Club Quarters blackout pair
flips multiplied by weight 3. The 24 weighted confidence-flip units add four Michelangelo bed
confidence flips, also at weight 3.

## Explicit major-cap transition audit

There were nine weight-3 listing/requirement groups per temperature, or 90 unordered pairs.
The requested `unmet/high` ↔ `partial/high` count was:

| Temperature | Special flips |
|---|---:|
| 0 | 0/90 (0%) |
| 1 | 0/90 (0%) |

In particular, Candlewood Quiet remained `partial/high` in all 10 classifications across both
temperatures: 0/10 special flips at temperature 0 and 0/10 at temperature 1. The previously
observed cap-crossing semantic drift did not recur under the frozen-set classifier.

## Input identity

Brief SHA-256:
`73eb169ca67f82d8610d77ca50e2a8e8d71d76342308c39501b5423e16627263`

| Input | SHA-256 |
|---|---|
| Candlewood listing | `9a42c0a2fc34309e9b153163f37eacaa29cd651dc8ff748027e440f5814f21b1` |
| Candlewood photos | `0b4572f4718fab6897bad4ac44770d803a02e65b3d9a371cc575693417cab296` |
| Candlewood reviews | `d59049edc43c1e2da8b786b868504ef6f2990c125d8e1eb533b8a6628cb1b0dd` |
| Club Quarters listing | `11b8291a020f52b4a1ad1f5cfcd9f341432d2c040e6407cd3cb7de3c2a68ab5e` |
| Club Quarters photos | `dd084eec987e32c088c142a21af9e484a27c228c93c02fd65b6d0a8b90e1d9b9` |
| Club Quarters reviews | `cb2cd46f41cc0f4e6cd509ee32e7c7f167bc7b328398b096a1cc1af99eecb3f3` |
| Michelangelo listing | `0d13115670d8e770368b5dd7fe3b513ebd483bbc4ad3750284a7a68c2254af25` |
| Michelangelo photos | `a362c9c1fbbfcbdd2de458590b008d3384803e7ac492a6575306ab0448d3573e` |
| Michelangelo reviews | `92e25997b04277044d8271d158c41c4cbc0a67db76f63e6eee9407c4bef1d16a` |
