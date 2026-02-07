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

// --- Default command: scrape a single URL ---
program
  .argument('[url]', 'URL to scrape reviews from (auto-detects platform)')
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

    console.log(`Scraping ${platform} URL: ${url}`);

    if (platform === 'booking') {
      const { scrapeUrl } = await import('./booking/scraper.js');
      const reviews = await scrapeUrl(url);
      if (opts.print) {
        console.log(JSON.stringify(reviews, null, 2));
      } else {
        const { saveToJson } = await import('./booking/scraper.js');
        const outputDir = opts.outputDir || 'data/booking/output';
        // Use hotel name from URL as filename
        const urlMatch = url.match(/\/hotel\/[a-z]{2}\/([^.]+)\./);
        const filename = urlMatch ? `${urlMatch[1]}.json` : 'output.json';
        saveToJson(reviews, filename, outputDir);
      }
    } else {
      const { scrapeUrl } = await import('./airbnb/scraper.js');
      const reviews = await scrapeUrl(url);
      if (opts.print) {
        console.log(JSON.stringify(reviews, null, 2));
      } else {
        const { saveToJson } = await import('./airbnb/scraper.js');
        const outputDir = opts.outputDir || 'data/airbnb/output';
        const urlMatch = url.match(/rooms\/(\d+)/);
        const filename = urlMatch ? `room_${urlMatch[1]}.json` : 'output.json';
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
