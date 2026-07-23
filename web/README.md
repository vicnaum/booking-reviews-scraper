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
