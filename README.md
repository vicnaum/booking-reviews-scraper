# Booking & Airbnb Reviews Scraper

A TypeScript toolkit for batch-scraping hotel and property reviews from Booking.com and Airbnb, with built-in analytics, CSV export, and host/agency discovery tools.

The code is distributed as-is, no warranties or what-so-ever.

## Features

- **Batch Processing**: Process multiple hotels/properties from CSV files
- **Smart Skip Logic**: Automatically skip already processed files
- **Proxy Support**: Built-in proxy support for all scrapers
- **Structured Output**: Export reviews to JSON format
- **Analytics & BI**: Comprehensive business intelligence metrics for both platforms
- **Host Discovery**: Find all hosts/agencies in a geographic area (Airbnb)

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/vicnaum/booking-reviews-scraper.git
   cd booking-reviews-scraper
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual proxy credentials
   ```

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

## Quick Start — `reviewr` CLI

The unified CLI auto-detects the platform from the URL:

```bash
# Scrape a single URL
reviewr https://www.booking.com/hotel/pl/example.html
reviewr https://www.airbnb.com/rooms/12345

# Batch scrape from CSV files
reviewr scrape --booking
reviewr scrape --airbnb

# Analytics
reviewr analytics --booking
reviewr analytics --airbnb --12m

# Transform JSON to CSV (Booking only)
reviewr transform

# Find hosts/agencies in a location (Airbnb only)
reviewr hosts "Gdansk, Poland"

# Parse host HTML pages (Airbnb only)
reviewr parse-hosts

# Configure proxy
reviewr auth http://user:pass@host:port
reviewr auth                                # Check status
```

### Install system-wide

```bash
pnpm build && npm link
```

### Run without installing

```bash
npx tsx src/cli.ts <command> [options]
```

### Legacy pnpm scripts (still work)

```bash
pnpm start              # Booking.com batch scrape
pnpm airbnb             # Airbnb batch scrape
pnpm analytics          # Booking analytics
pnpm analytics:12m      # Booking 12-month rolling
pnpm analytics:airbnb   # Airbnb analytics
pnpm transform          # JSON to CSV
```

See [docs/booking.md](docs/booking.md) and [docs/airbnb.md](docs/airbnb.md) for detailed platform documentation.

## Project Structure

```
booking-reviews-scraper/
├── src/
│   ├── cli.ts                   # Unified CLI entry point (reviewr)
│   ├── config.ts                # Proxy auth resolution & persistence
│   ├── utils.ts                 # Platform detection, URL parsing, output helpers
│   ├── booking/
│   │   ├── scraper.ts           # Booking.com reviews scraper
│   │   ├── analytics.ts         # Booking analytics and statistics
│   │   └── transform-to-csv.ts  # JSON to CSV transformer
│   └── airbnb/
│       ├── scraper.ts           # Airbnb reviews scraper
│       ├── analytics.ts         # Airbnb analytics and statistics
│       ├── hosts-finder.ts      # Airbnb host/agency finder
│       └── parse-host-flats.ts  # Host listing HTML parser
├── skills/
│   └── reviewr/SKILL.md         # AI agent skill definition
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

## CLI Commands

| Command | Description |
|---------|-------------|
| `reviewr <url>` | Scrape reviews from URL (auto-detects platform) |
| `reviewr scrape [path]` | Batch scrape from CSV files |
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
| `--booking` | Force Booking.com platform |
| `--airbnb` | Force Airbnb platform |

## Legacy pnpm Scripts

| Script | Description |
|--------|-------------|
| `pnpm start` | Run the Booking.com reviews scraper |
| `pnpm dev` | Booking.com scraper with hot reload |
| `pnpm airbnb` | Run the Airbnb reviews scraper |
| `pnpm transform` | Convert Booking.com JSON output to CSV |
| `pnpm analytics` | Generate Booking.com analytics |
| `pnpm analytics:12m` | Generate Booking.com 12-month rolling analytics |
| `pnpm analytics:airbnb` | Generate Airbnb analytics |
| `pnpm analytics:airbnb:12m` | Generate Airbnb 12-month rolling analytics |
| `pnpm build` | Build TypeScript to JavaScript |

## License

This project is licensed under the WTFPL (Do What The F*ck You Want To Public License).

## Disclaimer

This tool is for educational and research purposes only. Please respect the terms of service of the websites you scrape and use this tool responsibly. The authors are not responsible for any misuse of this software.
