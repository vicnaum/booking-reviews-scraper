---
name: reviewr
description: "Property comparison agent and reviews CLI for Booking.com and Airbnb. Use when the user wants to: (1) Compare multiple property listings and get a recommendation, (2) Choose between hotels/apartments with a detailed report, (3) Scrape reviews from a Booking.com or Airbnb URL, (4) Fetch listing details (ratings, photos, amenities, pricing), (5) Batch scrape reviews or run analytics, (6) Find Airbnb hosts/agencies. Triggers on: multiple hotel/property URLs, 'compare listings', 'which hotel is better', 'help me choose', 'where should I stay', hotel reviews, Booking.com, Airbnb, review scraping, listing details, or reviewr commands."
---

# reviewr — Property Comparison Agent & Reviews CLI

Source: https://github.com/vicnaum/booking-reviews-scraper

## Mode Detection

**Comparison Mode** — User provides 2+ listing URLs (Booking.com and/or Airbnb) and wants to compare or choose between them. Follow the **Comparison Workflow** below.

**Single-Action Mode** — User wants one specific task (scrape reviews, fetch details, run analytics, etc.). Use the **CLI Reference** section at the bottom.

---

## Comparison Workflow

When the user provides multiple listing URLs and wants help choosing where to stay, follow these phases in order.

### Phase 0: Requirements Gathering

Before scraping anything:

1. **Preprocess URLs** — If the user provides URL files or multiple URLs, run preprocessing first:
   ```bash
   reviewr preprocess <file1> [file2] ...
   ```
   This deduplicates URLs (by room ID for Airbnb, hotel name for Booking), classifies them by platform, and detects dates embedded in URL query params. The output tells you:
   - How many unique Airbnb/Booking URLs there are and how many duplicates were removed
   - Whether dates are `unanimous` (all URLs agree), `conflicting` (URLs have different dates), or `none` (no dates in URLs)

2. **Dates** — If preprocessing found `unanimous` dates, use those automatically. If `conflicting`, show the user what was found and ask which dates to use. If `none`, ask: "Do you want date-specific pricing and availability, or just a general quality comparison?" Use dates for both Airbnb AND Booking pricing via `--checkin`/`--checkout` flags.

3. **Priorities** — Ask what matters most. Suggest common dimensions and ask them to pick their top 3–5 or provide custom ones:
   - Sleep quality / noise levels
   - Cleanliness
   - Location / walkability
   - Bed arrangement (double vs twin vs sofa bed)
   - Air conditioning / heating / ventilation
   - Modern condition / renovation
   - Value for money
   - Host responsiveness
   - Check-in flexibility

3. **Deal-breakers** — Ask about hard constraints that instantly eliminate a property:
   - Bed bug or mold reports in reviews
   - Specific bed type requirements
   - Check-in time constraints (e.g., "I arrive at 11 PM")
   - Must-have amenities (AC, elevator, parking, etc.)
   - Budget ceiling per night

### Phase 1: Data Collection

**Preferred: batch command** — fetches details, reviews, and photos for all URLs at once with skip-if-exists, error recovery, and progress tracking:

```bash
# Fetch everything (details + reviews + photos) for all URLs
reviewr batch rome-booking.txt rome-airbnb.txt

# With explicit dates (overrides dates in URLs)
reviewr batch rome-booking.txt rome-airbnb.txt --checkin YYYY-MM-DD --checkout YYYY-MM-DD --adults 3

# Fetch only what you need
reviewr batch urls.txt --details                     # Only listing details
reviewr batch urls.txt --details --reviews           # Details + reviews, no photos
```

The batch command auto-detects dates from URLs (if unanimous), deduplicates, and skips already-fetched data. Use `--force` to re-fetch.

**Alternative: per-URL commands** (for single URLs or debugging):

```bash
# 1. Listing details — photos, amenities, ratings, rooms, pricing
reviewr details <url> -p                                                   # Without pricing
reviewr details <url> --checkin YYYY-MM-DD --checkout YYYY-MM-DD -p        # With pricing (both platforms)

# 2. Reviews — full text with scores and dates
reviewr reviews <url> -p

# 3. Photos — download for visual analysis
reviewr details <url> --download-photos
```

Run per-URL commands for different URLs in parallel where possible.

**What you get from listing details:**
- Title, address, coordinates
- Photo URLs (with per-room associations for Booking.com)
- Amenities list
- Overall rating and sub-ratings
- Check-in/check-out times
- Room types, bed arrangements, linked room ID
- Pricing (both platforms, when dates provided via `--checkin`/`--checkout`)

**What you get from reviews:**
- Full review texts with scores and dates
- Reviewer country, stay type, room info
- Owner/host responses

**Booking.com pricing:** When dates are provided via `--checkin`/`--checkout`, the scraper loads the hotel page with dates and extracts room pricing from the availability table. Note that prices are dynamic and may differ from what logged-in users see (Genius levels, member discounts). The scraper returns the first (cheapest) option per room type with total price, meal plan, and cancellation terms.

If a Booking.com URL contains a specific room selection (via `matching_block_id` in the URL), the listing details will include a `linkedRoomId` — use this room's photos as the representative for that property.

### Phase 2: Score Normalization

Normalize all scores to a **0–10 scale**:

| Platform | Raw scale | Conversion |
|----------|-----------|------------|
| Booking.com | 0–10 | Use as-is |
| Airbnb | 0–5 stars | Multiply by 2 |

Apply this to both overall scores and sub-ratings.

Build a unified data structure per property:
- Name, platform, URL
- Overall score (0–10), review count
- Sub-scores: cleanliness, location, value, staff/communication, etc.
- Amenities, bed type, AC, elevator, balcony
- Check-in/out times, check-in method
- Price per night (if available)
- Representative photo URLs
- Full review texts (for mining)

### Phase 3: Review Text Mining

Search review texts for priority-relevant mentions. For each property, mine reviews for:

| Priority | Search terms |
|----------|-------------|
| Noise / Sleep | noise, noisy, loud, quiet, sleep, earplugs, street, traffic, party, thin walls, soundproof |
| Cleanliness | clean, dirty, dust, stain, hair, mold, mould, smell, odor, hygiene |
| Bed quality | bed, mattress, comfortable, hard, soft, pillow, sofa bed, twin, double, king |
| AC / Ventilation | AC, air conditioning, heating, hot, cold, ventilation, stuffy, fresh air, fan |
| Location | location, walk, metro, bus, central, far, close, restaurant, beach, supermarket |
| Condition | renovated, new, old, dated, modern, worn, broken, maintenance |
| Host quality | host, owner, responsive, helpful, check-in, key, communication, late |
| Pests (red flag) | bug, cockroach, ant, mosquito, bed bug, bedbug, pest, insect |
| Value | price, value, expensive, cheap, worth, overpriced |

For each category: count positive vs negative mentions, calculate sentiment ratio, and note specific quotes. Flag any red-flag mentions (bed bugs, mold, cockroaches) as potential deal-breakers.

### Phase 4: Photo Analysis

View downloaded photos for each property (use the Read tool on the downloaded image files in `data/booking/output/` or `data/airbnb/output/`). Assess:

- **Renovation state** — Modern/recent vs dated/worn
- **Cleanliness** — Clean surfaces, fresh linens, or visible issues
- **Bed type** — Actual bed visible (double, twin, sofa bed)
- **Room size and light** — Spacious vs cramped, natural light
- **Bathroom** — Modern fixtures, condition, shower vs tub
- **View** — What's visible from windows/balcony
- **General vibe** — Cozy, sterile, luxurious, basic, quirky
- **Red flags** — Anything concerning (water stains, worn furniture, etc.)

Select 1–2 representative photos per property for the report: the main bedroom and one standout feature or concern. If a specific room was linked in the URL, prioritize that room's photos.

### Phase 5: Weighted Scoring

Apply the user's priority weights to calculate a composite score per property.

**Default weights** (use if user doesn't specify):

| Dimension | Weight |
|-----------|--------|
| Review Rating (overall) | 30% |
| Noise & Sleep Quality | 20% |
| Cleanliness | 15% |
| Location | 10% |
| Bed & Comfort | 10% |
| Condition / Renovation | 10% |
| Value for Money | 5% |

Adjust weights based on user's stated priorities. If user names their top priorities, give them higher weights and redistribute.

**Scoring per dimension (0–10):**
- **Review Rating** — Use normalized overall score
- **Platform sub-rating dimensions** (cleanliness, location, etc.) — Use normalized sub-rating as base. Adjust +/- 0.5–1.0 based on review text mining sentiment (e.g., 5+ negative noise mentions = -1 point)
- **Photo-assessed dimensions** (condition, bed quality) — Score based on visual analysis
- **Value** — Price relative to quality (if prices available); otherwise use platform's value sub-rating

**Composite score** = Sum of (dimension_score x weight) for all dimensions.

### Phase 6: Hard Constraint Filtering

Check each property against the user's stated deal-breakers. Mark eliminated properties with the specific reason. Common eliminations:

- Red-flag mentions in reviews (bed bugs, mold, cockroaches)
- Wrong bed type for user's needs
- Check-in time incompatible with user's arrival
- Missing must-have amenity (AC, elevator, etc.)
- Over the user's budget ceiling
- Very low score on a critical dimension (e.g., noise < 3 when sleep is the user's #1 priority)
- Bait-and-switch risk (agency managing many units with inconsistent quality)
- Host with 0% response rate or very poor communication reviews

### Phase 7: Report Generation

Generate a standalone HTML report saved to `data/comparison_report.html`. Tell the user the file path when done.

**Report structure:**

1. **Header** — Trip summary: destination, dates (if provided), number of properties compared.

2. **User Preferences** — Stated priorities with weights, deal-breakers listed.

3. **Top Recommendations** — Ranked property cards for properties that passed all filters:
   - Representative photo (embedded as `<img src="CDN_URL">` from the listing's photo URLs)
   - Property name, platform badge (Booking.com / Airbnb), composite score
   - Per-dimension score breakdown (visual bars or colored indicators)
   - Key highlights (best aspects from reviews) and concerns (worst aspects)
   - Price per night if available
   - Direct link to listing URL

4. **Side-by-Side Comparison Table** — All passing properties in columns:
   - Composite score, platform rating, review count
   - Price per night
   - Per-dimension scores
   - Key amenities (AC, WiFi, elevator, parking, balcony)
   - Bed type, check-in/out times

5. **Eliminated Properties** — Table with property name and elimination reason for each rejected property.

6. **Detailed Analysis** (per property) — Expandable or scrollable sections:
   - Full amenity list
   - Review sentiment summary per dimension with notable quotes
   - Photo gallery (3–5 photos)
   - Pros and cons summary

7. **Final Recommendation** — 1–2 paragraph verdict: best choice and why, runner-up alternative, any caveats.

**Report styling:** Clean, modern HTML with inline CSS. Light color scheme, readable fonts, mobile-friendly layout. Embed photos as `<img>` tags pointing to CDN URLs (not base64). Use platform brand colors for badges (Booking.com blue #003580, Airbnb coral #FF5A5F).

---

## Setup Check

Before using reviewr, verify it's installed:

```bash
reviewr --version
```

If not installed, clone and install:

```bash
git clone https://github.com/vicnaum/booking-reviews-scraper.git
cd booking-reviews-scraper
pnpm install
npx playwright install chromium
pnpm build && npm link
```

## Auth / Proxy Setup

```bash
# Save proxy config (persists to ~/.config/reviewr/.env)
reviewr auth http://user:pass@host:port

# Check current proxy status
reviewr auth
```

## CLI Reference

### Single URL (auto-detects platform)

```bash
reviewr https://www.booking.com/hotel/pl/example.html       # Booking -> listing details
reviewr https://www.airbnb.com/rooms/12345                   # Airbnb -> listing details
reviewr https://www.airbnb.com/rooms/12345 --download-photos # Also download photos
reviewr https://www.airbnb.com/rooms/12345 -p                # Print to stdout
```

### Fetch reviews

```bash
reviewr reviews https://www.booking.com/hotel/pl/example.html
reviewr reviews https://www.airbnb.com/rooms/12345
reviewr reviews https://www.airbnb.com/rooms/12345 -p    # Print to stdout
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

### Fetch listing details (both platforms)

```bash
# Booking.com — full listing with room-aware photos
reviewr details https://www.booking.com/hotel/pl/example.html -p
reviewr details <booking-url> --checkin 2026-03-29 --checkout 2026-04-04  # With pricing

# Airbnb — full listing with optional pricing
reviewr details https://www.airbnb.com/rooms/12345 -p
reviewr details <url> --checkin 2026-03-29 --checkout 2026-04-04     # With pricing
reviewr details "<url-with-dates>"                                   # Auto-extracts dates from URL
reviewr details <url> --download-photos                              # Download photos
```

**Booking.com returns:** title, description, address, coordinates, photos (high-res, with per-room associations), rooms (with photo mapping), linked room ID, amenities, star rating, overall rating, sub-ratings (Staff, Cleanliness, Location, etc.), review count, check-in/out times, pricing (when dates provided: room prices, meal plans, cancellation terms). Use `--download-photos` for linked room's photos only, `--download-photos-all` for all photos.

**Airbnb returns:** title, description, photos, amenities, host info, house rules, coordinates, ratings, sleeping arrangements, pricing (when dates provided).

### Preprocess URL files

```bash
reviewr preprocess rome-booking.txt rome-airbnb.txt  # Deduplicate and detect dates
```

Returns JSON with classified URLs, duplicate counts, and detected dates (unanimous/conflicting/none).

### Batch fetch (details + reviews + photos)

```bash
reviewr batch rome-booking.txt rome-airbnb.txt          # Fetch everything
reviewr batch urls.txt --details                         # Only listing details
reviewr batch urls.txt --reviews                         # Only reviews
reviewr batch urls.txt --details --photos                # Details + photos, no reviews
reviewr batch urls.txt --checkin 2026-03-16 --checkout 2026-03-21 --adults 3
reviewr batch urls.txt --force                           # Re-fetch even if output exists
reviewr batch --retry                                    # Retry all failures from last manifest
reviewr batch --retry --details                          # Retry only failed details
reviewr batch urls.txt --retry                           # Process new URLs + retry failures
```

Reads URL files, deduplicates, auto-detects dates from URLs, and fetches details + reviews + photos for all listings with skip-if-exists, error recovery, and progress reporting. If no `--details`/`--reviews`/`--photos` flags specified, fetches all three. If any specified, only those.

Saves a manifest to `data/batch_manifest.json` tracking per-listing, per-phase status (`fetched`, `skipped`, `failed`, `partial`). Use `--retry` to re-process only failed/partial listings. Photos are checked for completeness (file count vs expected) and re-downloaded if incomplete.

Output files: `listing_{id}.json` (details), `room_{id}_reviews.json` or `{id}_reviews.json` (reviews), `photos_{id}/` (photos) in the platform's output directory.

### Refresh Airbnb API hashes

```bash
reviewr refresh-hash   # Fix stale Airbnb pricing (auto-detected, usually not needed)
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
| `--download-photos` | Download listing photos (linked room only for Booking.com) |
| `--download-photos-all` | Download ALL room photos (Booking.com) |
| `--booking` | Force Booking.com platform |
| `--airbnb` | Force Airbnb platform |

## Platform Auto-Detection

- URL contains `booking.com` -> Booking.com
- URL contains `airbnb.com` -> Airbnb
- File path contains `data/booking/` -> Booking.com
- File path contains `data/airbnb/` -> Airbnb
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
