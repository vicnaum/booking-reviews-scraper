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
REVIEWR_CACHE_DETAILS_TTL_DAYS=7
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
uses 7-day details, 30-day reviews, and 180-day photos; full run bundles retain for 30 days. Disk
therefore grows in both the cache and `STAYREVIEWR_ARTIFACT_DIR`. The cache has no global size cap,
but both stores are disposable because Postgres holds product state and live scraping can recreate
inputs.

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
