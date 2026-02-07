// src/airbnb-scraper.ts
// 
// Batch AirBnB reviews scraper with proxy support
//
// Proxy Configuration:
// - Configure proxy settings in .env file
// - Set USE_PROXY=false in .env to disable proxy
//
// Usage:
//   pnpm tsx src/airbnb-scraper.ts              # Run with proxy enabled (default)

import 'dotenv/config';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as fs from 'fs';
import * as path from 'path';

const AIRBNB_BASE_URL = 'https://www.airbnb.com';
const AIRBNB_API_URL = 'https://www.airbnb.com/api/v3/StaysPdpReviewsQuery/dec1c8061483e78373602047450322fd474e79ba9afa8d3dbbc27f504030f91d/';
const INPUT_DIR = 'data/airbnb/input';
const OUTPUT_DIR = 'data/airbnb/output';

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

// Browser headers for AirBnB requests
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

// API headers for GraphQL requests
const API_HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// Define the structure for a single review object for type safety
interface AirBnBReview {
  property_id: string;
  property_title: string;
  review_id: string | null;
  reviewer_name: string | null;
  reviewer_id: string | null;
  review_date: string | null;
  review_text: string | null;
  rating: number | null;
  reviewer_avatar_url: string | null;
  reviewer_verification_level: string | null;
  response_text: string | null;
  response_date: string | null;
  language: string | null;
  can_be_translated: boolean;
  localized_date: string | null;
}

interface PropertyInfo {
  id: string;
  url: string;
  room_type: string;
  title: string;
  rating_score: string;
  review_count: string;
  status: string;
}

/**
 * Make HTTP request with retry logic and proxy support using Fetch
 */
async function makeRequest(url: string, options: any = {}, maxRetries: number = 3): Promise<{ data: string; status: number; statusText: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds timeout
      
      const fetchOptions: any = {
        ...options,
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
 * Get AirBnB API key by scraping the main page
 */
async function getApiKey(): Promise<string> {
  console.log('🔑 Fetching AirBnB API key...');
  
  const response = await makeRequest(AIRBNB_BASE_URL, {
    headers: BROWSER_HEADERS
  });
  
  const regexApiKey = /"api_config":\{"key":"(.+?)"/;
  const match = regexApiKey.exec(response.data);
  
  if (!match) {
    throw new Error('API key not found in AirBnB homepage');
  }
  
  const apiKey = match[1];
  console.log(`✅ API key obtained: ${apiKey.substring(0, 10)}...`);
  return apiKey;
}

/**
 * Read property info from CSV file
 */
function readPropertiesFromCsv(filePath: string): PropertyInfo[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length === 0) {
      return [];
    }
    
    // Skip header row
    const dataLines = lines.slice(1);
    const properties: PropertyInfo[] = [];
    
    for (const line of dataLines) {
      // Parse CSV - simple splitting by comma (assuming no commas in data)
      const columns = line.split(',');
      if (columns.length >= 6) {
        properties.push({
          id: columns[0].trim(),
          url: columns[1].trim(),
          room_type: columns[2].trim(),
          title: columns[3].trim(),
          rating_score: columns[4].trim(),
          review_count: columns[5].trim(),
          status: columns[6]?.trim() || 'Unknown'
        });
      }
    }
    
    return properties;
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
 * Fetch reviews for a single property with pagination
 */
async function fetchPropertyReviews(apiKey: string, property: PropertyInfo): Promise<AirBnBReview[]> {
  const allReviews: AirBnBReview[] = [];
  const globalId = Buffer.from(`StayListing:${property.id}`).toString('base64');
  let offset = 0;
  const limit = 50;
  
  while (true) {
    try {
      const reviews = await fetchReviewsFromOffset(apiKey, property, globalId, offset, limit);
      
      if (!reviews || reviews.length === 0) {
        break;
      }
      
      allReviews.push(...reviews);
      offset += limit;
      
      if (allReviews.length > 0 && allReviews.length % 100 === 0) {
        console.log(`    📊 Fetched ${allReviews.length} reviews so far...`);
      }
      
      // Be a good internet citizen: add a small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500)); // 0.5-second delay
      
    } catch (error) {
      console.error(`    ❌ Error fetching reviews at offset ${offset}:`, error);
      break;
    }
  }
  
  return allReviews;
}

/**
 * Fetch reviews from a specific offset using AirBnB GraphQL API
 */
async function fetchReviewsFromOffset(
  apiKey: string, 
  property: PropertyInfo, 
  globalId: string, 
  offset: number, 
  limit: number
): Promise<AirBnBReview[]> {
  
  const variablesData = {
    id: globalId,
    pdpReviewsRequest: {
      fieldSelector: "for_p3_translation_only",
      forPreview: false,
      limit: limit,
      offset: String(offset),
      showingTranslationButton: false,
      first: limit,
      sortingPreference: "MOST_RECENT",
      numberOfAdults: "1",
      numberOfChildren: "0",
      numberOfInfants: "0",
      numberOfPets: "0",
      after: null,
    },
  };
  
  const extension = {
    persistedQuery: {
      version: 1,
      sha256Hash: "dec1c8061483e78373602047450322fd474e79ba9afa8d3dbbc27f504030f91d",
    },
  };
  
  const queryParams = new URLSearchParams({
    operationName: "StaysPdpReviewsQuery",
    locale: "en",
    currency: "USD",
    variables: JSON.stringify(variablesData),
    extensions: JSON.stringify(extension),
  });
  
  const url = `${AIRBNB_API_URL}?${queryParams.toString()}`;
  
  const headers = {
    ...API_HEADERS,
    'X-Airbnb-Api-Key': apiKey,
  };
  
  const response = await makeRequest(url, { headers });
  const data = JSON.parse(response.data);
  
  // Navigate to the reviews data
  const reviewsData = getNestedValue(
    data,
    "data.presentation.stayProductDetailPage.reviews.reviews",
    []
  );
  
  // Transform to our format
  const reviews: AirBnBReview[] = [];
  
  for (const reviewData of reviewsData) {
    const review: AirBnBReview = {
      property_id: property.id,
      property_title: property.title,
      review_id: getNestedValue(reviewData, "id", null),
      reviewer_name: getNestedValue(reviewData, "author.firstName", null),
      reviewer_id: getNestedValue(reviewData, "author.id", null),
      review_date: getNestedValue(reviewData, "createdAt", null),
      review_text: getNestedValue(reviewData, "comments", null),
      rating: getNestedValue(reviewData, "rating", null),
      reviewer_avatar_url: getNestedValue(reviewData, "author.pictureUrl", null),
      reviewer_verification_level: getNestedValue(reviewData, "author.verificationLevel", null),
      response_text: getNestedValue(reviewData, "response.response", null),
      response_date: getNestedValue(reviewData, "response.createdAt", null),
      language: getNestedValue(reviewData, "language", null),
      can_be_translated: getNestedValue(reviewData, "canBeTranslated", false),
      localized_date: getNestedValue(reviewData, "localizedDate", null),
    };
    
    reviews.push(review);
  }
  
  return reviews;
}

/**
 * Utility function to get nested values from objects
 */
function getNestedValue(obj: any, keyPath: string, defaultValue: any = null): any {
  const keys = keyPath.split(".");
  let current = obj;
  
  for (const key of keys) {
    if (current && typeof current === "object" && key in current) {
      current = current[key];
    } else {
      return defaultValue;
    }
  }
  
  return current;
}

/**
 * Save combined reviews to JSON file
 */
function saveToJson(reviews: AirBnBReview[], inputFileName: string): void {
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
    properties_processed: Array.from(new Set(reviews.map(r => r.property_id))),
    reviews: reviews
  };

  const jsonString = JSON.stringify(jsonOutput, null, 2);
  fs.writeFileSync(outputPath, jsonString);
  console.log(`✅ Saved ${reviews.length} reviews to ${outputPath}`);
}

/**
 * Process a single CSV file
 */
async function processCsvFile(inputFileName: string, apiKey: string): Promise<void> {
  console.log(`\n📁 Processing: ${inputFileName}`);

  // Check if output already exists
  if (outputFileExists(inputFileName)) {
    console.log(`⏭️  Output file already exists, skipping: ${inputFileName}`);
    return;
  }

  const inputPath = path.join(INPUT_DIR, inputFileName);
  const properties = readPropertiesFromCsv(inputPath);
  
  if (properties.length === 0) {
    console.log(`⚠️  No properties found in: ${inputFileName}`);
    return;
  }

  console.log(`📊 Found ${properties.length} properties to process`);

  // Process each property
  const allReviews: AirBnBReview[] = [];
  const processedProperties: string[] = [];
  const failedProperties: string[] = [];

  for (let i = 0; i < properties.length; i++) {
    const property = properties[i];
    const progress = `[${i + 1}/${properties.length}]`;
    console.log(`🏠 ${progress} Processing property: ${property.title} (${property.id})`);
    
    try {
      const reviews = await fetchPropertyReviews(apiKey, property);
      allReviews.push(...reviews);
      processedProperties.push(property.title);
      console.log(`  ✅ ${progress} Completed: ${property.title} - ${reviews.length} reviews fetched`);
      
      // Add delay between properties
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`  ❌ ${progress} Error processing property ${property.title}:`, error);
      failedProperties.push(property.title);
    }
  }

  // Save results
  if (allReviews.length > 0) {
    saveToJson(allReviews, inputFileName);
  }

  // Summary
  console.log(`\n📋 Summary for ${inputFileName}:`);
  console.log(`  📊 Total properties: ${properties.length}`);
  console.log(`  ✅ Successfully processed: ${processedProperties.length} properties`);
  console.log(`  ❌ Failed to scrape properties: ${failedProperties.length}`);
  console.log(`  📊 Total reviews: ${allReviews.length}`);
  
  if (failedProperties.length > 0) {
    console.log(`  ⚠️  Failed properties: ${failedProperties.join(', ')}`);
  }
}

/**
 * Main function to process all CSV files in input directory
 */
async function main(): Promise<void> {
  console.log('🚀 Starting batch AirBnB reviews scraper...');
  
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

  // Get AirBnB API key once per session
  let apiKey: string;
  try {
    apiKey = await getApiKey();
  } catch (error) {
    console.error('❌ Failed to get AirBnB API key:', error);
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
      await processCsvFile(csvFile, apiKey);
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