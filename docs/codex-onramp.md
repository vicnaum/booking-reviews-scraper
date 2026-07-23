# Codex Onramp — StayReviewr delivery (July 2026)

Welcome. This doc gets you from zero to productive on this repo. Written 2026-07-23 by the
orchestrator agent (a Claude Code session registered as `orchestrator` on agent-chat) after a
full status reconstruction from git history, docs, and the March 2026 work sessions.

## Cast & coordination

- **Victor** — the user. Decisions about scope go to him.
- **orchestrator** — Claude Code session coordinating this delivery. Talks to you via agent-chat.
- **You (Codex)** — implementation.

Coordination protocol:

```bash
agent-chat register codex                 # join the project room
agent-chat send "msg"                     # post to the project room
agent-chat send "msg" --to orchestrator   # DM the orchestrator (wakes it)
agent-chat read                           # pull unread messages
```

Announce before schema/format changes, announce task claims and completions. Work in feature
branches, PR to `main` (repo convention — see PRs #26, #27). Run `npm run build` and `npm test`
before declaring anything done.

## What this product is

**reviewr** — a TypeScript CLI that scrapes Booking.com + Airbnb listings/reviews/photos and runs
an AI analysis pipeline (review analysis → photo analysis → triage/scoring) producing ranked
recommendations. Mature and working as of March 2026.

**StayReviewr** (`web/`) — a Next.js 15 (App Router, React 19, Tailwind v4) web app on top of the
CLI: shared Airbnb+Booking map search (react-leaflet + Zustand), persistent **review jobs**
(Prisma/Postgres), a BullMQ/Redis worker (`web/src/lib/search-worker.ts`) that runs the CLI batch
pipeline per job with per-phase progress, and a native results page (ranking, map, POI distance
sort/filter, compare). Near-feature-complete; milestones 1, 2, 4 of `docs/review-job-roadmap.md`
done, milestone 3 "mostly complete".

**Goal now: reliable personal daily-driver.** NOT public/multi-user. Explicitly deferred: real
auth (browser `ownerKey` stays), deployment/hosting, rate limiting, issue #25, issue #24.

## State as of 2026-07-23

- `main` @ PR #27 merged: AI cost tracking (per-phase cost columns on `ReviewJob` +
  `ReviewJobListingAnalysis`, worker aggregation, cost pills in UI) + photo media resolution
  HIGH→MEDIUM. Build + all 37 tests were green when that work finished (2026-03-16).
- **The repo has been dormant since 2026-03-16.** Nothing verified since.
- Known cost profile (measured 2026-03-15): $3.75 across 3 jobs — photos AI $2.32 (62%),
  triage $0.82, reviews AI $0.62. One listing pushed 1,722 reviews through filters to the model.
- Open issues: #23 (cross-job scrape cache), #25 (split cached extraction vs prompt reasoning —
  deferred), #24 (artifacts as optional exports — deferred).

## Your task queue (priority order)

### Task 1 — Bitrot smoke test (GATING — do first)
Booking's WAF bypass and Airbnb's GraphQL usage were reverse-engineered in Feb/Mar 2026 and are
4 months stale. Run one tiny end-to-end job (one Booking + one Airbnb listing, full pipeline
through triage — CLI `reviewr batch` is enough; sample URLs in `data/trips/testlinks.txt`) and fix
what broke. Everything else sits on the scrapers, so nothing outranks this. Report findings to
orchestrator before starting fixes if the breakage is large (scope decision).

### Task 2 — One-command startup
Today a full run needs Postgres + Redis + Next dev server + worker started by hand. Add
`docker-compose.yml` (Postgres, Redis) and a single `npm run up` (migrate → web → worker via
concurrently or similar). Acceptance: fresh clone + `.env` + one command = working app.

### Task 3 — Cost guardrails
1. Post-filter hard cap on reviews sent to AI (~200–300/listing, configurable) — planned in
   March, never built.
2. Per-job cost ceiling: pause/stop the analysis phase when accumulated cost exceeds a
   configurable budget. Per-phase costs are already persisted, so this is mostly wiring.

### Task 4 — Issue #23: cross-job cache
Cache listing details/reviews/photos across jobs so re-running a city you already scraped is
near-free and fast. Repeat runs on the same destination are the real usage pattern.

## Key files map

- `src/cli.ts` — unified CLI (Commander, bin `reviewr`); `src/batch.ts` — batch pipeline;
  `src/analyze.ts` / `analyze-photos.ts` / `triage.ts` — AI phases; `src/report.ts` — legacy
  HTML report (behavioral reference for the native results page).
- `src/booking/` — Playwright-based (hotel pages are AWS-WAF-protected; review list pages work
  with plain HTTP+proxy). `src/airbnb/` — raw HTTP/GraphQL.
- `web/prisma/schema.prisma` — `ReviewJob`, `ReviewJobListing`, `ReviewJobListingAnalysis`,
  `ReviewJobEvent` (+ older `SearchJob`/`SearchResult`). Postgres (`dev.db` was a stray, deleted).
- `web/src/lib/` — `search-worker.ts` (BullMQ worker, the heart), `reviewJobs.ts`,
  `review-job-batch-analysis.ts`, `aiCosts.ts`.
- `web/src/app/` — `/` landing+map, `/jobs/[jobId]` workspace, `/jobs/[jobId]/results`,
  API under `/api/` (jobs, search, quick-search, geocode, export, SSE stream).
- Docs worth reading: `web/README.md` (how to run), `docs/review-job-roadmap.md`,
  `docs/review-job-analysis-parity.md` (CLI↔worker behavior parity rules),
  `docs/pricing-audit.md`, `docs/ai-api-pricing-feb2026.md`.

## Gotchas

- **Package managers differ by directory**: repo root is **pnpm** (`pnpm-lock.yaml` tracked —
  use `pnpm install` / `pnpm run build` / `pnpm test`); `web/` is **npm**
  (`web/package-lock.json` tracked). Never generate a root `package-lock.json`.
- Proxy config resolution: CLI flag → env → local `.env` → `~/.config/reviewr/.env` → none
  (`src/config.ts`, lazy `getProxyConfig()`).
- AI photos + triage are currently **Gemini-only**; review analysis is provider-configurable
  (`parseModelConfig` in `src/analyze.ts`).
- Photo analysis uses Gemini `mediaResolution: MEDIUM` — do not raise without a cost discussion.
- Pre-existing harmless TS error: turf types in `src/airbnb/hosts-finder.ts` (~line 217).
- `data/` is gitignored working data; trip inputs live in `data/trips/`.
- Batch output uses v2 manifest subdirs: `listings/`, `reviews/`, `photos/{id}/`, `ai-reviews/`.
