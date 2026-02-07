# reviewr — Hotel & Property Reviews CLI

## Setup Check

Before using reviewr, verify it's available:

```bash
npx tsx src/cli.ts --version
```

If using system-wide after build:
```bash
reviewr --version
```

## Auth / Proxy Setup

```bash
# Save proxy config (persists to ~/.config/reviewr/.env)
reviewr auth http://user:pass@host:port

# Check current proxy status
reviewr auth
```

## Commands

### Scrape a single URL (auto-detects platform)

```bash
reviewr https://www.booking.com/hotel/pl/example.html
reviewr https://www.airbnb.com/rooms/12345
reviewr https://www.booking.com/hotel/pl/example.html -p   # Print to stdout
```

### Batch scrape from CSV files

```bash
reviewr scrape --booking              # Process all CSVs in data/booking/input/
reviewr scrape --airbnb               # Process all CSVs in data/airbnb/input/
reviewr scrape data/booking/input/    # Explicit directory
reviewr scrape hotels.csv             # Single file
```

### Analytics

```bash
reviewr analytics --booking           # Booking.com analytics
reviewr analytics --airbnb            # Airbnb analytics
reviewr analytics --booking --12m     # 12-month rolling window
reviewr analytics --airbnb --12m      # Airbnb 12-month rolling
```

### Transform JSON to CSV (Booking only)

```bash
reviewr transform                     # Default data/booking/output/ dir
reviewr transform data/booking/output/
```

### Find hosts/agencies (Airbnb only)

```bash
reviewr hosts "Gdansk, Poland"
reviewr hosts "Crete, Greece" --debug --threshold 10
reviewr hosts "Barcelona, Spain" --listings-only
```

### Parse host HTML pages (Airbnb only)

```bash
reviewr parse-hosts                   # Default data/airbnb/input-host/
reviewr parse-hosts /path/to/html/dir
```

## Global Flags

| Flag | Description |
|------|-------------|
| `-p, --print` | Print output to stdout |
| `-f, --format <fmt>` | Output format: json, csv, both |
| `-o, --output-dir <dir>` | Override output directory |
| `--proxy <url>` | Use specific proxy URL |
| `--no-proxy` | Disable proxy |
| `--booking` | Force Booking.com platform |
| `--airbnb` | Force Airbnb platform |

## Platform Auto-Detection

- URL contains `booking.com` → Booking.com
- URL contains `airbnb.com` → Airbnb
- File path contains `data/booking/` → Booking.com
- File path contains `data/airbnb/` → Airbnb
- Use `--booking` or `--airbnb` for ambiguous cases

## Error Handling

- If proxy is misconfigured: `reviewr auth` to check status
- If scraping fails: check proxy connectivity, retry with `--debug`
- If analytics shows no data: verify JSON output files exist in the expected directory

## Development

```bash
npx tsx src/cli.ts <command>    # Run CLI in dev mode
pnpm build && npm link          # Install system-wide
```
