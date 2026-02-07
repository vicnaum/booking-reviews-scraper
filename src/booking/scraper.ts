// src/scraper.ts
// 
// Batch hotel reviews scraper with proxy support
//
// Proxy Configuration:
// - Configure proxy settings in .env file
// - Set USE_PROXY=false in .env to disable proxy
//
// Usage:
//   pnpm start                              # Run with proxy enabled (default)

import 'dotenv/config';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'https://www.booking.com/reviewlist.en-gb.html';
const INPUT_DIR = 'data/booking/input';
const OUTPUT_DIR = 'data/booking/output';

// Configuration from environment variables
const USE_PROXY = process.env.USE_PROXY !== 'false'; // Default to true (proxy enabled)

// Proxy configuration from environment variables
const PROXY_CONFIG = {
  host: process.env.PROXY_HOST || '',
  port: parseInt(process.env.PROXY_PORT || '0'),
  username: process.env.PROXY_USERNAME || '',
  password: process.env.PROXY_PASSWORD || ''
};

// Create proxy URL for HttpsProxyAgent
const proxyUrl = `http://${PROXY_CONFIG.username}:${PROXY_CONFIG.password}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`;

// It's crucial to set a User-Agent, as many sites block requests without one.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
  'Connection': 'keep-alive',
};

// Define the structure for a single review object for type safety - matching Python version fields
interface Review {
  hotel_name: string;
  username: string | null;
  user_country: string | null;
  room_view: string | null;
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

interface HotelInfo {
  hotel_name: string;
  country_code: string;
  url: string;
}

/**
 * Make HTTP request with retry logic and proxy support using Fetch
 */
async function makeRequest(url: string, maxRetries: number = 3): Promise<{ data: string; status: number; statusText: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt === 1 && USE_PROXY) {
        console.log(`🔗 Using HTTP proxy: ${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`);
      }
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds timeout
      
      const fetchOptions: any = {
        headers: BROWSER_HEADERS,
        signal: controller.signal
      };
      
      // Add proxy if enabled
      if (USE_PROXY) {
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
      }
      
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      
      const data = await response.text();
      
      return {
        data,
        status: response.status,
        statusText: response.statusText
      };
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;
      
      if (error.name === 'AbortError') {
        console.log(`❌ Request timeout (attempt ${attempt}/${maxRetries})`);
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        console.log(`❌ Connection failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
      } else if (error.message.includes('HTTP')) {
        console.log(`❌ HTTP error (attempt ${attempt}/${maxRetries}): ${error.message}`);
      } else {
        console.log(`❌ Request failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
      }
      
      if (isLastAttempt) {
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('This should never be reached');
}

/**
 * Extract hotel name and country code from booking.com URL
 */
function extractHotelInfo(url: string): HotelInfo | null {
  try {
    // Pattern: https://www.booking.com/hotel/[COUNTRY]/[HOTEL_NAME].[LANG].html
    const regex = /https:\/\/www\.booking\.com\/hotel\/([a-z]{2})\/([^.]+)\./;
    const match = url.match(regex);
    
    if (match) {
      const country_code = match[1];
      const hotel_name = match[2];
      
      return {
        hotel_name,
        country_code,
        url
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error extracting hotel info from URL: ${url}`, error);
    return null;
  }
}

/**
 * Read URLs from CSV file
 */
function readUrlsFromCsv(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const urls = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    return urls;
  } catch (error) {
    console.error(`Error reading CSV file: ${filePath}`, error);
    return [];
  }
}

/**
 * Check if output file already exists
 */
function outputFileExists(inputFileName: string): boolean {
  const outputFileName = inputFileName.replace('.csv', '.json');
  const outputPath = path.join(OUTPUT_DIR, outputFileName);
  return fs.existsSync(outputPath);
}

/**
 * Scrape reviews for a single hotel
 */
async function scrapeHotelReviews(hotelInfo: HotelInfo): Promise<Review[]> {
  console.log(`Starting scraper for hotel: ${hotelInfo.hotel_name} (${hotelInfo.country_code})...`);

  try {
    // 1. Discover the total number of pages to scrape
    const maxOffset = await getMaxOffset(hotelInfo.hotel_name, hotelInfo.country_code);
    if (maxOffset === 0) {
      console.log('Only one page of reviews found, or no pagination present.');
    } else {
      console.log(`Discovered max page offset: ${maxOffset}. Total pages to scrape: ${maxOffset / 10 + 1}`);
    }

    const allReviews: Review[] = [];

    // 2. Loop through each page of reviews
    for (let offset = 0; offset <= maxOffset; offset += 10) {
      const pageUrl = new URL(BASE_URL);
      pageUrl.searchParams.append('cc1', hotelInfo.country_code);
      pageUrl.searchParams.append('pagename', hotelInfo.hotel_name);
      pageUrl.searchParams.append('offset', offset.toString());
      pageUrl.searchParams.append('rows', '10');

      console.log(`  Scraping page: ${offset / 10 + 1}...`);
      
      const response = await makeRequest(pageUrl.href);
      const reviewsOnPage = parseReviewsFromHtml(response.data, hotelInfo.hotel_name);
      allReviews.push(...reviewsOnPage);

      // Be a good internet citizen: add a small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500)); // 0.5-second delay
    }

    console.log(`  ✅ Scraped ${allReviews.length} reviews for ${hotelInfo.hotel_name}`);
    return allReviews;

  } catch (error) {
    console.error(`Error scraping hotel ${hotelInfo.hotel_name}:`, error);
    return [];
  }
}

/**
 * Fetches the first page to find the last page's offset value.
 */
async function getMaxOffset(hotelName: string, countryCode: string): Promise<number> {
  const initialUrl = new URL(BASE_URL);
  initialUrl.searchParams.append('cc1', countryCode);
  initialUrl.searchParams.append('pagename', hotelName);
  initialUrl.searchParams.append('rows', '10');

  const { data } = await makeRequest(initialUrl.href);
  const $ = cheerio.load(data);
  
  // Find the pagination links - looking for the last page link with "Page " text
  const paginationLinks = $('div.bui-pagination__pages > div.bui-pagination__list > div.bui-pagination__item > a');
  let maxOffset = 0;

  paginationLinks.each((_, element) => {
    const $link = $(element);
    const href = $link.attr('href');
    const text = $link.text();
    
    if (href && text.includes('Page ')) {
      const url = new URL(href, BASE_URL);
      const offset = url.searchParams.get('offset');
      if (offset) {
        const offsetValue = parseInt(offset.split(';')[0], 10);
        if (!isNaN(offsetValue) && offsetValue > maxOffset) {
          maxOffset = offsetValue;
        }
      }
    }
  });

  return maxOffset;
}

/**
 * Utility function to validate and clean text content
 */
function validateText(element: cheerio.Cheerio<any> | string | null): string | null {
  if (!element) return null;
  
  let text: string;
  if (typeof element === 'string') {
    text = element;
  } else {
    text = element.text();
  }
  
  // Remove multiple spaces and strip newlines
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

/**
 * Parses the HTML content of a review page to extract review details.
 */
function parseReviewsFromHtml(html: string, hotelName: string): Review[] {
  const $ = cheerio.load(html);
  const reviews: Review[] = [];

  // Use the correct selector from the Python version
  $('ul.review_list > li').each((_, element) => {
    const el = $(element);

    // Extract username
    const username = validateText(el.find('div.c-review-block__guest span.bui-avatar-block__title'));
    
    // Extract user country
    const user_country = validateText(el.find('div.c-review-block__guest span.bui-avatar-block__subtitle'));
    
    // Extract room view
    const room_view = validateText(el.find('div.c-review-block__room-info-row div.bui-list__body'));
    
    // Extract stay duration
    let stay_duration = validateText(el.find('ul.c-review-block__stay-date div.bui-list__body'));
    if (stay_duration) {
      stay_duration = stay_duration.split(' ·')[0];
    }
    
    // Extract stay type
    const stay_type = validateText(el.find('ul.review-panel-wide__traveller_type div.bui-list__body'));
    
    // Extract review title
    const review_title = validateText(el.find('h3.c-review-block__title'));
    
    // Extract review date
    let review_post_date: string | null = null;
    el.find('span').each((_, span) => {
      const spanText = $(span).text();
      if (spanText.includes('Reviewed:')) {
        const dateText = spanText.split(':').slice(1).join(':').trim();
        try {
          const date = new Date(dateText);
          review_post_date = date.toISOString().slice(0, 19).replace('T', ' ');
        } catch (e) {
          review_post_date = dateText;
        }
      }
    });
    
    // Extract rating
    const ratingStr = validateText(el.find('div.bui-review-score__badge'));
    const rating = ratingStr ? parseFloat(ratingStr) : null;
    
    // Extract review texts
    const reviewTexts = el.find('div.c-review span.c-review__body');
    let review_text_liked: string | null = null;
    let review_text_disliked: string | null = null;
    let original_lang: string | null = null;
    
    if (reviewTexts.length > 0) {
      const firstReview = reviewTexts.eq(0);
      review_text_liked = validateText(firstReview);
      original_lang = firstReview.attr('lang') || null;
      
      // Check if it's a "no comments" message
      if (review_text_liked && review_text_liked.toLowerCase().includes('there are no comments available')) {
        review_text_liked = null;
      }
      
      if (reviewTexts.length > 1) {
        review_text_disliked = validateText(reviewTexts.eq(1));
        if (!review_text_disliked && reviewTexts.length > 2) {
          review_text_disliked = validateText(reviewTexts.eq(2));
        }
      }
    }
    
    // Create full review text
    const titlePart = review_title ? `title: ${review_title}${review_title.match(/[.!?]$/) ? '' : '.'}` : '';
    const likedPart = review_text_liked ? `liked: ${review_text_liked}${review_text_liked.match(/[.!?]$/) ? '' : '.'}` : '';
    const dislikedPart = review_text_disliked ? `disliked: ${review_text_disliked}${review_text_disliked.match(/[.!?]$/) ? '' : '.'}` : '';
    
    const full_review = validateText([titlePart, likedPart, dislikedPart].filter(p => p).join(' '));
    const en_full_review = original_lang && original_lang.includes('en') ? full_review : null;
    
    // Extract helpful votes
    let found_helpful = 0;
    const helpfulText = validateText(el.find('div.c-review-block__row--helpful-vote p.review-helpful__vote-others-helpful'));
    if (helpfulText) {
      const helpfulMatch = helpfulText.match(/(\d+)\s+(people|person)/);
      if (helpfulMatch) {
        found_helpful = parseInt(helpfulMatch[1], 10);
      }
    }
    
    // Extract unhelpful votes
    let found_unhelpful = 0;
    const unhelpfulText = validateText(el.find('div.c-review-block__row--helpful-vote p.--unhelpful'));
    if (unhelpfulText) {
      const unhelpfulMatch = unhelpfulText.match(/(\d+)\s+(people|person)/);
      if (unhelpfulMatch) {
        found_unhelpful = parseInt(unhelpfulMatch[1], 10);
      }
    }
    
    // Extract owner response
    const ownerResponseElements = el.find('div.c-review-block__response span.c-review-block__response__body');
    const owner_resp_text = ownerResponseElements.length > 0 
      ? validateText(ownerResponseElements.last()) 
      : null;

    const review: Review = {
      hotel_name: hotelName,
      username,
      user_country,
      room_view,
      stay_duration,
      stay_type,
      review_post_date,
      review_title,
      rating,
      original_lang,
      review_text_liked,
      review_text_disliked,
      full_review,
      en_full_review,
      found_helpful,
      found_unhelpful,
      owner_resp_text,
    };

    reviews.push(review);
  });

  return reviews;
}

/**
 * Save combined reviews to JSON file
 */
function saveToJson(reviews: Review[], inputFileName: string): void {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputFileName = inputFileName.replace('.csv', '.json');
  const outputPath = path.join(OUTPUT_DIR, outputFileName);

  const jsonOutput = {
    input_file: inputFileName,
    scraped_at: new Date().toISOString(),
    total_reviews: reviews.length,
    hotels_processed: [...new Set(reviews.map(r => r.hotel_name))],
    reviews: reviews
  };

  const jsonString = JSON.stringify(jsonOutput, null, 2);
  fs.writeFileSync(outputPath, jsonString);
  console.log(`✅ Saved ${reviews.length} reviews to ${outputPath}`);
}

/**
 * Process a single CSV file
 */
async function processCsvFile(inputFileName: string): Promise<void> {
  console.log(`\n📁 Processing: ${inputFileName}`);

  // Check if output already exists
  if (outputFileExists(inputFileName)) {
    console.log(`⏭️  Output file already exists, skipping: ${inputFileName}`);
    return;
  }

  const inputPath = path.join(INPUT_DIR, inputFileName);
  const urls = readUrlsFromCsv(inputPath);
  
  if (urls.length === 0) {
    console.log(`⚠️  No URLs found in: ${inputFileName}`);
    return;
  }

  console.log(`📊 Found ${urls.length} URLs to process`);

  // Step 1: Extract and deduplicate hotel info
  const hotelInfoMap = new Map<string, HotelInfo>();
  const failedUrls: string[] = [];

  for (const url of urls) {
    const hotelInfo = extractHotelInfo(url);
    
    if (!hotelInfo) {
      console.log(`❌ Failed to extract hotel info from URL: ${url}`);
      failedUrls.push(url);
      continue;
    }

    // Create unique key: hotel_name + country_code
    const hotelKey = `${hotelInfo.hotel_name}_${hotelInfo.country_code}`;
    
    if (!hotelInfoMap.has(hotelKey)) {
      hotelInfoMap.set(hotelKey, hotelInfo);
    } else {
      console.log(`🔄 Duplicate hotel found, skipping: ${hotelInfo.hotel_name} (${hotelInfo.country_code})`);
    }
  }

  const uniqueHotels = Array.from(hotelInfoMap.values());
  console.log(`📊 Found ${urls.length} URLs, deduplicated to ${uniqueHotels.length} unique hotels`);

  // Step 2: Process unique hotels
  const allReviews: Review[] = [];
  const processedHotels: string[] = [];
  const failedHotels: string[] = [];

  for (const hotelInfo of uniqueHotels) {
    console.log(`🏨 Processing hotel: ${hotelInfo.hotel_name} (${hotelInfo.country_code})`);
    
    try {
      const reviews = await scrapeHotelReviews(hotelInfo);
      allReviews.push(...reviews);
      processedHotels.push(hotelInfo.hotel_name);
      
      // Add delay between hotels
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Error processing hotel ${hotelInfo.hotel_name}:`, error);
      failedHotels.push(hotelInfo.hotel_name);
    }
  }

  // Save results
  if (allReviews.length > 0) {
    saveToJson(allReviews, inputFileName);
  }

  // Summary
  console.log(`\n📋 Summary for ${inputFileName}:`);
  console.log(`  📊 Total URLs: ${urls.length}`);
  console.log(`  🔄 Unique hotels: ${uniqueHotels.length}`);
  console.log(`  ✅ Successfully processed: ${processedHotels.length} hotels`);
  console.log(`  ❌ Failed to parse URLs: ${failedUrls.length}`);
  console.log(`  ❌ Failed to scrape hotels: ${failedHotels.length}`);
  console.log(`  📊 Total reviews: ${allReviews.length}`);
  
  if (failedUrls.length > 0) {
    console.log(`  ⚠️  Failed URLs: ${failedUrls.join(', ')}`);
  }
  if (failedHotels.length > 0) {
    console.log(`  ⚠️  Failed hotels: ${failedHotels.join(', ')}`);
  }
}

/**
 * Main function to process all CSV files in input directory
 */
async function main(): Promise<void> {
  console.log('🚀 Starting batch hotel reviews scraper...');
  
  // Show proxy status
  if (USE_PROXY) {
    if (PROXY_CONFIG.host && PROXY_CONFIG.username) {
      console.log(`🔗 Proxy enabled: ${PROXY_CONFIG.host}:${PROXY_CONFIG.port} (${PROXY_CONFIG.username})`);
    } else {
      console.log('❌ Proxy enabled but missing configuration in .env file');
      process.exit(1);
    }
  } else {
    console.log('🚫 Proxy disabled - running without proxy');
  }

  // Ensure input directory exists
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ Input directory not found: ${INPUT_DIR}`);
    process.exit(1);
  }

  // Get all CSV files from input directory
  const csvFiles = fs.readdirSync(INPUT_DIR)
    .filter(file => file.endsWith('.csv'))
    .sort();

  if (csvFiles.length === 0) {
    console.log(`⚠️  No CSV files found in ${INPUT_DIR} directory`);
    process.exit(0);
  }

  console.log(`📂 Found ${csvFiles.length} CSV files to process`);

  // Process each CSV file
  for (const csvFile of csvFiles) {
    try {
      await processCsvFile(csvFile);
    } catch (error) {
      console.error(`❌ Error processing file ${csvFile}:`, error);
    }
  }

  console.log('\n🎉 Batch processing completed!');
}

// --- Run the Scraper ---
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});