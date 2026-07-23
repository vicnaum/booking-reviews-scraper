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

`web/.env.local` remains supported as a compatibility fallback for direct `web/` commands, but
the root `.env` takes precedence. Proxy settings also fall back to
`~/.config/reviewr/.env` created by `reviewr auth`.
