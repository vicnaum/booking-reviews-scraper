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

## Project Structure

```
booking-reviews-scraper/
├── src/
│   └── index.ts          # Main scraper implementation
├── input/                # CSV files with hotel URLs
├── output/               # JSON files with scraped reviews
├── .env                  # Environment configuration (create from .env.example)
├── .env.example          # Example environment file
├── example.csv           # Example input file
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