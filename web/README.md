# StayReviewr Web

## Local queued-search stack

This web app now has two search paths:

- `POST /api/quick-search`: synchronous viewport search, no Postgres/Redis required
- `POST /api/search`: queued full search, requires Postgres + Redis + worker

### Start infra

```bash
cd web
docker compose up -d
```

### Initialize Prisma schema

```bash
cd web
npm run db:push
```

### Run the app

In one terminal:

```bash
cd web
npm run worker
```

In another terminal:

```bash
cd web
npm run dev
```

### Required env vars

`web/.env.local` should contain:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/stayreviewr?schema=public
REDIS_URL=redis://127.0.0.1:6379
USE_PROXY=false
```
