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
reviewr auth http://user:pass@host:port   # Save proxy config
reviewr auth                               # Check status
```

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

# Ask follow-up questions about shortlisted properties
reviewr ask "Is there free parking? ZTL zone?" --picks liked -o data/rome
reviewr ask "How noisy at night?" --ids 12345,mamomi-house -o data/rome

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
| `reviewr report` | Generate HTML report from triage results |
| `reviewr scrape [path]` | Batch scrape reviews from CSV files |
| `reviewr analytics [path]` | Run analytics on JSON output |
| `reviewr transform [path]` | JSON to CSV (Booking only) |
| `reviewr hosts <location>` | Find hosts/agencies (Airbnb only) |
| `reviewr parse-hosts [path]` | Parse host HTML pages (Airbnb only) |
| `reviewr auth [proxy-url]` | Configure/check proxy |

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
PROXY_HOST=proxy-host.com
PROXY_PORT=1000
PROXY_USERNAME=your_username
PROXY_PASSWORD=your_password
```

Set `USE_PROXY=false` to disable proxy usage.

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
