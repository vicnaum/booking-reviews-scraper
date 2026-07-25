# Triage classifier boundary evaluation — issue #69

Measured 2026-07-25 with `gemini-3-flash-preview:high`, the frozen issue #62
requirement set `reqset_6b9344b3d4089e4bcad6`, temperature 0, and the exact stay context
2026-07-29 → 2026-08-11 (13 nights, 2 adults, New York City).

## Hand-labeled set

The tracked fixture
`tests/fixtures/triage-boundary-eval.json` contains 15 listing/requirement pairs: all five
canonical requirements for Candlewood Suites, Club Quarters Midtown, and The Michelangelo. Each
label includes its adjudication rationale, decisive evidence excerpts, and SHA-256 hashes for the
original listing, review-analysis, and photo-analysis artifacts.

Five pairs exercise a non-`met` boundary:

| Listing | Requirement | Hand label | Why |
|---|---|---|---|
| Candlewood Suites | Quiet environment | `unmet` | 42/250 recurring sleep-disrupting HVAC reports; turning it off is not a usable 13-night summer mitigation |
| Club Quarters | Quiet environment | `unmet` | 68/250 mechanical/street-noise reports, including noise with AC off |
| Club Quarters | Blackout conditions | `partial` | naturally dark rooms plus a bounded Roman-shade leakage caveat |
| The Michelangelo | Quiet environment | `unmet` | recurring tractor-like/whistling HVAC and mechanical noise |
| The Michelangelo | Bed comfort | `partial` | strong 8.9 aggregate comfort signal plus 8/205 recent sagging/broken-coil complaints |

The other ten positive controls are the clearly supported bed, blackout, walkability, and workspace
requirements. They prevent a stricter prompt from appearing better merely by changing every
ambiguous result to `unmet`.

## Before and after

The reproducible runner is `tests/evals/run-triage-boundary-eval.ts`. It calls the exact preserved
v1 prompt and the candidate v2 prompt over the same artifacts.

| Policy | Overall | Non-`met` boundary | Candlewood | Club Quarters | Michelangelo |
|---|---:|---:|---|---|---|
| `triage-classifier-v1` | 13/15 (86.7%) | 3/5 (60%) | 79 / `shortlist` | 44 / `unlikely` | 77 / `shortlist` |
| `triage-classifier-v2` | 15/15 (100%) | 5/5 (100%) | 44 / `unlikely` | 44 / `unlikely` | 44 / `unlikely` |

The two v1 errors were exactly the issue #69 failures: Candlewood and Michelangelo quietness were
`partial/high` instead of `unmet/high`. V2 corrected both and retained every positive and genuinely
mixed control.

V2 makes the decision explicit:

- recurring meaningful or severe confirmed failure is `unmet`; a majority is not required;
- `partial` requires genuinely mixed evidence or a specific, verifiable, stay-available way to
  avoid the failure;
- turning off a needed system, tolerating the problem, or hoping for another room is not avoidance;
- `unknown` remains the result for missing or too-vague evidence;
- dates, destination, length, and guest count may condition mitigation relevance without inventing
  weather, inventory, or provider policy.

The prompt includes three real frozen examples: Candlewood quiet (`unmet`), Club Quarters blackout
(`partial`), and Michelangelo bed comfort (`partial`).

## Stability rerun

`tests/evals/run-triage-stability.ts` repeated the original issue #62 matrix: three listings × five
runs at temperature 0 and temperature 1, for 30 completed calls. It also validates the invariant
that an identical classification signature always yields the same deterministic verdict.

| Temperature | Club Quarters | Candlewood | Michelangelo | Weighted status flips | Weighted confidence flips | `partial/high ↔ unmet/high` | Invariant violations |
|---:|---|---|---|---:|---:|---:|---:|
| 0 | 44 × 5 / `unlikely` | 44 × 5 / `unlikely` | 44 × 5 / `unlikely` | 0/390 (0%) | 0/390 (0%) | 0 | 0 |
| 1 | 44 × 5 / `unlikely` | 44 × 5 / `unlikely` | 44 × 5 / `unlikely` | 0/390 (0%) | 24/390 (6.15%) | 0 | 0 |

Maximum absolute score deviation was 0 for every listing at both temperatures. The production
temperature-zero acceptance gate passed.

One preliminary temperature-one response returned a duplicate requirement ID and was rejected
before scoring. The resumed 30-call matrix above contains only valid completed calls. The runner is
now resumable and records any such rejected attempts; production classification remains
temperature 0.

## Comparability and migration

V2 verdicts persist:

- `classifierVersion: "triage-classifier-v2"`;
- `modelId` for audit;
- the unchanged deterministic rubric version and canonical requirement-set ID.

The sole comparison key is
`rubricVersion + requirementSetId + classifierVersion`. `modelId` is intentionally excluded.
Existing deterministic JSON without `classifierVersion` is preserved and shown as classified under
an older policy, with a triage-only whole-job regrade action and an estimated cost of
about $0.006/listing. The scope and estimate include every non-hidden listing in the job, not only
the stale verdicts that triggered the warning.
