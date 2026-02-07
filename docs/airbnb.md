# Airbnb Tools

A suite of TypeScript tools for scraping Airbnb reviews, analyzing review data, discovering hosts/agencies in a geographic area, and parsing host listing pages.

## Reviews Scraper

**Script:** `pnpm airbnb`
**Source:** `src/airbnb/scraper.ts`

### Overview

Uses Airbnb's **GraphQL API** (`StaysPdpReviewsQuery`) to fetch reviews for Airbnb properties. The API key is dynamically fetched from the Airbnb homepage at startup.

### Input Format

Place CSV files in `data/airbnb/input/` with a header row and the following columns:

```csv
id,url,room_type,title,rating_score,review_count,status
12345,https://www.airbnb.com/rooms/12345,Entire home,Cozy Apartment,4.8,42,Rated
```

| Column | Description |
|--------|-------------|
| `id` | Airbnb property ID |
| `url` | Property URL |
| `room_type` | Type of accommodation |
| `title` | Property title |
| `rating_score` | Current rating |
| `review_count` | Number of reviews |
| `status` | Property status |

### How It Works

1. Fetches a dynamic API key from the Airbnb homepage
2. Reads all CSV files from `data/airbnb/input/`
3. For each property, fetches reviews via the GraphQL API
4. Paginates through all reviews (50 per request, sorted by most recent)
5. Saves results to JSON in `data/airbnb/output/`
6. Skips files that have already been processed

### Output

**File naming:** `data/airbnb/input/properties.csv` -> `data/airbnb/output/properties.json`

Each output JSON file contains:

```json
{
  "input_file": "properties.csv",
  "scraped_at": "2024-01-15T10:30:00.000Z",
  "total_reviews": 250,
  "properties_processed": ["12345", "67890"],
  "reviews": [...]
}
```

### Review Data Structure

```typescript
interface AirBnBReview {
  property_id: string;
  property_title: string;
  review_id: string | null;
  reviewer_name: string | null;
  reviewer_id: string | null;
  review_date: string | null;
  review_text: string | null;
  rating: number | null;              // 1-5 scale
  reviewer_avatar_url: string | null;
  reviewer_verification_level: string | null;
  response_text: string | null;
  response_date: string | null;
  language: string | null;
  can_be_translated: boolean;
  localized_date: string | null;
}
```

### Error Handling

- **Retry Logic**: 3 attempts with exponential backoff (up to 5s)
- **Timeout**: 60-second request timeout
- **Skip Logic**: Automatically skips already-processed files
- **Graceful Failures**: Continues processing other files/properties if one fails

---

## Analytics

**Scripts:**
- `pnpm analytics:airbnb` — full historical analytics
- `pnpm analytics:airbnb:12m` — 12-month rolling window (from latest review date)

**Source:** `src/airbnb/analytics.ts`

Analyzes all JSON files in `data/airbnb/output/` and generates comprehensive business intelligence CSV files. Adapted for Airbnb's **1-5 rating scale** (vs. Booking.com's 1-10).

### Output Files

- **Historical mode:** `data/airbnb/analytics_results.csv` & `data/airbnb/raw_reviews_data.csv`
- **12-month mode:** `data/airbnb/analytics_results_12m.csv` & `data/airbnb/raw_reviews_data_12m.csv`

All output files are written to `data/airbnb/`.

### Quality Filtering

Low-quality reviews are filtered out before analysis:
- Very short review text (<=20 characters) with low rating (<=2)
- Reviews with no text at all

### Core Metrics

- **Volume Metrics**: Total reviews, properties, average reviews per property
- **Rating Analysis**: Average ratings (1-5 scale), low/mid/high rating percentages
- **Rating Distribution**: Breakdown by individual stars (1, 2, 3, 4, 5)
- **Temporal Analysis**: Date ranges, years covered, reviews per year
- **Language Analysis**: Language diversity, top 3 languages
- **Review Length**: Average review length, length distribution (<50, 50-150, 150-500, >500 chars)
- **Reviewer Analysis**: Verification level breakdown
- **Host Response**: Overall host response rate

### Advanced Business Intelligence Metrics

| Metric | Description | Interpretation |
|--------|-------------|----------------|
| **Portfolio Stability Score** | Standard deviation of all ratings | Lower = more consistent quality |
| **Host Engagement Score** | Response rate to low ratings (<=2) | Measures accountability to unhappy guests |
| **Market Activity Score** | Reviews per year per property / average rating | Activity indicator relative to quality |
| **Outlier Property Impact** | Rating drag from worst property | How much the worst property hurts overall performance |

### Analytics CSV Column Reference

| Column | Description |
|--------|-------------|
| `file_name` | Source JSON filename |
| `company_name` | Formatted company name |
| `total_reviews` | High-quality reviews analyzed |
| `total_properties` | Number of distinct properties |
| `avg_reviews_per_property` | Average reviews per property |
| `median_reviews_per_property` | Median reviews per property |
| `min_reviews_per_property` | Minimum reviews for any property |
| `max_reviews_per_property` | Maximum reviews for any property |
| `avg_reviews_per_year_per_property` | Annual review velocity per property |
| `overall_avg_rating` | Mean rating (1-5 scale) |
| `low_rating_percentage` | Percentage of reviews with rating <=2 |
| `high_rating_percentage` | Percentage of reviews with rating >=4 |
| `mid_rating_percentage` | Percentage of reviews with rating 3 |
| `portfolio_stability_score` | Standard deviation of ratings |
| `host_engagement_score` | Response rate to low ratings |
| `market_activity_score` | Reviews/year/property / avg rating |
| `outlier_property_impact` | Rating drag from worst property |
| `worst_property_name` | Property with lowest average rating |
| `worst_property_rating` | Rating of worst property |
| `oldest_review_date` | Earliest review (YYYY-MM-DD) |
| `newest_review_date` | Most recent review (YYYY-MM-DD) |
| `years_covered` | Time span in years |
| `overall_reviews_per_year` | Total annual review velocity |
| `languages_count` | Number of distinct languages |
| `top_languages` | Top 3 languages (format: "lang(count)") |
| `avg_review_length` | Average review text length in characters |
| `overall_host_response_rate` | Percentage of reviews with host responses |
| `properties_with_low_ratings` | Count of properties with any rating <=2 |
| `properties_with_low_ratings_percentage` | Percentage of properties with low ratings |
| `properties_with_perfect_ratings` | Properties with perfect 5.0 average |
| `rating_distribution` | Breakdown by star (1:x%, 2:x%, ...) |
| `review_length_distribution` | Length buckets (<50, 50-150, 150-500, >500) |
| `verification_levels` | Top reviewer verification levels |

---

## Hosts Finder

**Script:** `npx tsx src/airbnb/hosts-finder.ts "City, Country"`
**Source:** `src/airbnb/hosts-finder.ts`

### Overview

Discovers all hosts and rental agencies in a geographic area. Uses a multi-stage approach combining geocoding, grid-based search, and price pivoting to maximize listing discovery.

### How It Works

**Stage 1: Geocoding**
Uses **OpenStreetMap Nominatim** API to get the geographic polygon boundary of the target location.

**Stage 2: Grid Search with Price Pivoting**
- Splits the location polygon into a grid of 5km-radius search areas using **Turf.js**
- For each area, uses **price pivoting** — dividing the price range (0-1,000,000) into 10 histogram buckets to bypass Airbnb's listing limits
- Paginates through results (50 listings per page)
- Automatically detects high-density areas and subdivides them
- Extracts host IDs directly from search results

**Stage 3: Host Profile Fetching**
- Fetches detailed profile for each unique host via the Airbnb Users API
- Identifies agencies based on listing count (default threshold: 5 listings)
- Auto-refreshes API key after consecutive errors

**Stage 4: Save Results**

### Output

Saves a CSV file to `data/airbnb/output-hosts/` named `{location}_hosts.csv`.

| Column | Description |
|--------|-------------|
| `hostId` | Airbnb host ID |
| `hostName` | Host display name |
| `listingCount` | Number of listings managed |
| `isAgency` | Whether listing count >= agency threshold |
| `hostRating` | Host's reviewee rating |
| `hostPictureUrl` | Profile picture URL |
| `profileUrl` | Link to host's Airbnb profile |

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `AGENCY_THRESHOLD` | `5` | Minimum listings to be considered an agency (hardcoded constant) |
| `DEBUG_MODE` | `false` | Stop early after finding a few listings (for testing) |
| `DEBUG_LISTINGS_ONLY` | `false` | Only discover listings, skip host profile fetching |

---

## Host Listing Parser

**Script:** `npx tsx src/airbnb/parse-host-flats.ts`
**Source:** `src/airbnb/parse-host-flats.ts`

### Overview

Parses saved Airbnb host page HTML files to extract listing data. Uses **Cheerio** for HTML parsing and **PapaParse** for CSV output.

This tool is meant to be used with manually saved HTML files from Airbnb host profile pages (e.g., `https://www.airbnb.com/users/show/{host_id}`).

### Input

Place HTML files in `data/airbnb/input-host/`. Each `.html` file should be a saved Airbnb host profile page.

### Output

Creates CSV files in `data/airbnb/output-host/`, one per input HTML file.

**File naming:** `data/airbnb/input-host/host123.html` -> `data/airbnb/output-host/host123.csv`

### Extracted Fields

| Column | Description |
|--------|-------------|
| `id` | Airbnb listing ID (extracted from URL) |
| `url` | Full listing URL |
| `roomType` | Type of accommodation (e.g., "Entire home") |
| `title` | Listing title |
| `ratingScore` | Rating score (null if new) |
| `reviewCount` | Number of reviews (0 if new) |
| `status` | `New` (no reviews), `Rated` (has reviews), or `Unknown` |

### Note on Paths

This script uses `__dirname`-relative paths (not CWD-relative like the other scripts), so it works correctly regardless of where you run it from.

---

## Scripts Reference

| Script | Description |
|--------|-------------|
| `pnpm airbnb` | Run the Airbnb reviews scraper |
| `pnpm analytics:airbnb` | Generate full historical analytics |
| `pnpm analytics:airbnb:12m` | Generate 12-month rolling analytics |
| `npx tsx src/airbnb/hosts-finder.ts "City, Country"` | Find hosts/agencies in an area |
| `npx tsx src/airbnb/parse-host-flats.ts` | Parse host page HTML files |
