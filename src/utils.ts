// src/utils.ts
//
// Shared utilities for reviewr CLI: platform detection, URL parsing, output helpers

import * as fs from 'fs';
import * as path from 'path';

export type Platform = 'booking' | 'airbnb';

/**
 * Detect platform from a URL or file path
 */
export function detectPlatform(input: string): Platform | null {
  const lower = input.toLowerCase();

  // URL patterns
  if (lower.includes('booking.com')) return 'booking';
  if (lower.includes('airbnb.com')) return 'airbnb';

  // File path patterns
  if (lower.includes('data/booking') || lower.includes('data\\booking')) return 'booking';
  if (lower.includes('data/airbnb') || lower.includes('data\\airbnb')) return 'airbnb';

  return null;
}

/**
 * Extract Airbnb room ID from a URL like https://www.airbnb.com/rooms/12345
 */
export function extractAirbnbRoomId(url: string): string | null {
  const match = url.match(/airbnb\.com\/rooms\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract Booking.com hotel info from URL
 * Pattern: https://www.booking.com/hotel/[COUNTRY]/[HOTEL_NAME].[LANG].html
 */
export function extractBookingHotelInfo(url: string): { hotel_name: string; country_code: string } | null {
  const regex = /https:\/\/www\.booking\.com\/hotel\/([a-z]{2})\/([^.]+)\./;
  const match = url.match(regex);
  if (match) {
    return { country_code: match[1], hotel_name: match[2] };
  }
  return null;
}

/**
 * Resolve input file/dir paths. Handles:
 * - Explicit file path
 * - Explicit directory path
 * - --booking / --airbnb flags → default dirs
 */
export function resolveInputPath(
  fileOrDir: string | undefined,
  platform: Platform | null,
  defaultSubdir: string
): string[] {
  // If explicit path provided
  if (fileOrDir) {
    const resolved = path.resolve(fileOrDir);
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        return getFilesInDir(resolved);
      }
      return [resolved];
    }
    console.error(`Path not found: ${fileOrDir}`);
    process.exit(1);
  }

  // Fall back to platform default directory
  if (platform) {
    const defaultDir = `data/${platform}/${defaultSubdir}`;
    if (fs.existsSync(defaultDir)) {
      return getFilesInDir(defaultDir);
    }
    console.error(`Default directory not found: ${defaultDir}`);
    process.exit(1);
  }

  console.error('Cannot determine input. Provide a file/dir path or --booking/--airbnb flag.');
  process.exit(1);
}

function getFilesInDir(dir: string): string[] {
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith('.'))
    .map(f => path.join(dir, f))
    .sort();
}

/**
 * Write output — either print to stdout or write to file
 */
export function writeOutput(
  data: any,
  opts: { print?: boolean; format?: string; outputDir?: string; filename?: string }
): void {
  const { print, format = 'json', outputDir, filename } = opts;

  if (print) {
    if (format === 'json' || typeof data === 'object') {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(data);
    }
    return;
  }

  if (!outputDir || !filename) {
    // If not printing and no output path, default to stdout
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, filename);
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(outputPath, content);
  console.log(`Output saved to: ${outputPath}`);
}
