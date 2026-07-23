# Agent notes — reviewr / StayReviewr

**Start here: `docs/codex-onramp.md`** — full project context, current delivery plan, task queue,
file map, and gotchas. Written 2026-07-23.

Quick facts:

- Two products in one repo: `src/` — the `reviewr` CLI (Booking.com + Airbnb scraping + AI
  analysis pipeline); `web/` — StayReviewr, a Next.js 15 app with persistent review jobs
  (Prisma/Postgres + BullMQ/Redis worker wrapping the CLI pipeline).
- Verify with `npm run build` and `npm test` (repo root; `web/` has its own build).
- Work in feature branches, PR to `main`.
- Concurrent agent sessions coordinate via `agent-chat` (project room; an `orchestrator` agent
  may be active — DM it with `agent-chat send "msg" --to orchestrator`).
- `data/` is gitignored working data (trip inputs in `data/trips/`). Scrape/AI output layout:
  `listings/`, `reviews/`, `photos/{id}/`, `ai-reviews/` per batch manifest v2.
- Booking hotel pages are AWS-WAF-protected — Playwright only; Airbnb uses raw HTTP/GraphQL.
  Both integrations are fragile; if scraping fails, suspect site changes first.
