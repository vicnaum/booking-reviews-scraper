# Agent notes — reviewr / StayReviewr

**Start here: `docs/codex-onramp.md`** — full project context, current delivery plan, task queue,
file map, and gotchas. Written 2026-07-23.

Quick facts:

- Two products in one repo: `src/` — the `reviewr` CLI (Booking.com + Airbnb scraping + AI
  analysis pipeline); `web/` — StayReviewr, a Next.js 15 app with persistent review jobs
  (Prisma/Postgres + BullMQ/Redis worker wrapping the CLI pipeline).
- Verify with `pnpm run build` and `pnpm test` at repo root (root is **pnpm**); `web/` is
  **npm** and has its own build. Never generate a root `package-lock.json`.
- Work in feature branches, PR to `main`.
- **Isolation worktrees live in `~/github/.worktrees/reviewr/issue-NN`** — never as siblings of
  the repo in `~/github/` (they clutter the user's folder). Each costs ~1 GB of `node_modules`,
  so **remove yours as soon as its PR merges**: `git worktree remove --force <path>` plus
  `git branch -D <branch>`. Skip `npm ci` in `web/` unless the change actually touches `web/`.
- Concurrent agent sessions coordinate via `agent-chat` (project room; an `orchestrator` agent
  may be active — DM it with `agent-chat send "msg" --to orchestrator`).
- `data/` is gitignored working data (trip inputs in `data/trips/`). Scrape/AI output layout:
  `listings/`, `reviews/`, `photos/{id}/`, `ai-reviews/` per batch manifest v2.
- Booking hotel pages are AWS-WAF-protected — Playwright only; Airbnb uses raw HTTP/GraphQL.
  Both integrations are fragile; if scraping fails, suspect site changes first.
