#!/usr/bin/env node

// src/cli.ts
//
// Unified CLI entry point for reviewr
// Usage: reviewr <url> | reviewr <command> [options]

import { Command } from 'commander';
import { resolveProxy, applyProxyToEnv, saveProxy, showAuthStatus } from './config.js';
import { detectPlatform, type Platform } from './utils.js';

const program = new Command();

program
  .name('reviewr')
  .description('Unified CLI for scraping and analyzing hotel/property reviews from Booking.com and Airbnb')
  .version('1.0.0')
  .option('--proxy <url>', 'Use this proxy URL (also saves to config)')
  .option('--no-proxy', 'Disable proxy for this run')
  .option('-p, --print', 'Print output to stdout instead of writing files')
  .option('-f, --format <fmt>', 'Output format: json, csv, or both', 'json')
  .option('-o, --output-dir <dir>', 'Override output directory')
  .option('--booking', 'Force Booking.com platform')
  .option('--airbnb', 'Force Airbnb platform');

/**
 * Resolve platform from flags or auto-detection
 */
function resolvePlatform(input: string | undefined, opts: any): Platform | null {
  if (opts.booking) return 'booking';
  if (opts.airbnb) return 'airbnb';
  if (input) return detectPlatform(input);
  return null;
}

/**
 * Set up proxy env vars before running any command
 */
function setupProxy(opts: any): void {
  if (opts.proxy === false) {
    // --no-proxy flag
    process.env.USE_PROXY = 'false';
    return;
  }

  const cliProxy = typeof opts.proxy === 'string' ? opts.proxy : undefined;
  if (cliProxy) {
    saveProxy(cliProxy);
  }

  const resolved = resolveProxy(cliProxy);
  applyProxyToEnv(resolved);
}

// --- Default command: single URL ---
// Both platforms: fetches listing details by default
program
  .argument('[url]', 'URL to scrape (fetches listing details for both platforms)')
  .option('--download-photos', 'Download listing photos locally')
  .option('--download-photos-all', 'Download ALL room photos (Booking.com)')
  .action(async (url: string | undefined, _options: any, command: Command) => {
    // If no URL and no subcommand, show help
    if (!url) {
      program.help();
      return;
    }

    const opts = command.optsWithGlobals();
    setupProxy(opts);

    const platform = resolvePlatform(url, opts);
    if (!platform) {
      console.error(`Cannot detect platform from URL: ${url}`);
      console.error('Use --booking or --airbnb to specify explicitly.');
      process.exit(1);
    }

    if (platform === 'booking') {
      const bookingListing = await import('./booking/listing.js');
      // Default command auto-extracts dates from URL params
      const details = await bookingListing.scrapeListingDetails(url);

      if (opts.print) {
        console.log(JSON.stringify(details, null, 2));
      } else {
        const outputDir = opts.outputDir || 'data/booking/output';
        const filename = `listing_${details.id}.json`;
        bookingListing.saveListingDetails(details, filename, outputDir);
      }

      if (opts.downloadPhotos || opts.downloadPhotosAll) {
        const outputDir = opts.outputDir || 'data/booking/output';
        await bookingListing.downloadPhotos(details, outputDir, { downloadAll: !!opts.downloadPhotosAll });
      }
    } else {
      const { scrapeListingDetails, saveListingDetails, downloadPhotos } = await import('./airbnb/listing.js');

      // Airbnb scrapeListingDetails already auto-extracts dates from URL
      const details = await scrapeListingDetails(url);

      if (opts.print) {
        console.log(JSON.stringify(details, null, 2));
      } else {
        const outputDir = opts.outputDir || 'data/airbnb/output';
        const filename = `listing_${details.id}.json`;
        saveListingDetails(details, filename, outputDir);
      }

      if (opts.downloadPhotos || opts.downloadPhotosAll) {
        const outputDir = opts.outputDir || 'data/airbnb/output';
        await downloadPhotos(details, outputDir);
      }
    }
  });

// --- reviews command: fetch reviews for a single URL ---
program
  .command('reviews <url>')
  .description('Fetch reviews for a single URL (auto-detects platform)')
  .action(async (url: string, _cmdOpts: any, command: Command) => {
    const opts = command.optsWithGlobals();
    setupProxy(opts);

    const platform = resolvePlatform(url, opts);
    if (!platform) {
      console.error(`Cannot detect platform from URL: ${url}`);
      process.exit(1);
    }

    console.log(`Fetching ${platform} reviews: ${url}`);

    if (platform === 'booking') {
      const { scrapeUrl, saveToJson } = await import('./booking/scraper.js');
      const reviews = await scrapeUrl(url);
      if (opts.print) {
        console.log(JSON.stringify(reviews, null, 2));
      } else {
        const outputDir = opts.outputDir || 'data/booking/output';
        const urlMatch = url.match(/\/hotel\/[a-z]{2}\/([^.]+)\./);
        const filename = urlMatch ? `${urlMatch[1]}.json` : 'output.json';
        saveToJson(reviews, filename, outputDir);
      }
    } else {
      const { scrapeUrl, saveToJson } = await import('./airbnb/scraper.js');
      const reviews = await scrapeUrl(url);
      if (opts.print) {
        console.log(JSON.stringify(reviews, null, 2));
      } else {
        const outputDir = opts.outputDir || 'data/airbnb/output';
        const urlMatch = url.match(/rooms\/(\d+)/);
        const filename = urlMatch ? `room_${urlMatch[1]}_reviews.json` : 'reviews.json';
        saveToJson(reviews, filename, outputDir);
      }
    }
  });

// --- scrape command: batch mode ---
program
  .command('scrape [file-or-dir]')
  .description('Batch scrape reviews from CSV files or directory')
  .action(async (fileOrDir: string | undefined, _options: any, command: Command) => {
    const opts = command.optsWithGlobals();
    setupProxy(opts);

    const platform = resolvePlatform(fileOrDir, opts);

    if (platform === 'booking') {
      const { runBatchScrape } = await import('./booking/scraper.js');
      const inputDir = fileOrDir || 'data/booking/input';
      const outputDir = opts.outputDir || 'data/booking/output';
      await runBatchScrape(inputDir, outputDir);
    } else if (platform === 'airbnb') {
      const { runBatchScrape } = await import('./airbnb/scraper.js');
      const inputDir = fileOrDir || 'data/airbnb/input';
      const outputDir = opts.outputDir || 'data/airbnb/output';
      await runBatchScrape(inputDir, outputDir);
    } else {
      console.error('Cannot determine platform. Use --booking or --airbnb, or provide a path under data/booking/ or data/airbnb/.');
      process.exit(1);
    }
  });

// --- analytics command ---
program
  .command('analytics [file-or-dir]')
  .description('Run analytics on JSON output files')
  .option('--12m', '12-month rolling window filter')
  .action(async (fileOrDir: string | undefined, cmdOpts: any, command: Command) => {
    const opts = command.optsWithGlobals();
    setupProxy(opts);

    const platform = resolvePlatform(fileOrDir, opts);
    const rolling12m = cmdOpts['12m'] || false;

    if (platform === 'booking') {
      const { runAnalytics } = await import('./booking/analytics.js');
      await runAnalytics({
        rolling12m,
        outputDir: fileOrDir || opts.outputDir || undefined,
      });
    } else if (platform === 'airbnb') {
      const { runAnalytics } = await import('./airbnb/analytics.js');
      await runAnalytics({
        rolling12m,
        outputDir: fileOrDir || opts.outputDir || undefined,
      });
    } else {
      console.error('Cannot determine platform. Use --booking or --airbnb.');
      process.exit(1);
    }
  });

// --- transform command (Booking only) ---
program
  .command('transform [file-or-dir]')
  .description('Transform JSON reviews to CSV format (Booking.com only)')
  .action(async (fileOrDir: string | undefined, _options: any, command: Command) => {
    const opts = command.optsWithGlobals();

    const { runTransform } = await import('./booking/transform-to-csv.js');
    runTransform({
      inputDir: fileOrDir || opts.outputDir || undefined,
      outputDir: opts.outputDir ? `${opts.outputDir}-csv` : undefined,
    });
  });

// --- hosts command (Airbnb only) ---
program
  .command('hosts <location>')
  .description('Find Airbnb hosts/agencies in a geographic area')
  .option('--debug', 'Stop early for testing')
  .option('--listings-only', 'Only discover listings, skip host profiles')
  .option('--threshold <n>', 'Min listings to be considered an agency', '5')
  .action(async (location: string, cmdOpts: any, command: Command) => {
    const opts = command.optsWithGlobals();
    setupProxy(opts);

    const { runHostsFinder } = await import('./airbnb/hosts-finder.js');
    await runHostsFinder(location, {
      debug: cmdOpts.debug || false,
      listingsOnly: cmdOpts.listingsOnly || false,
      threshold: parseInt(cmdOpts.threshold),
      outputDir: opts.outputDir || undefined,
    });
  });

// --- details command (both platforms) ---
program
  .command('details <url>')
  .description('Fetch listing details (auto-detects platform: photos, amenities, ratings, etc.)')
  .option('--checkin <date>', 'Check-in date (YYYY-MM-DD) for pricing')
  .option('--checkout <date>', 'Check-out date (YYYY-MM-DD) for pricing')
  .option('--adults <n>', 'Number of adults', '1')
  .option('--download-photos', 'Download listing photos locally')
  .option('--download-photos-all', 'Download ALL room photos (Booking.com)')
  .action(async (url: string, cmdOpts: any, command: Command) => {
    const opts = command.optsWithGlobals();
    setupProxy(opts);

    const platform = resolvePlatform(url, opts);
    if (!platform) {
      console.error(`Cannot detect platform from URL: ${url}`);
      process.exit(1);
    }

    if (platform === 'booking') {
      const bookingListing = await import('./booking/listing.js');
      const details = await bookingListing.scrapeListingDetails(url, {
        checkIn: cmdOpts.checkin || undefined,
        checkOut: cmdOpts.checkout || undefined,
        adults: cmdOpts.adults ? parseInt(cmdOpts.adults) : undefined,
      });

      if (opts.print) {
        console.log(JSON.stringify(details, null, 2));
      } else {
        const outputDir = opts.outputDir || 'data/booking/output';
        const filename = `listing_${details.id}.json`;
        bookingListing.saveListingDetails(details, filename, outputDir);
      }

      if (cmdOpts.downloadPhotos || opts.downloadPhotos || cmdOpts.downloadPhotosAll || opts.downloadPhotosAll) {
        const outputDir = opts.outputDir || 'data/booking/output';
        const downloadAll = !!(cmdOpts.downloadPhotosAll || opts.downloadPhotosAll);
        await bookingListing.downloadPhotos(details, outputDir, { downloadAll });
      }
    } else {
      const { scrapeListingDetails, saveListingDetails, downloadPhotos, parseAirbnbUrl } = await import('./airbnb/listing.js');

      // Auto-extract dates from URL if not provided via flags
      const urlInfo = parseAirbnbUrl(url);
      const checkIn = cmdOpts.checkin || urlInfo.checkIn;
      const checkOut = cmdOpts.checkout || urlInfo.checkOut;
      const adults = parseInt(cmdOpts.adults) || urlInfo.adults;

      const details = await scrapeListingDetails(url, { checkIn, checkOut, adults });

      if (opts.print) {
        console.log(JSON.stringify(details, null, 2));
      } else {
        const outputDir = opts.outputDir || 'data/airbnb/output';
        const filename = `listing_${details.id}.json`;
        saveListingDetails(details, filename, outputDir);
      }

      if (cmdOpts.downloadPhotos || opts.downloadPhotos || cmdOpts.downloadPhotosAll || opts.downloadPhotosAll) {
        const outputDir = opts.outputDir || 'data/airbnb/output';
        await downloadPhotos(details, outputDir);
      }
    }
  });

// --- parse-hosts command (Airbnb only) ---
program
  .command('parse-hosts [file-or-dir]')
  .description('Parse Airbnb host HTML pages to extract property listings')
  .action(async (fileOrDir: string | undefined, _options: any, command: Command) => {
    const opts = command.optsWithGlobals();

    const { runParseHosts } = await import('./airbnb/parse-host-flats.js');
    await runParseHosts({
      inputDir: fileOrDir || undefined,
      outputDir: opts.outputDir || undefined,
    });
  });

// --- preprocess command ---
program
  .command('preprocess <files...>')
  .description('Preprocess URL files: deduplicate, detect dates, classify by platform')
  .action(async (files: string[]) => {
    const { preprocessFiles } = await import('./preprocess.js');
    const result = preprocessFiles(files);
    console.log(JSON.stringify(result, null, 2));
  });

// --- batch command ---
program
  .command('batch [files...]')
  .description('Batch fetch details, reviews, and photos for URLs in text files')
  .option('--details', 'Fetch listing details')
  .option('--reviews', 'Fetch reviews')
  .option('--photos', 'Download photos')
  .option('--ai-reviews', 'Run AI review analysis')
  .option('--ai-photos', 'Run AI photo analysis (Gemini vision)')
  .option('--triage', 'Run AI triage (grade listings against priorities)')
  .option('--model <model>', 'LLM model for AI phases (default: gemini-3-flash-preview:high)')
  .option('--priorities <text>', 'Guest priorities for AI analysis (e.g. "quiet, fresh air")')
  .option('--checkin <date>', 'Check-in date (YYYY-MM-DD)')
  .option('--checkout <date>', 'Check-out date (YYYY-MM-DD)')
  .option('--adults <n>', 'Number of adults')
  .option('--force', 'Re-fetch even if output exists')
  .option('--retry', 'Retry failed/partial listings from manifest')
  .option('--download-photos-all', 'Download ALL room photos (Booking.com)')
  .action(async (files: string[], cmdOpts: any, command: Command) => {
    const opts = command.optsWithGlobals();
    setupProxy(opts);

    if (files.length === 0 && !cmdOpts.retry) {
      console.error('Error: provide URL files or use --retry to retry failures from manifest.');
      process.exit(1);
    }

    // Load .env for LLM API keys
    try { await import('dotenv/config'); } catch {}

    // If no phase flags specified, fetch all (including AI)
    const hasPhaseFlag = cmdOpts.details || cmdOpts.reviews || cmdOpts.photos || cmdOpts.aiReviews || cmdOpts.aiPhotos || cmdOpts.triage;

    const { runBatch } = await import('./batch.js');
    await runBatch(files, {
      fetchDetails: hasPhaseFlag ? !!cmdOpts.details : true,
      fetchReviews: hasPhaseFlag ? !!cmdOpts.reviews : true,
      fetchPhotos: hasPhaseFlag ? !!cmdOpts.photos : true,
      aiReviews: hasPhaseFlag ? !!cmdOpts.aiReviews : true,
      aiPhotos: hasPhaseFlag ? !!cmdOpts.aiPhotos : true,
      triage: hasPhaseFlag ? !!cmdOpts.triage : true,
      aiModel: cmdOpts.model || undefined,
      aiPriorities: cmdOpts.priorities || undefined,
      aiReviewsExplicit: !!cmdOpts.aiReviews,
      aiPhotosExplicit: !!cmdOpts.aiPhotos,
      triageExplicit: !!cmdOpts.triage,
      checkIn: cmdOpts.checkin || undefined,
      checkOut: cmdOpts.checkout || undefined,
      adults: cmdOpts.adults ? parseInt(cmdOpts.adults) : undefined,
      force: !!cmdOpts.force,
      retryFailed: !!cmdOpts.retry,
      downloadPhotosAll: !!(cmdOpts.downloadPhotosAll || opts.downloadPhotosAll),
      outputDir: opts.outputDir || undefined,
      print: !!opts.print,
    });
  });

// --- refresh-hash command ---
program
  .command('refresh-hash')
  .description('Refresh Airbnb API hashes via Playwright (fixes stale pricing)')
  .action(async () => {
    const { refreshHashesViaPlaywright, loadHashes } = await import('./airbnb/hash-manager.js');
    console.log('Current hashes:');
    const current = loadHashes();
    console.log(`  Listing: ${current.listingHash.substring(0, 16)}...`);
    console.log(`  Reviews: ${current.reviewsHash.substring(0, 16)}...`);
    console.log(`  Last refreshed: ${current.lastRefreshed || 'never'}\n`);

    const newHashes = await refreshHashesViaPlaywright();
    console.log('\nNew hashes:');
    console.log(`  Listing: ${newHashes.listingHash.substring(0, 16)}...`);
    console.log(`  Reviews: ${newHashes.reviewsHash.substring(0, 16)}...`);
  });

// --- analyze command: AI-powered review analysis ---
program
  .command('analyze <reviews-file> [listing-file]')
  .description('AI-powered review analysis using Google Gemini')
  .option('--dry-run', 'Output compact text + prompt to stdout, no AI call')
  .option('--prompt <text>', 'Custom question (replaces default analysis prompt)')
  .option('--model <model>', 'LLM model (default: gemini-3-flash-preview:high, supports :thinking-level suffix)')
  .option('--room <text>', 'Filter reviews by room type (substring match on room_view)')
  .option('--priorities <text>', 'Guest priorities to focus on (e.g. "quiet, fresh air, high floor")')
  .option('--all-years', 'Include all reviews regardless of age (default: last 4 years)')
  .action(async (reviewsFile: string, listingFile: string | undefined, cmdOpts: any) => {
    // Load .env for GEMINI_API_KEY
    try { await import('dotenv/config'); } catch {}

    const { runAnalyze } = await import('./analyze.js');
    const result = await runAnalyze({
      reviewsFile,
      listingFile,
      dryRun: !!cmdOpts.dryRun,
      prompt: cmdOpts.prompt || undefined,
      model: cmdOpts.model || undefined,
      room: cmdOpts.room || undefined,
      priorities: cmdOpts.priorities || undefined,
      allYears: !!cmdOpts.allYears,
    });
    if (result.data !== null) {
      console.log(typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2));
    }
  });

// --- analyze-photos command: AI-powered photo analysis ---
program
  .command('analyze-photos <photos-dir>')
  .description('AI-powered photo analysis using Gemini vision')
  .option('--listing <file>', 'Listing JSON file for cross-referencing')
  .option('--model <model>', 'LLM model (default: gemini-3-flash-preview:high)')
  .option('--priorities <text>', 'Guest priorities to check in photos')
  .action(async (photosDir: string, cmdOpts: any) => {
    // Load .env for GEMINI_API_KEY
    try { await import('dotenv/config'); } catch {}

    const { runAnalyzePhotos } = await import('./analyze-photos.js');
    const result = await runAnalyzePhotos({
      photosDir,
      listingFile: cmdOpts.listing || undefined,
      model: cmdOpts.model || undefined,
      priorities: cmdOpts.priorities || undefined,
    });
    console.log(JSON.stringify(result.data, null, 2));
  });

// --- triage command: AI-powered listing triage ---
program
  .command('triage <listing-file>')
  .description('AI-powered listing triage — grade against guest priorities')
  .option('--ai-reviews <file>', 'AI review analysis JSON')
  .option('--ai-photos <file>', 'AI photo analysis JSON')
  .option('--model <model>', 'LLM model (default: gemini-3-flash-preview:high)')
  .option('--priorities <text>', 'Guest requirements to evaluate against')
  .action(async (listingFile: string, cmdOpts: any) => {
    // Load .env for GEMINI_API_KEY
    try { await import('dotenv/config'); } catch {}

    const { runTriage } = await import('./triage.js');
    const result = await runTriage({
      listingFile,
      aiReviewsFile: cmdOpts.aiReviews || undefined,
      aiPhotosFile: cmdOpts.aiPhotos || undefined,
      model: cmdOpts.model || undefined,
      priorities: cmdOpts.priorities || undefined,
    });
    console.log(JSON.stringify(result.data, null, 2));
  });

// --- auth command ---
program
  .command('auth [proxy-url]')
  .description('Configure or check proxy authentication')
  .action(async (proxyUrl: string | undefined) => {
    if (proxyUrl) {
      saveProxy(proxyUrl);
      console.log('\nProxy configured successfully!');
    } else {
      showAuthStatus();
    }
  });

// Parse and execute
program.parseAsync(process.argv).catch((error) => {
  console.error('Fatal error:', error.message || error);
  process.exit(1);
});
