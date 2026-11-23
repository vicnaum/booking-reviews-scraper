# reviewr — AI Hotel & Airbnb Comparison Agent

An AI skill for Claude that compares hotel and rental listings from Booking.com and Airbnb. Give it a bunch of URLs, tell it your priorities, and get back a detailed HTML report with scores, photos, review analysis, and a recommendation on where to book.

Built on top of a TypeScript CLI toolkit (`reviewr`) that handles review scraping, listing detail extraction, analytics, and host discovery.

The code is distributed as-is, no warranties or what-so-ever.

## How It Works

Paste multiple Booking.com and/or Airbnb listing URLs into Claude and ask it to compare them. The agent will:

1. **Ask about your preferences** — travel dates, priorities (noise, cleanliness, location, bed type, etc.), and deal-breakers
2. **Scrape listing details and reviews** for each property via the `reviewr` CLI
3. **Normalize scores** across platforms (Booking.com 0–10, Airbnb 0–5 scaled to 0–10)
4. **Mine review text** for mentions relevant to your priorities (noise complaints, bed quality, pests, etc.)
5. **Analyze photos** to assess renovation state, bed type, and general vibe
6. **Score and rank** properties using weighted dimensions based on your priorities
7. **Filter out** properties that fail your deal-breakers (bed bugs, wrong bed type, no AC, etc.)
8. **Generate an HTML report** with property cards, photo embeds, a side-by-side comparison table, and a final recommendation

## Install the Skill

### Claude Desktop App

1. Download [`skills/reviewr/SKILL.md`](skills/reviewr/SKILL.md) from this repo
2. In Claude Desktop, go to **Settings > Capabilities**
3. Ensure **"Code execution and file creation"** is enabled
4. In the **Skills** section, click **"Upload skill"** and select the `SKILL.md` file
5. Toggle the skill on

The skill will now activate automatically when you paste property URLs or ask Claude to compare listings.

> Requires a Claude Pro, Max, Team, or Enterprise plan.

### Claude Code (CLI)

Copy the skill folder into your personal skills directory:

```bash
cp -r skills/reviewr ~/.claude/skills/reviewr
```

Or for project-scoped use, keep it in your repo's `skills/` directory — Claude Code auto-discovers skills there.

### CLI Setup

The skill uses the `reviewr` CLI under the hood. Install it:

```bash
git clone https://github.com/vicnaum/booking-reviews-scraper.git
cd booking-reviews-scraper
pnpm install
npx playwright install chromium   # Required for Booking.com listing details
pnpm build && npm link            # Makes `reviewr` available system-wide
```

Configure proxy (optional, needed for some regions):

```bash
reviewr auth https://user:pass@host:port  # Save HTTP or HTTPS proxy config
reviewr auth                               # Check status
```

### Run StayReviewr locally

The web app, queue worker, Postgres, and Redis start together from the repository root:

```bash
cp .env.example .env
# Add GEMINI_API_KEY and optional proxy credentials to .env.
npm run up
```

Open <http://localhost:3000>. Press Ctrl-C to stop the app and worker, then run
`npm run down` when you also want to stop Postgres and Redis. `pnpm run up` and
`pnpm run down` are equivalent.

The worker in `npm run up` is deliberately non-watching so artifact writes and Git operations
cannot restart it during paid jobs. After changing worker code, wait for active jobs to finish
and restart the stack manually. The separate `npm --prefix web run worker:dev` command retains
watch mode for interactive development.

## CLI Reference

The `reviewr` CLI can also be used standalone, outside of the AI skill. It auto-detects the platform from the URL.

```bash
# Single URL — fetch listing details (auto-detects platform)
reviewr https://www.booking.com/hotel/pl/example.html
reviewr https://www.airbnb.com/rooms/12345
reviewr https://www.airbnb.com/rooms/12345 --download-photos

# Fetch reviews
reviewr reviews https://www.booking.com/hotel/pl/example.html
reviewr reviews https://www.airbnb.com/rooms/12345 -p    # Print to stdout

# Listing details with pricing
reviewr details "<url>" --checkin 2026-03-29 --checkout 2026-04-04

# Batch workflow: scrape + AI analysis + triage
reviewr batch urls.txt --checkin 2026-03-16 --checkout 2026-03-21 --adults 3 \
  --priorities "quiet, modern, double bed" -o data/rome

# Run specific AI phases on existing data
reviewr batch --retry --ai-reviews -o data/rome
reviewr batch --retry --triage --priorities "quiet, elevator" -o data/rome

# Generate interactive HTML report
reviewr report -o data/rome

# Also write the versioned per-priority evidence matrix as JSON
reviewr report -o data/rome --priorities-matrix

# Ask follow-up questions about shortlisted properties
reviewr ask "Is there free parking? ZTL zone?" --picks liked -o data/rome
reviewr ask "How noisy at night?" --ids 12345,mamomi-house -o data/rome

# Add URLs to an existing StayReviewr job and analyze only the new listings
STAYREVIEWR_OWNER_KEY="<stayreviewr_owner cookie>" \
  reviewr job add <job-id> \
  "https://www.booking.com/hotel/us/hotel-hugo.html" \
  "https://www.airbnb.com/rooms/12345"

# Analytics
reviewr analytics --booking
reviewr analytics --airbnb --12m

# Find hosts/agencies in a location (Airbnb only)
reviewr hosts "Gdansk, Poland"
```

### Run without installing

```bash
npx tsx src/cli.ts <command> [options]
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `reviewr <url>` | Fetch listing details (both platforms) |
| `reviewr reviews <url>` | Fetch reviews (both platforms) |
| `reviewr details <url>` | Fetch listing details with pricing options |
| `reviewr batch [files...]` | Batch fetch details, reviews, photos, and AI analysis |
| `reviewr analyze <file>` | AI review analysis for a single listing |
| `reviewr analyze-photos <dir>` | AI photo analysis using Gemini vision |
| `reviewr triage <file>` | AI triage -- grade listing against guest priorities |
| `reviewr ask <question>` | Ask a question about shortlisted properties |
| `reviewr job add <job-id> <urls...>` | Add URLs to a persistent StayReviewr job and analyze only new listings |
| `reviewr report` | Generate HTML report; add `--priorities-matrix [file]` for the evidence matrix JSON |
| `reviewr scrape [path]` | Batch scrape reviews from CSV files |
| `reviewr analytics [path]` | Run analytics on JSON output |
| `reviewr transform [path]` | JSON to CSV (Booking only) |
| `reviewr search --platform booking\|airbnb ...` | Search listings by location, Booking destination or bounding box (see below) |
| `reviewr hosts <location>` | Find hosts/agencies (Airbnb only) |
| `reviewr parse-hosts [path]` | Parse host HTML pages (Airbnb only) |
| `reviewr auth [proxy-url]` | Configure/check proxy |

## Booking.com search

```bash
# Booking destination (city / district / region) — resolved via Booking's own autocomplete
reviewr search --platform booking --location "Gdańsk Old Town" \
  --checkin 2026-12-08 --checkout 2026-12-10 --adults 2 --currency PLN --max-results 500

# Known destination id (dest type defaults to city)
reviewr search --platform booking --dest-id 6744 --dest-type district --checkin ... --checkout ...

# Map area: --bbox neLat,neLng,swLat,swLng (quick: up to ~1000 results per query)
reviewr search --platform booking --bbox 54.3545,18.67,54.3345,18.65 \
  --checkin 2026-12-08 --checkout 2026-12-10 --adults 2 --currency PLN --max-results 1000

# Full coverage of a large area: quadrant subdivision whenever Booking's ~1000-row cap is hit
reviewr search --platform booking --bbox ... --exhaustive --max-results 5000
```

Output: `search-results.json` + `search-urls.txt` in `--output-dir` (default `data/`). Each
result has the property `id`, `url`, `name`, `coordinates`, `pricing` (total for the dates,
derived nightly), `rating`, `reviewCount`, `propertyType` (Booking accommodation type id),
bedrooms/beds/bathrooms, `stars`, `freeCancellation` and `hostType` (`PROFESSIONAL` /
`PRIVATE`; Booking's search results do not expose the host or operator name).

How it works:

- A proxied Playwright browser warms up on the homepage, then opens the real searchresults page.
  It runs with `--disable-blink-features=AutomationControlled`; without it booking.com redirects
  city/district result pages to SEO landing pages (`/city/pl/gdansk.html`).
- `--location` (without `--bbox`) goes through Booking's AutoComplete. The first non-hotel
  suggestion whose name/city contains every word of the query is used. If Booking has no such
  destination (e.g. "Gdańsk Śródmieście" — Booking only knows Gdynia's Śródmieście), the
  location is geocoded with OpenStreetMap and searched as a bounding box. `--exhaustive`
  always geocodes `--location` to a bbox.
- Results come from Booking's `FullSearch` GraphQL operation. booking.com's page now sends it with
  the full query text (the old persisted-query hashes return `PersistedQueryNotFound`). Each
  session captures the request the page itself sends and replays it from inside the page, with
  100 rows per request and offset pagination. Bounding boxes use `destType: BOUNDING_BOX` in
  the same operation. The last captured request is cached in
  `~/.config/reviewr/booking-search-template.json` for sessions where the page does not send
  FullSearch. If a cached query is rejected, it is refreshed from a new session.
  `BOOKING_SEARCH_TEMPLATE=cache` prefers the cached template (debugging aid).
- Multi-page searches sort by price, because Booking's default ranking reshuffles between pages
  (~25% duplicates). Override with `BOOKING_SEARCH_SORTER` (e.g. `popularity`, empty for
  Booking's default).
- Booking search refuses to run without a proxy unless you pass `--no-proxy` (or set
  `BOOKING_ALLOW_NO_PROXY=true`, e.g. for the web app).
  `BOOKING_SEARCH_DELAY_MS` adds extra delay between requests. Per-search JSONL logs go to
  `data/booking/search-logs/` (`BOOKING_SEARCH_LOG_DIR`, `BOOKING_SEARCH_LOG=false`).

## Global Flags

| Flag | Description |
|------|-------------|
| `-p, --print` | Print to stdout instead of writing files |
| `-f, --format <fmt>` | Output format: json, csv, both |
| `-o, --output-dir <dir>` | Override output directory |
| `--proxy <url>` | Use specific proxy URL |
| `--no-proxy` | Disable proxy |
| `--download-photos` | Download listing photos (linked room only for Booking.com) |
| `--download-photos-all` | Download ALL room photos (Booking.com) |
| `--booking` | Force Booking.com platform |
| `--airbnb` | Force Airbnb platform |

## Configuration

Create a `.env` file in the root directory with your proxy configuration:

```env
USE_PROXY=true
PROXY_PROTOCOL=http
PROXY_HOST=proxy-host.com
PROXY_PORT=1000
PROXY_USERNAME=your_username
PROXY_PASSWORD=your_password
```

Set `USE_PROXY=false` to disable proxy usage.
Optional `PROXY_COUNTRY=PL` appends `_country-PL` to the proxy password (Evomi-style exit-country
targeting) for every HTTP request and Playwright browser. Booking prices and result sets depend
on the visitor's country. With an Evomi proxy host (or `PROXY_STICKY_SESSION=true`), Booking search
also pins one exit IP per browser session by appending `_session-<id>`
(`PROXY_STICKY_SESSION=false` turns that off). Parameters already present in `PROXY_PASSWORD` are
left alone.
`PROXY_PROTOCOL` defaults to `http` for existing configurations. Set it to `https` for a TLS
connection to the proxy endpoint; both values can still carry HTTPS destination traffic.

`reviewr job add` calls the running StayReviewr web app. Pass its URL with
`--base-url` or `STAYREVIEWR_BASE_URL` (default `http://localhost:3000`) and authenticate with
`--owner-key` or `STAYREVIEWR_OWNER_KEY`. The owner key is the value of the browser's
`stayreviewr_owner` cookie and should be treated as a credential. URLs already present in the
job are reported as no-ops and are not queued again.

AI analysis has two configurable cost guardrails:

```env
# Maximum most-recent, post-filter reviews sent to AI per listing.
AI_REVIEW_MAX_REVIEWS=250

# Maximum persisted AI spend per StayReviewr analysis run, in USD. Set 0 to disable.
STAYREVIEWR_AI_JOB_BUDGET_USD=5
```

The CLI `batch` and `analyze` commands also accept `--max-ai-reviews <n>`, which takes
precedence over `AI_REVIEW_MAX_REVIEWS`. StayReviewr checks its accumulated persisted cost
after each paid per-listing AI operation; when the budget is reached, it preserves partial
results and stops before starting the next AI call.

Batch and StayReviewr analysis jobs share fetched details, reviews, and downloaded photos across
output directories:

```env
REVIEWR_CACHE_DIR=~/.cache/reviewr/artifacts-v1
REVIEWR_CACHE_DETAILS_TTL_DAYS=1
REVIEWR_CACHE_REVIEWS_TTL_DAYS=30
REVIEWR_CACHE_PHOTOS_TTL_DAYS=180
```

Details keys include trip dates, guest count, and Booking room selection so request-specific
pricing cannot leak across trips. Reviews are refreshed monthly; photos use the longer cache
because their contents change less often. Set an artifact TTL to `0` to disable its cache, or
run `reviewr batch --force` to bypass fresh entries and replace them after a successful fetch.
Cache failures fall through to live scraping.

The v1 cache grows without a size limit; removing the configured `REVIEWR_CACHE_DIR` (the
default is `~/.cache/reviewr/artifacts-v1`) is always safe because the next run refetches it.

StayReviewr also retains each analysis run as an optional debug/export bundle:

```env
STAYREVIEWR_ARTIFACT_DIR=data/review-jobs
STAYREVIEWR_ARTIFACT_RETENTION_DAYS=30
```

These files are durable by default but are not product state: native results, progress, and costs
come from Postgres. The artifact root must be a dedicated subdirectory; broad paths such as `/`,
the home directory, or the repo root are rejected. The worker removes expired run directories at
startup and before each analysis, logging both the directory count and bytes freed. Set retention
to `0` to keep runs indefinitely. You can inspect or apply the same root-confined policy manually:

```bash
cd web
npm run cleanup:artifacts             # dry run
npm run cleanup:artifacts -- --apply  # delete expired runs
```

An available run can be downloaded as a streamed ZIP from the job or results page. The per-job
run intentionally duplicates some details/reviews/photos from the cross-job cache: cache freshness
is bounded by its 1/30/180-day TTLs, while complete run bundles retain for 30 days by default.
Disk therefore grows in two locations; the cache still has no global size cap, and either store
can be removed without losing the Postgres-backed results.

## Project Structure

```
booking-reviews-scraper/
├── skills/
│   └── reviewr/SKILL.md         # AI comparison agent skill
├── src/
│   ├── cli.ts                   # Unified CLI entry point (reviewr)
│   ├── config.ts                # Proxy auth resolution & persistence
│   ├── utils.ts                 # Platform detection, URL parsing, output helpers
│   ├── batch.ts                 # Batch orchestrator (details + reviews + photos + AI)
│   ├── artifact-cache.ts        # Cross-job scrape artifact cache
│   ├── analyze.ts               # AI review analysis (Gemini/OpenAI/xAI)
│   ├── analyze-photos.ts        # AI photo analysis (Gemini vision)
│   ├── triage.ts                # AI triage — grade listings against priorities
│   ├── ask.ts                   # Ad-hoc Q&A for shortlisted properties
│   ├── report.ts                # HTML report generator with Q&A tab
│   ├── preprocess.ts            # URL deduplication and date detection
│   ├── booking/
│   │   ├── scraper.ts           # Booking.com reviews scraper
│   │   ├── listing.ts           # Booking.com listing details scraper
│   │   ├── analytics.ts         # Booking analytics and statistics
│   │   └── transform-to-csv.ts  # JSON to CSV transformer
│   └── airbnb/
│       ├── scraper.ts           # Airbnb reviews scraper
│       ├── listing.ts           # Airbnb listing details scraper
│       ├── analytics.ts         # Airbnb analytics and statistics
│       ├── hosts-finder.ts      # Airbnb host/agency finder
│       └── parse-host-flats.ts  # Host listing HTML parser
├── docs/
│   ├── booking.md               # Booking.com detailed documentation
│   └── airbnb.md                # Airbnb detailed documentation
├── data/                        # All data (gitignored)
│   ├── booking/
│   │   ├── input/               # CSV files with hotel URLs
│   │   ├── output/              # JSON files with scraped reviews
│   │   └── output-csv/          # Transformed CSV files
│   └── airbnb/
│       ├── input/               # CSV files with Airbnb property URLs
│       ├── output/              # JSON files with scraped reviews
│       ├── input-host/          # Host page HTML files
│       ├── output-host/         # Parsed host listing CSVs
│       └── output-hosts/        # Host finder results
├── .env                  # Environment configuration (create from .env.example)
├── .env.example          # Example environment file
├── package.json          # Project dependencies
└── README.md             # This file
```

See [docs/booking.md](docs/booking.md) and [docs/airbnb.md](docs/airbnb.md) for detailed platform documentation.

## License

This project is licensed under the WTFPL (Do What The F*ck You Want To Public License).

## Disclaimer

This tool is for educational and research purposes only. Please respect the terms of service of the websites you scrape and use this tool responsibly. The authors are not responsible for any misuse of this software.
