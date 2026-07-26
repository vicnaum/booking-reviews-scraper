# StayReviewr Web

## Local queued-search stack

This web app now has two search paths:

- `POST /api/quick-search`: synchronous viewport search, no Postgres/Redis required
- `POST /api/search`: queued full search, requires Postgres + Redis + worker

### Start everything

From the repository root:

```bash
cp .env.example .env
# Add GEMINI_API_KEY and optional proxy credentials to .env.
npm run up
```

`npm run up` checks Docker, installs missing root and web dependencies, installs Playwright
Chromium when needed, waits for Postgres and Redis to become healthy, synchronizes the Prisma
schema, and then runs the Next.js app and BullMQ worker together. Open
<http://localhost:3000>.

The worker launched by `npm run up` intentionally does not watch the filesystem. Changes under
`data/`, `web/data/`, logs, caches, or a Git pull cannot restart it in the middle of a queued or
paid AI job. To load worker code changes, wait for active jobs to finish and deliberately restart
`npm run up`. Use `npm --prefix web run worker:dev` only for interactive worker development where
watch-mode restarts are expected.

Press Ctrl-C to stop the app and worker. The data services stay available between runs; stop
them with:

```bash
npm run down
```

All app, worker, database, Redis, AI, and proxy settings live in the repository-root `.env`.
The local service defaults are:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/stayreviewr?schema=public
REDIS_URL=redis://127.0.0.1:6379
```

The analysis cost guardrails are also configured there:

```dotenv
AI_REVIEW_MAX_REVIEWS=250
STAYREVIEWR_AI_JOB_BUDGET_USD=5
```

The first value caps the most recent eligible reviews sent to AI per listing. The second is
the maximum persisted AI spend per analysis run; use `0` to disable that ceiling. A run that
reaches the ceiling stops before its next AI call and keeps its completed artifacts as partial
results.

Details, reviews, and downloaded photos are reused across jobs through the same cache as the
CLI:

```dotenv
REVIEWR_CACHE_DIR=~/.cache/reviewr/artifacts-v1
REVIEWR_CACHE_DETAILS_TTL_DAYS=1
REVIEWR_CACHE_REVIEWS_TTL_DAYS=30
REVIEWR_CACHE_PHOTOS_TTL_DAYS=180
```

Set an artifact TTL to `0` to disable it. Cache reads and writes fail open, so a missing,
deleted, or corrupt cache simply triggers the normal scraper. The v1 cache grows without a
size limit; removing the configured `REVIEWR_CACHE_DIR` is always safe.

Each review analysis also writes an optional durable debug/export run:

```dotenv
STAYREVIEWR_ARTIFACT_DIR=data/review-jobs
STAYREVIEWR_ARTIFACT_RETENTION_DAYS=30
```

Relative paths resolve from the repository root, and the configured root must be a dedicated
subdirectory (broad paths such as `/`, the home directory, or the repo root are rejected). Postgres
remains the source of truth for native results, progress, and costs; deleting or expiring a run
only removes its ZIP and legacy HTML/file exports. The worker cleans expired runs at startup and
before each analysis and logs the run count and bytes freed. A retention value of `0` keeps runs
indefinitely. Existing jobs whose old OS-temp runs have already vanished are not reconstructed;
their Postgres-backed native results remain available.

The job and results pages offer a streamed ZIP when the current run still exists. Cleanup can also
be inspected and applied directly:

```bash
cd web
npm run cleanup:artifacts             # dry run
npm run cleanup:artifacts -- --apply  # remove expired runs
```

Per-job runs deliberately duplicate some scrape files held by the cross-job cache. Cache freshness
uses 1-day details, 30-day reviews, and 180-day photos; full run bundles retain for 30 days. Disk
therefore grows in both the cache and `STAYREVIEWR_ARTIFACT_DIR`. The cache has no global size cap,
but both stores are disposable because Postgres holds product state and live scraping can recreate
inputs.

## Exact-stay price and availability snapshots

Each analyzed listing stores one public snapshot for the job's exact check-in, check-out, adult
count, platform listing ID, and Booking room selection. The snapshot contains a numeric
platform-currency full-stay price when available plus an independent provider availability state:
`yes`, `no`, `partial`, or `unknown`. `unknown` means the request or extraction did not confirm
inventory; it is never silently converted to `no`.

Freshness is derived when a job is read from the snapshot's `capturedAt` and the same
`REVIEWR_CACHE_DETAILS_TTL_DAYS` policy used by the details cache. There is no separate price TTL
or stored expiry. Legacy details without snapshot timestamps remain visibly unknown.

Owners can refresh every listing or the current shortlist from either job page. This queue action
bypasses only details-cache reads, publishes successful details to the normal cache, and does not
rerun reviews, photos, AI review/photo analysis, or quality classification. A failed listing keeps
its last known snapshot and records the attempt time and error. Partial runs report succeeded and
failed counts. Affordability is recomputed deterministically from the refreshed public stay price
and availability; the independent quality score and tier remain unchanged.

A fresh `no` is excluded from actionable ranking. `partial`, `unknown`, and stale availability
remain visible as conditional or unknown. Signed-in and Genius rates may be lower than the public
snapshot.

Airbnb v1 is deliberately conservative: an exact-date PDP price quote is retained as price
evidence but is not promoted to verified inventory. Airbnb availability therefore remains
`unknown` unless Airbnb itself emits an explicit refusal or a provider-volunteered alternate
range. Search inclusion is not treated as proof. In current fixtures, fresh-`no` exclusion is
therefore exercised by Booking.

One job represents one date range. Multi-leg trips require a separate job for each leg; issue #70
tracks first-class multi-leg support.

`web/.env.local` remains supported as a compatibility fallback for direct `web/` commands, but
the root `.env` takes precedence. Proxy settings also fall back to
`~/.config/reviewr/.env` created by `reviewr auth`.

Historical jobs created before AI cost columns can be inspected and repaired from their retained
`batch_manifest.json` files:

```bash
cd web
npm run backfill:ai-costs             # dry run
npm run backfill:ai-costs -- --apply  # persist zero-cost jobs only
```

The one-shot backfill skips jobs that already have costs or lack a readable manifest, updates
matching per-listing analyses and job totals transactionally, and records an audit event.
