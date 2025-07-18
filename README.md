# Booking.com Reviews Scraper

A TypeScript-based batch scraper for extracting hotel reviews from Booking.com with built-in proxy support.
The code is distributed as-is, no warranties or what-so-ever.

## Features

- 🏨 **Batch Processing**: Process multiple hotels from CSV files
- 🔄 **Smart Skip Logic**: Automatically skip already processed files
- 🛡️ **Proxy Support**: Built-in proxy support
- 📊 **Structured Output**: Export reviews to JSON format
- 🔍 **Comprehensive Data**: Extract usernames, ratings, review text, dates, and more
- 🚀 **Production Ready**: Full error handling and retry logic

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
# Proxy Configuration
USE_PROXY=true
PROXY_HOST=proxy-host.com
PROXY_PORT=1000
PROXY_USERNAME=your_username
PROXY_PASSWORD=your_password
```

### Environment Variables

- `USE_PROXY`: Set to `false` to disable proxy usage (default: `true`)
- `PROXY_HOST`: Proxy server hostname
- `PROXY_PORT`: Proxy server port
- `PROXY_USERNAME`: Your proxy username
- `PROXY_PASSWORD`: Your proxy password

## Usage

### 1. Prepare Input Files

Create CSV files in the `input/` directory with booking.com hotel URLs. Each file should contain one URL per line.

**Example: `input/hotels.csv`**
```
https://www.booking.com/hotel/pl/example-hotel.pl.html?aid=123&label=...
https://www.booking.com/hotel/fr/another-hotel.fr.html?aid=456&label=...
```

### 2. Run the Scraper

**Start scraping:**
```bash
pnpm start
```

**Development mode with hot reload:**
```bash
pnpm dev
```

**Build and run:**
```bash
pnpm build
pnpm start
```

### 3. Output

The scraper will:
- Process all CSV files in the `input/` directory
- Extract hotel names from URLs using regex pattern
- Scrape all available reviews for each hotel
- Save results to JSON files in the `output/` directory
- Skip files that have already been processed

**Output file naming:** `input/hotels.csv` → `output/hotels.json`

### 4. CSV Transformation (Optional)

Convert JSON output files to optimized CSV format:

```bash
pnpm transform
```

This processes all JSON files in `output/` (excluding `example.json`) and creates corresponding CSV files in `output-csv/` with the following structure:

| Column | Description |
|--------|-------------|
| `review_date` | Date when the review was posted |
| `rating` | Numerical rating (1-10) |
| `title` | Review title (extracted from full_review) |
| `liked` | What the guest liked (extracted from full_review) |
| `disliked` | What the guest disliked (extracted from full_review) |
| `owner_response` | Hotel owner's response to the review |

**Output file naming:** `output/hotels.json` → `output-csv/hotels.csv`

### 5. Analytics (Optional)

Generate comprehensive statistics from your scraped data:

```bash
# Full historical analytics
pnpm analytics

# 12-month rolling window analytics (from latest review)
pnpm analytics:12m
```

This will analyze all JSON files in the `output/` directory (excluding example files) and generate analytics CSV files with comprehensive business intelligence metrics.

**Output Files:**
- **Historical mode:** `analytics_results.csv` & `raw_reviews_data.csv`
- **12-month mode:** `analytics_results_12m.csv` & `raw_reviews_data_12m.csv`

The analytics include:

### **Core Metrics:**
- **Volume Metrics**: Total reviews, hotels, average reviews per hotel
- **Rating Analysis**: Average ratings, negative review percentages, rating distributions  
- **Temporal Analysis**: Date ranges, years covered, reviews per year
- **Geographic Data**: Country counts, top review countries by volume
- **Language Analysis**: Language diversity in reviews
- **Engagement Metrics**: Helpful votes, owner response rates

### **Advanced Business Intelligence Metrics:**
- **True Problem Rate** (≤7 rating): More realistic view of problematic stays than just counting disasters
- **Portfolio Stability Score** (Standard Deviation): Measures consistency - low = reliable quality, high = rolling the dice
- **Host Engagement Score**: Owner response rate specifically to negative reviews - shows accountability and professionalism
- **Market Fit Score**: Average nights per apartment per year divided by average rating - measures individual apartment ability to achieve high utilization while keeping guests happy
- **Outlier Property Impact**: How much the worst-performing property drags down the company's overall rating

**Example Analytics Output:**
```csv
file_name,company_name,total_reviews,overall_avg_rating,true_problem_rate,portfolio_stability_score,host_engagement_score,market_fit_score,outlier_property_impact,worst_property_name,...
house_managers,House Managers,103,8.95,15.5,1.23,85.7,3.4,-0.45,vintage-house-sopot,...
praia,Praia,360,8.72,18.1,1.45,62.3,19.6,-0.32,seaside-modern-suite,...
```

### **Analytics CSV Column Reference**

The analytics output includes the following columns with detailed business intelligence metrics:

#### **Basic Metrics**
| Column | Description |
|--------|-------------|
| `file_name` | Source JSON filename (without extension) |
| `company_name` | Formatted company name derived from filename |
| `total_reviews` | Total number of high-quality reviews analyzed |
| `total_hotels` | Number of distinct hotels in the dataset |
| `total_apartments` | Number of distinct apartments (hotel + room_view combinations) |

#### **Volume & Distribution**
| Column | Description |
|--------|-------------|
| `avg_reviews_per_apartment` | Average number of reviews per apartment |
| `median_reviews_per_apartment` | Median reviews per apartment (less affected by outliers) |
| `min_reviews_per_apartment` | Minimum reviews for any apartment |
| `max_reviews_per_apartment` | Maximum reviews for any apartment |
| `avg_reviews_per_year_per_apartment` | Average annual review velocity per apartment |

#### **Accommodation Insights**
| Column | Description |
|--------|-------------|
| `total_nights` | Total nights across all stays |
| `avg_nights_per_apartment` | Average nights booked per apartment |
| `avg_nights_per_year_per_apartment` | Average annual nights per apartment |

#### **Rating Analysis**
| Column | Description |
|--------|-------------|
| `overall_avg_rating` | Mean rating across all reviews (1-10 scale) |
| `negative_review_percentage` | Percentage of reviews with rating ≤ 5 |
| `positive_review_percentage` | Percentage of reviews with rating > 5 |
| `rating_distribution` | Breakdown of ratings by range (1-2, 3-4, 5-6, 7-8, 9-10) |

#### **Advanced Business Intelligence**
| Column | Description | Formula | Interpretation |
|--------|-------------|---------|----------------|
| `true_problem_rate` | Percentage of reviews ≤ 7 rating | `(reviews ≤ 7) / total_reviews × 100` | More realistic problem indicator than just counting disasters |
| `portfolio_stability_score` | Standard deviation of all ratings | `√(Σ(rating - mean)² / n)` | **Lower = more consistent quality**; Higher = unpredictable experience |
| `host_engagement_score` | Owner response rate to negative reviews | `responses_to_negative / negative_reviews × 100` | Measures accountability and customer service quality |
| `market_fit_score` | Annual nights per apartment relative to satisfaction | `avg_nights_per_year_per_apartment / avg_rating` | High score = individual apartments achieving high utilization while maintaining quality |
| `outlier_property_impact` | Rating drag from worst property | `avg_without_worst - overall_avg` | How much the worst apartment hurts overall performance |

#### **Temporal Analysis**
| Column | Description |
|--------|-------------|
| `oldest_review_date` | Date of earliest review (YYYY-MM-DD) |
| `newest_review_date` | Date of most recent review (YYYY-MM-DD) |
| `years_covered` | Time span of review data in years |
| `overall_reviews_per_year` | Total annual review velocity |

#### **Geographic & Language**
| Column | Description |
|--------|-------------|
| `countries_count` | Number of distinct guest countries |
| `top_countries` | Top 3 countries by review volume (format: "Country(count)") |
| `languages_count` | Number of distinct review languages |
| `top_languages` | Top 3 languages by volume (format: "lang(count)") |

#### **Engagement Metrics**
| Column | Description |
|--------|-------------|
| `avg_helpful_votes` | Average "found helpful" votes per review |
| `owner_response_rate` | Percentage of reviews with owner responses |
| `apartments_with_negative_reviews` | Count of apartments with any ratings ≤ 5 |
| `apartments_with_negative_reviews_percentage` | Percentage of apartments with any ratings ≤ 5 |
| `apartments_with_perfect_ratings` | Count of apartments with perfect 10.0 average |

#### **Quality Indicators**
| Column | Description |
|--------|-------------|
| `worst_property_name` | Apartment ID with lowest average rating |
| `worst_property_rating` | Average rating of worst-performing apartment |

### **Interpreting Key Metrics**

**Portfolio Stability Score**: Lower values (0.5-1.5) indicate consistent quality across properties. Higher values (2.0+) suggest guests are "rolling the dice" - some properties are excellent while others disappoint.

**Host Engagement Score**: High scores (70%+) show professional customer service with systematic responses to problems. Low scores suggest poor accountability.

**Market Fit Score**: Balances individual apartment utilization and quality. High scores indicate each apartment achieving strong occupancy (nights booked) while maintaining guest satisfaction. This measures per-apartment revenue performance rather than total portfolio volume.

## Project Structure

```
booking-reviews-scraper/
├── src/
│   ├── index.ts          # Main scraper implementation
│   └── analytics.ts      # Analytics and statistics generator
├── input/                # CSV files with hotel URLs
├── output/               # JSON files with scraped reviews
├── .env                  # Environment configuration (create from .env.example)
├── .env.example          # Example environment file
├── example.csv           # Example input file
├── analytics_results.csv # Generated analytics (after running pnpm analytics)
├── package.json          # Project dependencies
└── README.md            # This file
```

## Data Structure

Each review object contains the following fields:

```typescript
interface Review {
  hotel_name: string;
  username: string | null;
  user_country: string | null;
  stay_duration: string | null;
  stay_type: string | null;
  review_post_date: string | null;
  review_title: string | null;
  rating: number | null;
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

## URL Format

The scraper extracts hotel information from booking.com URLs using this pattern:
```
https://www.booking.com/hotel/[COUNTRY]/[HOTEL_NAME].[OPTIONAL-LANG].html
```

**Example:**
- URL: `https://www.booking.com/hotel/pl/hilton-hotel.pl.html`
- Extracted: `hotel_name: "hilton-hotel"`, `country_code: "pl"`

## Error Handling

The scraper includes comprehensive error handling:
- **Retry Logic**: Automatic retries for failed requests (3 attempts with exponential backoff)
- **Proxy Fallback**: Detailed error logging for proxy-related issues
- **Skip Logic**: Automatically skip already processed files
- **Graceful Failures**: Continue processing other files if one fails

## Scripts

- `pnpm start`: Run the scraper
- `pnpm transform`: Convert JSON output files to optimized CSV format
- `pnpm analytics`: Generate analytics CSV from output files
- `pnpm dev`: Development mode with hot reload
- `pnpm build`: Build TypeScript to JavaScript
- `pnpm lint`: Run ESLint
- `pnpm format`: Format code with Prettier

## Rate Limiting

The scraper includes built-in delays and retry logic to respect Booking.com's rate limits:
- Random delays between requests
- Exponential backoff on failures
- Proxy rotation support

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the WTFPL (Do What The F*ck You Want To Public License).

## Disclaimer

This tool is for educational and research purposes only. Please respect the terms of service of the websites you scrape and use this tool responsibly. The authors are not responsible for any misuse of this software. 