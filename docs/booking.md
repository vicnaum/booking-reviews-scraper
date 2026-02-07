# Booking.com Scraper

A TypeScript-based batch scraper for extracting hotel reviews from Booking.com with built-in proxy support.

## Overview

The scraper uses **Cheerio** for HTML parsing and **node-fetch** with optional proxy support to scrape the Booking.com review pages. It processes multiple hotels from CSV input files, extracts all available reviews, and saves them as structured JSON.

## Reviews Scraper

**Script:** `pnpm start` (or `pnpm dev` for hot reload)
**Source:** `src/booking/scraper.ts`

### Input Format

Place CSV files in `data/booking/input/` with one Booking.com URL per line:

```
https://www.booking.com/hotel/pl/example-hotel.pl.html?aid=123&label=...
https://www.booking.com/hotel/fr/another-hotel.fr.html?aid=456&label=...
```

### URL Parsing

The scraper extracts hotel information from Booking.com URLs using this regex pattern:

```
https://www.booking.com/hotel/[COUNTRY]/[HOTEL_NAME].[OPTIONAL-LANG].html
```

**Example:**
- URL: `https://www.booking.com/hotel/pl/hilton-hotel.pl.html`
- Extracted: `hotel_name: "hilton-hotel"`, `country_code: "pl"`

Duplicate URLs (same hotel_name + country_code) are automatically deduplicated.

### How It Works

1. Reads all CSV files from `data/booking/input/`
2. Extracts hotel names and country codes from each URL
3. Discovers total review pages via pagination
4. Scrapes 10 reviews per page with 0.5s delay between requests
5. Saves results to JSON in `data/booking/output/`
6. Skips files that have already been processed

### Output

**File naming:** `data/booking/input/hotels.csv` -> `data/booking/output/hotels.json`

Each output JSON file contains:

```json
{
  "input_file": "hotels.csv",
  "scraped_at": "2024-01-15T10:30:00.000Z",
  "total_reviews": 150,
  "hotels_processed": ["hilton-hotel", "another-hotel"],
  "reviews": [...]
}
```

### Review Data Structure

```typescript
interface Review {
  hotel_name: string;
  username: string | null;
  user_country: string | null;
  room_view: string | null;
  stay_duration: string | null;
  stay_type: string | null;
  review_post_date: string | null;
  review_title: string | null;
  rating: number | null;           // 1-10 scale
  original_lang: string | null;
  review_text_liked: string | null;
  review_text_disliked: string | null;
  full_review: string | null;
  en_full_review: string | null;
  found_helpful: number;
  found_unhelpful: number;
  owner_resp_text: string | null;
}
```

### Error Handling

- **Retry Logic**: 3 attempts with exponential backoff (up to 5s)
- **Timeout**: 60-second request timeout
- **Skip Logic**: Automatically skips already-processed files
- **Graceful Failures**: Continues processing other files/hotels if one fails

---

## CSV Transform

**Script:** `pnpm transform`
**Source:** `src/booking/transform-to-csv.ts`

Converts JSON output files to a simplified CSV format optimized for spreadsheet analysis.

### How It Works

- Reads all JSON files from `data/booking/output/` (excluding `example.json`)
- Parses the `full_review` field to extract title, liked, and disliked sections
- Filters out low-quality reviews (titles <=15 characters with no liked/disliked content)
- Writes CSV files to `data/booking/output-csv/`

**File naming:** `data/booking/output/hotels.json` -> `data/booking/output-csv/hotels.csv`

### CSV Columns

| Column | Description |
|--------|-------------|
| `review_date` | Date when the review was posted |
| `rating` | Numerical rating (1-10) |
| `title` | Review title (extracted from full_review) |
| `liked` | What the guest liked |
| `disliked` | What the guest disliked |
| `owner_response` | Hotel owner's response to the review |

---

## Analytics

**Scripts:**
- `pnpm analytics` — full historical analytics
- `pnpm analytics:12m` — 12-month rolling window (from latest review date)

**Source:** `src/booking/analytics.ts`

Analyzes all JSON files in `data/booking/output/` and generates comprehensive business intelligence CSV files.

### Output Files

- **Historical mode:** `data/booking/analytics_results.csv` & `data/booking/raw_reviews_data.csv`
- **12-month mode:** `data/booking/analytics_results_12m.csv` & `data/booking/raw_reviews_data_12m.csv`

### Quality Filtering

Before analysis, low-quality reviews are filtered out: reviews with titles <=15 characters and no liked/disliked content are excluded.

### Core Metrics

- **Volume Metrics**: Total reviews, hotels, apartments, average reviews per apartment
- **Rating Analysis**: Average ratings (1-10 scale), negative review percentages, rating distributions (1-2, 3-4, 5-6, 7-8, 9-10)
- **Accommodation Insights**: Total nights, average nights per apartment, annual nights per apartment
- **Temporal Analysis**: Date ranges, years covered, reviews per year
- **Geographic Data**: Country counts, top 3 review countries by volume
- **Language Analysis**: Language diversity, top 3 languages
- **Engagement Metrics**: Helpful votes, owner response rates

### Advanced Business Intelligence Metrics

| Metric | Description | Formula | Interpretation |
|--------|-------------|---------|----------------|
| **True Problem Rate** | Percentage of reviews with rating <=7 | `(reviews <= 7) / total * 100` | More realistic problem indicator than just counting disasters |
| **Portfolio Stability Score** | Standard deviation of all ratings | `sqrt(sum((rating - mean)^2) / n)` | Lower = more consistent quality; Higher = unpredictable experience |
| **Host Engagement Score** | Owner response rate to negative reviews (<=7) | `responses_to_negative / negative_reviews * 100` | Measures accountability and customer service quality |
| **Market Fit Score** | Annual nights per apartment / average rating | `avg_nights_per_year_per_apartment / avg_rating` | High = individual apartments achieving high utilization while maintaining quality |
| **Outlier Property Impact** | Rating drag from worst property | `avg_without_worst - overall_avg` | How much the worst apartment hurts overall performance |

### Interpreting Key Metrics

**Portfolio Stability Score**: Lower values (0.5-1.5) indicate consistent quality across properties. Higher values (2.0+) suggest guests are "rolling the dice" — some properties are excellent while others disappoint.

**Host Engagement Score**: High scores (70%+) show professional customer service with systematic responses to problems. Low scores suggest poor accountability.

**Market Fit Score**: Balances individual apartment utilization and quality. High scores indicate each apartment achieving strong occupancy while maintaining guest satisfaction.

### Analytics CSV Column Reference

#### Basic Metrics

| Column | Description |
|--------|-------------|
| `file_name` | Source JSON filename (without extension) |
| `company_name` | Formatted company name derived from filename |
| `total_reviews` | Total number of high-quality reviews analyzed |
| `total_hotels` | Number of distinct hotels in the dataset |
| `total_apartments` | Number of distinct apartments (hotel + room_view combinations) |

#### Volume & Distribution

| Column | Description |
|--------|-------------|
| `avg_reviews_per_apartment` | Average number of reviews per apartment |
| `median_reviews_per_apartment` | Median reviews per apartment |
| `min_reviews_per_apartment` | Minimum reviews for any apartment |
| `max_reviews_per_apartment` | Maximum reviews for any apartment |
| `avg_reviews_per_year_per_apartment` | Average annual review velocity per apartment |

#### Accommodation Insights

| Column | Description |
|--------|-------------|
| `total_nights` | Total nights across all stays |
| `avg_nights_per_apartment` | Average nights booked per apartment |
| `avg_nights_per_year_per_apartment` | Average annual nights per apartment |

#### Rating Analysis

| Column | Description |
|--------|-------------|
| `overall_avg_rating` | Mean rating across all reviews (1-10 scale) |
| `negative_review_percentage` | Percentage of reviews with rating <= 5 |
| `positive_review_percentage` | Percentage of reviews with rating > 5 |
| `rating_distribution` | Breakdown of ratings by range (1-2, 3-4, 5-6, 7-8, 9-10) |

#### Advanced Business Intelligence

| Column | Description |
|--------|-------------|
| `true_problem_rate` | Percentage of reviews with rating <= 7 |
| `portfolio_stability_score` | Standard deviation of all ratings |
| `host_engagement_score` | Owner response rate to negative reviews (<=7) |
| `market_fit_score` | Annual nights per apartment / average rating |
| `outlier_property_impact` | Rating drag from worst property |

#### Temporal Analysis

| Column | Description |
|--------|-------------|
| `oldest_review_date` | Date of earliest review (YYYY-MM-DD) |
| `newest_review_date` | Date of most recent review (YYYY-MM-DD) |
| `years_covered` | Time span of review data in years |
| `overall_reviews_per_year` | Total annual review velocity |

#### Geographic & Language

| Column | Description |
|--------|-------------|
| `countries_count` | Number of distinct guest countries |
| `top_countries` | Top 3 countries by review volume (format: "Country(count)") |
| `languages_count` | Number of distinct review languages |
| `top_languages` | Top 3 languages by volume (format: "lang(count)") |

#### Engagement Metrics

| Column | Description |
|--------|-------------|
| `avg_helpful_votes` | Average "found helpful" votes per review |
| `owner_response_rate` | Percentage of reviews with owner responses |
| `apartments_with_negative_reviews` | Count of apartments with any ratings <= 5 |
| `apartments_with_negative_reviews_percentage` | Percentage of apartments with any ratings <= 5 |
| `apartments_with_perfect_ratings` | Count of apartments with perfect 10.0 average |

#### Quality Indicators

| Column | Description |
|--------|-------------|
| `worst_property_name` | Apartment ID with lowest average rating |
| `worst_property_rating` | Average rating of worst-performing apartment |

---

## Scripts Reference

| Script | Description |
|--------|-------------|
| `pnpm start` | Run the Booking.com reviews scraper |
| `pnpm dev` | Development mode with hot reload |
| `pnpm transform` | Convert JSON output to CSV format |
| `pnpm analytics` | Generate full historical analytics |
| `pnpm analytics:12m` | Generate 12-month rolling analytics |
