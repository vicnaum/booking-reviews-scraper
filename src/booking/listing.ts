// src/booking/listing.ts
//
// Booking.com listing details scraper using Playwright headless browser
//
// Uses Playwright to bypass AWS WAF JS challenge and extract full hotel details:
// name, description, address, coordinates, photos, amenities, ratings, sub-ratings,
// star rating, check-in/out times, and policies.
//
// Usage:
//   reviewr <booking-url>                    # Fetch listing details
//   reviewr details <booking-url> -p         # Print to stdout
//   npx tsx src/booking/listing.ts <url>     # Direct execution

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { extractHotelInfo } from './scraper.js';

const OUTPUT_DIR = 'data/booking/output';

// --- Interfaces ---

export interface BookingListingDetails {
  id: string;
  hotelId: number | null;
  url: string;
  title: string;
  description: string;
  propertyType: string | null;
  stars: number | null;
  address: BookingAddress | null;
  coordinates: { lat: number; lng: number } | null;
  photos: BookingPhoto[];
  amenities: string[];
  rating: number | null;
  ratingText: string | null;
  reviewCount: number | null;
  subRatings: Record<string, number> | null;
  checkIn: string | null;
  checkOut: string | null;
  linkedRoomId: string | null;
  rooms: BookingRoom[];
  pricing: BookingPricing | null;
  scrapedAt: string;
}

export interface BookingAddress {
  street: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  full: string | null;
}

export interface BookingPhoto {
  url: string;
  caption: string | null;
  id: string | null;
  highresUrl: string | null;
  associatedRooms: string[];
  orientation: string | null;
  created: string | null;
}

export interface BookingRoom {
  id: string;
  name: string;
  blockIds: string[];
  photos: BookingPhoto[];
}

export interface BookingPricing {
  currency: string | null;
  rooms: BookingRoomPrice[];
}

export interface BookingRoomPrice {
  roomName: string;
  roomId: string;
  pricePerNight: string | null;
  totalPrice: string | null;
  occupancy: string | null;
  mealPlan: string | null;
  cancellation: string | null;
}

// --- Playwright page fetching ---

async function fetchHotelPageHtml(url: string, options?: { hasDates?: boolean }): Promise<string> {
  const { chromium } = await import('playwright');

  console.log('  Launching headless browser...');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      locale: 'en-GB',
    });
    const page = await context.newPage();

    console.log('  Navigating to hotel page...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Check for WAF challenge and wait for it to resolve
    let html = await page.content();
    if (html.includes('awsWafCookieDomainList') || html.includes('challenge.js')) {
      console.log('  WAF challenge detected, waiting for resolution...');
      try {
        await page.waitForURL('**/*', { timeout: 30000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
      } catch {
        await page.waitForTimeout(10000);
      }
      html = await page.content();
    }

    // Wait for key content to be present
    try {
      await page.waitForSelector('[data-testid="property-description"], #property_description_content', { timeout: 10000 });
    } catch {
      // Page may have loaded but without the expected selector — use what we have
    }

    // When dates are provided, also wait for the availability/pricing table
    if (options?.hasDates) {
      try {
        console.log('  Waiting for availability table...');
        await page.waitForSelector('.hprt-table', { timeout: 10000 });
      } catch {
        // Availability table may not appear for some properties
      }
    }

    // Try expanding description "Read more" button
    try {
      const descButton = page.locator('[data-testid="property-description"] button').first();
      if (await descButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await descButton.click();
        await page.waitForTimeout(500);
      }
    } catch {
      // Expansion not available
    }

    // Try expanding facilities/amenities section
    try {
      const facilitiesButtons = page.locator('button:has-text("Show all facilities"), button:has-text("See all facilities"), button:has-text("Show all amenities")');
      const count = await facilitiesButtons.count();
      for (let i = 0; i < count; i++) {
        try {
          await facilitiesButtons.nth(i).click();
          await page.waitForTimeout(500);
        } catch {
          // Individual button click failed
        }
      }
    } catch {
      // Expansion not available
    }

    html = await page.content();

    if (html.length < 10000) {
      throw new Error('Failed to load hotel page (WAF challenge not resolved or page unavailable)');
    }

    console.log(`  Page loaded (${(html.length / 1024).toFixed(0)} KB)`);
    return html;
  } finally {
    await browser.close();
  }
}

// --- HTML parsing ---

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extract the linked room ID from URL query params (matching_block_id or highlighted_blocks).
 * The room ID is the first numeric segment before the underscore.
 */
function extractLinkedRoomId(url: string): string | null {
  try {
    const u = new URL(url);
    const blockParam = u.searchParams.get('matching_block_id') || u.searchParams.get('highlighted_blocks');
    if (!blockParam) return null;
    const match = blockParam.match(/^(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Parse the hotelPhotos JS array from the page HTML.
 * Returns enriched BookingPhoto[] with room associations, or null if parsing fails.
 */
function parseHotelPhotos(html: string): BookingPhoto[] | null {
  // Find the hotelPhotos array start
  const marker = 'hotelPhotos:';
  const altMarker = 'hotelPhotos =';
  let startIdx = html.indexOf(marker);
  if (startIdx === -1) startIdx = html.indexOf(altMarker);
  if (startIdx === -1) return null;

  // Find the opening bracket
  const bracketStart = html.indexOf('[', startIdx);
  if (bracketStart === -1 || bracketStart - startIdx > 50) return null;

  // Use bracket counting to find the matching closing bracket
  let depth = 0;
  let end = -1;
  for (let i = bracketStart; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;

  let jsArray = html.slice(bracketStart, end + 1);

  // Convert JS object notation to valid JSON:
  // 1. Replace single-quoted strings with double-quoted
  // 2. Quote unquoted keys
  // 3. Remove trailing commas
  try {
    // Replace single quotes with double quotes (careful with escaped quotes)
    jsArray = jsArray.replace(/'/g, '"');
    // Quote unquoted keys: word characters followed by colon
    jsArray = jsArray.replace(/(\{|,)\s*(\w+)\s*:/g, '$1"$2":');
    // Remove trailing commas before ] or }
    jsArray = jsArray.replace(/,\s*([\]}])/g, '$1');

    const parsed = JSON.parse(jsArray);
    if (!Array.isArray(parsed)) return null;

    return parsed.map((p: any) => {
      const photoId = String(p.id || '');
      const highresUrl = p.highres_url || p.highResUrl || null;
      const largeUrl = p.large_url || p.largeUrl || '';
      const url = highresUrl || largeUrl;
      if (!url) return null;

      // Normalize URL to max1024x768 for the standard url field
      const idMatch = url.match(/hotel\/[^/]+\/(\d+)\./);
      const normalizedUrl = idMatch
        ? `https://cf.bstatic.com/xdata/images/hotel/max1024x768/${idMatch[1]}.jpg`
        : url;

      return {
        url: normalizedUrl,
        caption: p.alt || null,
        id: photoId || null,
        highresUrl: highresUrl || null,
        associatedRooms: Array.isArray(p.associated_rooms) ? p.associated_rooms.map(String) : [],
        orientation: p.orientation || null,
        created: p.created || null,
      } as BookingPhoto;
    }).filter(Boolean) as BookingPhoto[];
  } catch {
    return null;
  }
}

/**
 * Parse room info from the availability table.
 * Associates photos with rooms via associatedRooms field.
 */
function parseRooms($: cheerio.CheerioAPI, photos: BookingPhoto[]): BookingRoom[] {
  const roomMap = new Map<string, { name: string; blockIds: string[] }>();

  $('tr[data-block-id]').each((_, el) => {
    const blockId = $(el).attr('data-block-id') || '';
    if (!blockId) return;

    // Room ID is the first numeric segment before underscore
    const roomIdMatch = blockId.match(/^(\d+)/);
    if (!roomIdMatch) return;
    const roomId = roomIdMatch[1];

    const existing = roomMap.get(roomId);
    if (existing) {
      if (!existing.blockIds.includes(blockId)) {
        existing.blockIds.push(blockId);
      }
    } else {
      // Get room name from the link in this row or a preceding row with the same room ID
      let name = '';
      const nameEl = $(el).find('.hprt-roomtype-link');
      if (nameEl.length) {
        name = cleanText(nameEl.text());
      }
      roomMap.set(roomId, { name, blockIds: [blockId] });
    }
  });

  return Array.from(roomMap.entries()).map(([roomId, info]) => ({
    id: roomId,
    name: info.name,
    blockIds: info.blockIds,
    photos: photos.filter(p => p.associatedRooms.includes(roomId)),
  }));
}

/**
 * Parse pricing info from the availability table.
 * Requires dates to be present in the URL for Booking to show prices.
 */
function parsePricing($: cheerio.CheerioAPI): BookingPricing | null {
  const rows = $('tr[data-block-id]');
  if (rows.length === 0) return null;

  // Detect currency from the page
  let currency: string | null = null;
  const currencyEl = $('input[name="selected_currency"]');
  if (currencyEl.length) {
    currency = currencyEl.attr('value') || null;
  }
  if (!currency) {
    // Try to extract from price text
    const priceText = $('.bui-price-display__value, .prco-valign-middle-helper, [data-testid="price-and-discounted-price"]').first().text();
    const currencyMatch = priceText.match(/(USD|EUR|GBP|[A-Z]{3}|[$\u20AC\u00A3\u00A5])/);
    if (currencyMatch) currency = currencyMatch[1];
  }

  const roomPrices: BookingRoomPrice[] = [];
  const seenRooms = new Map<string, boolean>();

  rows.each((_, el) => {
    const $row = $(el);
    const blockId = $row.attr('data-block-id') || '';
    const roomIdMatch = blockId.match(/^(\d+)/);
    if (!roomIdMatch) return;

    const roomId = roomIdMatch[1];
    // Only take the first (cheapest) option per room
    if (seenRooms.has(roomId)) return;
    seenRooms.set(roomId, true);

    // Room name
    let roomName = '';
    const nameLink = $row.find('.hprt-roomtype-link');
    if (nameLink.length) {
      roomName = cleanText(nameLink.text());
    }

    // Price - try multiple selectors
    let totalPrice: string | null = null;
    const priceEl = $row.find('.bui-price-display__value, .prco-valign-middle-helper, [data-testid="price-and-discounted-price"]').first();
    if (priceEl.length) {
      totalPrice = cleanText(priceEl.text());
    }

    // Per night price (some layouts show this separately)
    let pricePerNight: string | null = null;
    const perNightEl = $row.find('.hprt-price-price-per-night, .bui-price-display__per-night').first();
    if (perNightEl.length) {
      pricePerNight = cleanText(perNightEl.text());
    }

    // Occupancy
    let occupancy: string | null = null;
    const occupancyEl = $row.find('.hprt-occupancy-occupancy-info .bui-u-sr-only, [data-testid="occupancy-popup"]').first();
    if (occupancyEl.length) {
      occupancy = cleanText(occupancyEl.text());
    }

    // Meal plan
    let mealPlan: string | null = null;
    const mealEl = $row.find('.hprt-facilities-facility span, [data-testid="meal-plan"]').first();
    if (mealEl.length) {
      const text = cleanText(mealEl.text());
      if (text.toLowerCase().includes('breakfast') || text.toLowerCase().includes('meal') || text.toLowerCase().includes('dinner')) {
        mealPlan = text;
      }
    }

    // Cancellation
    let cancellation: string | null = null;
    const cancelEl = $row.find('.bui-badge--outline, .hprt-conditions-text, [data-testid="cancellation-policy"]').first();
    if (cancelEl.length) {
      cancellation = cleanText(cancelEl.text());
    }

    roomPrices.push({
      roomName,
      roomId,
      pricePerNight,
      totalPrice,
      occupancy,
      mealPlan,
      cancellation,
    });
  });

  if (roomPrices.length === 0) return null;

  return { currency, rooms: roomPrices };
}

/**
 * Extract facility names from the Apollo cache embedded in the page.
 * The cache is in a <script data-capla-store-data="apollo" type="application/json"> tag.
 */
function parseApolloFacilities(html: string): string[] {
  const marker = 'data-capla-store-data="apollo"';
  const idx = html.indexOf(marker);
  if (idx === -1) return [];

  const jsonStart = html.indexOf('>', idx) + 1;
  const jsonEnd = html.indexOf('</script>', jsonStart);
  if (jsonEnd === -1 || jsonStart <= 0) return [];

  try {
    const apollo = JSON.parse(html.substring(jsonStart, jsonEnd));
    const facilities = new Set<string>();

    for (const [key, val] of Object.entries(apollo) as [string, any][]) {
      // Instance entries (individual facilities)
      if (key.startsWith('Instance:') && val?.title) {
        facilities.add(val.title);
      }
      // FacilityHighlight entries (includes room-level amenities like Private bathroom)
      if (key.includes('FacilityHighlight') && val?.title) {
        facilities.add(val.title);
      }
    }

    return [...facilities];
  } catch {
    return [];
  }
}

function parseHotelPage(html: string): Partial<BookingListingDetails> {
  const $ = cheerio.load(html);
  const result: Partial<BookingListingDetails> = {};

  // --- JSON-LD (most reliable structured data) ---
  const jsonLdBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdBlocks) {
    for (const block of jsonLdBlocks) {
      const content = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
      try {
        const data = JSON.parse(content);
        if (data['@type'] === 'Hotel' || data['@type'] === 'LodgingBusiness') {
          result.title = data.name || undefined;
          result.description = data.description || undefined;

          if (data.address) {
            result.address = {
              street: data.address.streetAddress || null,
              city: data.address.addressLocality || null,
              region: data.address.addressRegion || null,
              postalCode: data.address.postalCode || null,
              country: data.address.addressCountry || null,
              full: data.address.streetAddress || null,
            };
          }

          if (data.aggregateRating) {
            result.rating = parseFloat(data.aggregateRating.ratingValue) || null;
            result.reviewCount = parseInt(data.aggregateRating.reviewCount) || null;
          }

          if (data.image) {
            // JSON-LD image is just the main photo — we'll get the full gallery separately
          }
        }
      } catch {
        // Invalid JSON-LD, skip
      }
    }
  }

  // --- Coordinates ---
  const mapEl = $('[data-atlas-latlng]').first();
  if (mapEl.length) {
    const latlng = mapEl.attr('data-atlas-latlng');
    if (latlng) {
      const [lat, lng] = latlng.split(',').map(Number);
      if (!isNaN(lat) && !isNaN(lng)) {
        result.coordinates = { lat, lng };
      }
    }
  }
  // Fallback: regex in HTML
  if (!result.coordinates) {
    const latMatch = html.match(/"latitude"\s*:\s*(-?[\d.]+)/);
    const lngMatch = html.match(/"longitude"\s*:\s*(-?[\d.]+)/);
    if (latMatch && lngMatch) {
      const lat = parseFloat(latMatch[1]);
      const lng = parseFloat(lngMatch[1]);
      if (!isNaN(lat) && !isNaN(lng)) {
        result.coordinates = { lat, lng };
      }
    }
  }

  // --- Star rating ---
  const starSpans = $('[data-testid="rating-stars"] span');
  if (starSpans.length > 0) {
    result.stars = starSpans.length;
  }

  // --- Description (DOM typically has longer text than JSON-LD) ---
  {
    let domDescription = '';
    const descEl = $('[data-testid="property-description"]');
    if (descEl.length) {
      domDescription = cleanText(descEl.text());
    } else {
      const fallback = $('#property_description_content, .hp_desc_main_content');
      if (fallback.length) {
        domDescription = cleanText(fallback.text());
      }
    }
    if (domDescription && domDescription.length > (result.description?.length || 0)) {
      result.description = domDescription;
    }
  }

  // --- Photos ---
  // Try parsing the hotelPhotos JS array first (has room associations)
  const richPhotos = parseHotelPhotos(html);
  if (richPhotos && richPhotos.length > 0) {
    result.photos = richPhotos;
  } else {
    // Fallback: regex-based photo extraction (no room associations)
    const photoUrls = new Set<string>();
    const photoPattern = /https:\/\/cf\.bstatic\.com\/xdata\/images\/hotel\/[^"'\s]+/g;
    const allPhotoMatches = html.match(photoPattern) || [];
    for (const photoUrl of allPhotoMatches) {
      const idMatch = photoUrl.match(/hotel\/[^/]+\/(\d+)\./);
      if (idMatch) {
        const photoId = idMatch[1];
        const cleanUrl = `https://cf.bstatic.com/xdata/images/hotel/max1024x768/${photoId}.jpg`;
        photoUrls.add(cleanUrl);
      }
    }
    result.photos = [...photoUrls].map(url => ({
      url,
      caption: null,
      id: null,
      highresUrl: null,
      associatedRooms: [],
      orientation: null,
      created: null,
    }));
  }

  // --- Rooms ---
  result.rooms = parseRooms($, result.photos);

  // --- Pricing ---
  result.pricing = parsePricing($);

  // --- Amenities (merge from all sources) ---
  const amenities: string[] = [];
  // Most popular facilities
  $('[data-testid="property-most-popular-facilities-wrapper"] span').each((_, el) => {
    const text = cleanText($(el).text());
    if (text && !amenities.includes(text)) {
      amenities.push(text);
    }
  });
  // Facility checklist items
  $('.facilitiesChecklist li, [data-testid="facility-list-item"]').each((_, el) => {
    const text = cleanText($(el).text());
    if (text && !amenities.includes(text)) {
      amenities.push(text);
    }
  });
  // Full facility groups (expandable sections)
  $('.hp-facility-group li, [data-testid="property-section--content"] .facility-list__content li').each((_, el) => {
    const text = cleanText($(el).text());
    if (text && !amenities.includes(text)) {
      amenities.push(text);
    }
  });
  // Apollo cache (most complete source — has all facilities including JS-rendered ones)
  const apolloFacilities = parseApolloFacilities(html);
  for (const name of apolloFacilities) {
    if (name && !amenities.includes(name)) {
      amenities.push(name);
    }
  }
  result.amenities = amenities;

  // --- Sub-ratings ---
  const subRatings: Record<string, number> = {};
  $('[data-testid="review-subscore"]').each((_, el) => {
    const text = cleanText($(el).text());
    // Text format: "Staff 8.8" or "Free WiFi 8.2"
    const match = text.match(/^(.+?)\s+([\d.]+)$/);
    if (match) {
      subRatings[match[1]] = parseFloat(match[2]);
    }
  });
  if (Object.keys(subRatings).length > 0) {
    result.subRatings = subRatings;
  }

  // --- Rating text (e.g. "Good", "Exceptional") ---
  const scoreComponent = $('[data-testid="review-score-component"]');
  if (scoreComponent.length) {
    const scoreText = cleanText(scoreComponent.text());
    // Format: "Scored 7.1 7.1Rated good Good · 737 reviews"
    const ratingTextMatch = scoreText.match(/Rated\s+\w+\s+(\w[\w\s]*?)(?:\s+·|\s+\d)/);
    if (ratingTextMatch) {
      result.ratingText = ratingTextMatch[1].trim();
    }
  }

  // --- Check-in / Check-out ---
  $('[data-testid="HouseRules-wrapper"]').find('div').each((_, el) => {
    const text = cleanText($(el).text());
    // Look for patterns like "Check-inFrom 14:00" or "Check-outUntil 11:00"
    const checkinMatch = text.match(/Check-in\s*(?:From\s*)?([\d:]+(?:\s*(?:to|–|-)\s*[\d:]+)?)/i);
    const checkoutMatch = text.match(/Check-out\s*(?:Until\s*)?([\d:]+)/i);
    if (checkinMatch && !result.checkIn) {
      result.checkIn = checkinMatch[1];
    }
    if (checkoutMatch && !result.checkOut) {
      result.checkOut = checkoutMatch[1];
    }
  });

  // --- Hotel ID from hidden inputs (if present) ---
  const hotelIdInput = $('input[name="hotel_id"]').first();
  if (hotelIdInput.length) {
    result.hotelId = parseInt(hotelIdInput.attr('value') || '', 10) || null;
  }
  // Fallback: search for hotel_id in script tags
  if (!result.hotelId) {
    const hotelIdMatch = html.match(/"hotel_id"\s*:\s*(\d+)/);
    if (hotelIdMatch) {
      result.hotelId = parseInt(hotelIdMatch[1], 10);
    }
  }

  return result;
}

// --- Main API functions ---

export async function scrapeListingDetails(
  url: string,
  options?: { checkIn?: string; checkOut?: string; adults?: number }
): Promise<BookingListingDetails> {
  // Extract linked room ID from original URL before normalization strips params
  const linkedRoomId = extractLinkedRoomId(url);

  const hotelInfo = extractHotelInfo(url);
  if (!hotelInfo) {
    throw new Error(`Could not extract hotel info from URL: ${url}`);
  }

  // Auto-extract dates from URL params if not provided via options
  let checkIn = options?.checkIn;
  let checkOut = options?.checkOut;
  let adults = options?.adults;
  try {
    const parsed = new URL(url);
    if (!checkIn) checkIn = parsed.searchParams.get('checkin') || undefined;
    if (!checkOut) checkOut = parsed.searchParams.get('checkout') || undefined;
    if (!adults) {
      const urlAdults = parsed.searchParams.get('group_adults');
      if (urlAdults) adults = parseInt(urlAdults);
    }
  } catch {
    // URL parsing failed
  }

  // Normalize URL to en-gb locale, preserving date/adults params
  const baseUrl = `https://www.booking.com/hotel/${hotelInfo.country_code}/${hotelInfo.hotel_name}.en-gb.html`;
  const normalizedParams = new URLSearchParams();
  if (checkIn) normalizedParams.set('checkin', checkIn);
  if (checkOut) normalizedParams.set('checkout', checkOut);
  if (adults) normalizedParams.set('group_adults', String(adults));
  const qs = normalizedParams.toString();
  const normalizedUrl = qs ? `${baseUrl}?${qs}` : baseUrl;

  const hasDates = !!(checkIn && checkOut);

  console.log(`Scraping Booking.com listing: ${hotelInfo.hotel_name}`);
  if (hasDates) {
    console.log(`  Dates: ${checkIn} to ${checkOut}${adults ? `, ${adults} adults` : ''}`);
  }
  if (linkedRoomId) {
    console.log(`  Linked room ID: ${linkedRoomId}`);
  }

  const html = await fetchHotelPageHtml(normalizedUrl, { hasDates });
  const parsed = parseHotelPage(html);

  return {
    id: hotelInfo.hotel_name,
    hotelId: parsed.hotelId ?? null,
    url: normalizedUrl,
    title: parsed.title || hotelInfo.hotel_name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description: parsed.description || '',
    propertyType: parsed.propertyType || null,
    stars: parsed.stars ?? null,
    address: parsed.address || null,
    coordinates: parsed.coordinates || null,
    photos: parsed.photos || [],
    amenities: parsed.amenities || [],
    rating: parsed.rating ?? null,
    ratingText: parsed.ratingText || null,
    reviewCount: parsed.reviewCount ?? null,
    subRatings: parsed.subRatings || null,
    checkIn: parsed.checkIn || null,
    checkOut: parsed.checkOut || null,
    linkedRoomId,
    rooms: parsed.rooms || [],
    pricing: hasDates ? (parsed.pricing || null) : null,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Download photos from a listing.
 *
 * Smart download logic:
 * - downloadAll=true → all photos
 * - downloadAll=false + linkedRoomId → only that room's photos + common photos (empty associatedRooms)
 * - downloadAll=false + no linkedRoomId → all photos
 * Falls back to all photos if room filtering yields zero results.
 */
export async function downloadPhotos(
  details: BookingListingDetails,
  outputDir?: string,
  options?: { downloadAll?: boolean }
): Promise<string> {
  const photosDir = path.join(outputDir || OUTPUT_DIR, `photos_${details.id}`);
  if (!fs.existsSync(photosDir)) {
    fs.mkdirSync(photosDir, { recursive: true });
  }

  let photos = details.photos;
  if (photos.length === 0) {
    console.log('No photos to download.');
    return photosDir;
  }

  // Smart filtering: only linked room's photos when not downloading all
  const downloadAll = options?.downloadAll ?? false;
  if (!downloadAll && details.linkedRoomId) {
    const roomPhotos = photos.filter(
      p => p.associatedRooms.includes(details.linkedRoomId!) || p.associatedRooms.length === 0
    );
    if (roomPhotos.length > 0) {
      console.log(`Filtering to room ${details.linkedRoomId}: ${roomPhotos.length} of ${photos.length} photos`);
      photos = roomPhotos;
    } else {
      console.log(`No photos matched room ${details.linkedRoomId}, downloading all ${photos.length} photos`);
    }
  }

  console.log(`Downloading ${photos.length} photos to ${photosDir}...`);

  // Photo CDN doesn't need proxy — these are public bstatic.com URLs
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    // Prefer highres URL when available
    const downloadUrl = photo.highresUrl || photo.url;
    const idMatch = downloadUrl.match(/(\d+)\.jpg/);
    const photoId = idMatch ? idMatch[1] : String(i + 1);
    const filename = `${String(i + 1).padStart(2, '0')}_${photoId}.jpg`;
    const filePath = path.join(photosDir, filename);

    try {
      const response = await fetch(downloadUrl, { redirect: 'follow' });
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(filePath, Buffer.from(buffer));
      process.stdout.write(`  [${i + 1}/${photos.length}] ${filename}\n`);
    } catch (error: any) {
      console.error(`  Failed to download photo ${i + 1}: ${error.message}`);
    }
  }

  console.log(`Downloaded ${photos.length} photos to ${photosDir}`);
  return photosDir;
}

/**
 * Save listing details to JSON
 */
export function saveListingDetails(
  details: BookingListingDetails | BookingListingDetails[],
  filename: string,
  outputDir: string = OUTPUT_DIR
): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, filename);
  const jsonString = JSON.stringify(details, null, 2);
  fs.writeFileSync(outputPath, jsonString);
  console.log(`Saved listing details to ${outputPath}`);
}

// --- Direct execution ---
const isDirectRun = process.argv[1]?.includes('booking/listing') || process.argv[1]?.includes('booking\\listing');
if (isDirectRun) {
  const url = process.argv[2] || 'https://www.booking.com/hotel/fr/azurene-royal.html';
  console.log(`Fetching listing details for: ${url}`);
  scrapeListingDetails(url)
    .then(details => {
      console.log(JSON.stringify(details, null, 2));
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
