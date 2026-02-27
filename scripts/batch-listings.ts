#!/usr/bin/env npx tsx
// scripts/batch-listings.ts
// Batch scrape Airbnb listing details from a URL file
// Usage: npx tsx scripts/batch-listings.ts <url-file> [--platform airbnb|booking] [--output-dir <dir>] [--concurrency <n>]

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const urlFile = args.find(a => !a.startsWith('--')) || '';
const platform = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : 'airbnb';
const outputDir = args.includes('--output-dir') ? args[args.indexOf('--output-dir') + 1] : `data/${platform}/output/rome-listings`;
const concurrency = args.includes('--concurrency') ? parseInt(args[args.indexOf('--concurrency') + 1]) : 5;

if (!urlFile) {
  console.error('Usage: npx tsx scripts/batch-listings.ts <url-file> [--platform airbnb|booking]');
  process.exit(1);
}

// Read URLs from file
const urls = fs.readFileSync(urlFile, 'utf-8')
  .split('\n')
  .map(line => line.replace(/^\s*\d+→/, '').trim())  // Strip line number prefix
  .filter(line => line.startsWith('http'));

console.log(`Found ${urls.length} URLs in ${urlFile}`);
console.log(`Platform: ${platform}, Output: ${outputDir}, Concurrency: ${concurrency}`);

// Ensure output directory exists
fs.mkdirSync(outputDir, { recursive: true });

interface Result {
  url: string;
  id: string;
  success: boolean;
  error?: string;
  data?: any;
}

async function scrapeAirbnb(urls: string[]): Promise<Result[]> {
  const { scrapeListingDetails, parseAirbnbUrl } = await import('../src/airbnb/listing.js');
  const results: Result[] = [];
  let done = 0;

  // Process in batches of `concurrency`
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (url) => {
        const urlInfo = parseAirbnbUrl(url);
        const id = urlInfo.roomId;

        // Check if already scraped
        const outFile = path.join(outputDir, `listing_${id}.json`);
        if (fs.existsSync(outFile)) {
          const existing = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
          done++;
          console.log(`  [${done}/${urls.length}] CACHED ${id} - ${existing.title?.substring(0, 50) || 'no title'}`);
          return { url, id, success: true, data: existing } as Result;
        }

        try {
          const details = await scrapeListingDetails(url, {
            checkIn: urlInfo.checkIn,
            checkOut: urlInfo.checkOut,
            adults: urlInfo.adults,
          });

          // Save individual file
          fs.writeFileSync(outFile, JSON.stringify(details, null, 2));
          done++;
          console.log(`  [${done}/${urls.length}] OK ${id} - ${details.title?.substring(0, 50) || 'no title'}`);
          return { url, id, success: true, data: details } as Result;
        } catch (error: any) {
          done++;
          console.log(`  [${done}/${urls.length}] FAIL ${id} - ${error.message}`);
          return { url, id, success: false, error: error.message } as Result;
        }
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({ url: '', id: '', success: false, error: r.reason?.message || 'Unknown error' });
      }
    }
  }

  return results;
}

async function scrapeBooking(urls: string[]): Promise<Result[]> {
  const { scrapeListingDetails } = await import('../src/booking/listing.js');
  const { extractHotelInfo } = await import('../src/booking/scraper.js');
  const results: Result[] = [];
  let done = 0;

  // Booking uses Playwright so we run sequentially (or low concurrency)
  for (const url of urls) {
    const hotelInfo = extractHotelInfo(url);
    const id = hotelInfo?.hotel_name || 'unknown';

    // Check if already scraped
    const outFile = path.join(outputDir, `listing_${id}.json`);
    if (fs.existsSync(outFile)) {
      const existing = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
      done++;
      console.log(`  [${done}/${urls.length}] CACHED ${id} - ${existing.title?.substring(0, 50) || 'no title'}`);
      results.push({ url, id, success: true, data: existing });
      continue;
    }

    try {
      const details = await scrapeListingDetails(url);
      fs.writeFileSync(outFile, JSON.stringify(details, null, 2));
      done++;
      console.log(`  [${done}/${urls.length}] OK ${id} - ${details.title?.substring(0, 50) || 'no title'}`);
      results.push({ url, id, success: true, data: details });
    } catch (error: any) {
      done++;
      console.log(`  [${done}/${urls.length}] FAIL ${id} - ${error.message}`);
      results.push({ url, id, success: false, error: error.message });
    }
  }

  return results;
}

async function main() {
  console.log(`\nStarting batch scrape of ${urls.length} ${platform} listings...\n`);
  const startTime = Date.now();

  const results = platform === 'airbnb'
    ? await scrapeAirbnb(urls)
    : await scrapeBooking(urls);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const ok = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\nDone in ${elapsed}s: ${ok} success, ${failed} failed`);

  // Save summary
  const summary = results.map(r => ({
    id: r.id,
    url: r.url,
    success: r.success,
    error: r.error,
    title: r.data?.title,
    bedrooms: r.data?.bedrooms,
    beds: r.data?.beds,
    rating: r.data?.rating,
    reviewCount: r.data?.reviewCount,
    pricing: r.data?.pricing?.totalPrice || null,
    sleepingArrangements: r.data?.sleepingArrangements || null,
  }));

  const summaryFile = path.join(outputDir, '_summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  console.log(`Summary saved to ${summaryFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
