// src/airbnb/listing.ts
//
// Airbnb listing details scraper using StaysPdpSections GraphQL API
//
// Usage:
//   reviewr details <url>                          # Fetch listing details
//   reviewr details <url> --checkin 2026-03-29 --checkout 2026-04-04  # With pricing
//   npx tsx src/airbnb/listing.ts <url>            # Direct execution

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { getApiKey, makeRequest } from './scraper.js';

const SECTIONS_API_URL = 'https://www.airbnb.com/api/v3/StaysPdpSections/80c7889b4b0027d99ffea830f6c0d4911a6e863a957cbe1044823f0fc746bf1f';
const OUTPUT_DIR = 'data/airbnb/output';

const API_HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// --- Interfaces ---

export interface AirbnbListingDetails {
  id: string;
  url: string;
  title: string;
  description: string;
  propertyType: string | null;
  coordinates: { lat: number; lng: number } | null;
  capacity: number | null;
  bedrooms: number | null;
  beds: number | null;
  bathrooms: number | null;
  photos: AirbnbPhoto[];
  amenities: AirbnbAmenity[];
  host: AirbnbHostInfo | null;
  houseRules: string[];
  highlights: string[];
  rating: number | null;
  reviewCount: number | null;
  subRatings: Record<string, number> | null;
  pricing: AirbnbPricing | null;
  checkIn: string | null;
  checkOut: string | null;
  cancellationPolicy: string | null;
  sleepingArrangements: SleepingArrangement[] | null;
  scrapedAt: string;
}

export interface AirbnbPhoto {
  url: string;
  caption: string | null;
}

export interface AirbnbAmenity {
  name: string;
  available: boolean;
  category: string | null;
}

export interface AirbnbHostInfo {
  name: string;
  id: string | null;
  isSuperhost: boolean;
  profilePicUrl: string | null;
  highlights: string[];
}

export interface AirbnbPricing {
  nightlyPrice: string | null;
  totalPrice: string | null;
  priceBreakdown: Record<string, string> | null;
}

export interface SleepingArrangement {
  room: string;
  beds: string[];
}

// --- Helpers ---

function getNestedValue(obj: any, keyPath: string, defaultValue: any = null): any {
  const keys = keyPath.split('.');
  let current = obj;
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return defaultValue;
    }
  }
  return current;
}

function findSection(sections: any[], sectionId: string): any | null {
  for (const s of sections) {
    if (s.sectionId === sectionId) {
      return s.section || null;
    }
  }
  return null;
}

function findSectionByType(sections: any[], typeName: string): any | null {
  for (const s of sections) {
    if (s.section?.__typename === typeName) {
      return s.section;
    }
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- Parsing ---

function parseSections(sections: any[], metadata: any): Partial<AirbnbListingDetails> {
  const result: Partial<AirbnbListingDetails> = {};

  // Title
  const titleSection = findSection(sections, 'TITLE_DEFAULT');
  if (titleSection) {
    result.title = titleSection.title || '';
    // overviewItems sometimes has property type
    const items = titleSection.overviewItems || [];
    for (const item of items) {
      if (item?.title) {
        result.propertyType = item.title;
        break;
      }
    }
  }

  // Description
  const descSection = findSection(sections, 'DESCRIPTION_DEFAULT');
  if (descSection) {
    const html = descSection.htmlDescription?.htmlText || descSection.htmlDescription || '';
    result.description = typeof html === 'string' ? stripHtml(html) : '';
  }

  // Photos from PHOTO_TOUR_SCROLLABLE_MODAL (has all photos)
  const photoSection = findSection(sections, 'PHOTO_TOUR_SCROLLABLE_MODAL');
  if (photoSection) {
    const mediaItems = photoSection.mediaItems || [];
    result.photos = mediaItems
      .filter((item: any) => item.baseUrl)
      .map((item: any) => ({
        url: item.baseUrl,
        caption: item.accessibilityLabel || null,
      }));
  } else {
    // Fallback to hero section preview images
    const heroSection = findSection(sections, 'HERO_DEFAULT');
    if (heroSection) {
      result.photos = (heroSection.previewImages || [])
        .filter((img: any) => img.baseUrl)
        .map((img: any) => ({
          url: img.baseUrl,
          caption: img.accessibilityLabel || null,
        }));
    }
  }

  // Location
  const locationSection = findSection(sections, 'LOCATION_DEFAULT');
  if (locationSection) {
    const lat = locationSection.lat;
    const lng = locationSection.lng;
    if (lat != null && lng != null) {
      result.coordinates = { lat, lng };
    }
  }

  // Amenities (full list from seeAllAmenitiesGroups)
  const amenitiesSection = findSection(sections, 'AMENITIES_DEFAULT');
  if (amenitiesSection) {
    const groups = amenitiesSection.seeAllAmenitiesGroups || amenitiesSection.previewAmenitiesGroups || [];
    const amenities: AirbnbAmenity[] = [];
    for (const group of groups) {
      const category = group.title || null;
      for (const a of (group.amenities || [])) {
        amenities.push({
          name: a.title || '',
          available: a.available ?? true,
          category,
        });
      }
    }
    result.amenities = amenities;
  }

  // Host
  const hostSection = findSection(sections, 'MEET_YOUR_HOST');
  if (hostSection) {
    const card = hostSection.cardData || {};
    // Decode user ID from base64
    let userId: string | null = null;
    if (card.userId) {
      try {
        const decoded = Buffer.from(card.userId, 'base64').toString('utf-8');
        const match = decoded.match(/(\d+)$/);
        userId = match ? match[1] : card.userId;
      } catch {
        userId = card.userId;
      }
    }
    result.host = {
      name: card.name || '',
      id: userId,
      isSuperhost: card.isSuperhost || false,
      profilePicUrl: card.profilePictureUrl || null,
      highlights: (hostSection.hostHighlights || []).map((h: any) => h.title || '').filter(Boolean),
    };
  }

  // House rules
  const policiesSection = findSection(sections, 'POLICIES_DEFAULT');
  if (policiesSection) {
    result.houseRules = (policiesSection.houseRules || [])
      .map((r: any) => r.title || '')
      .filter(Boolean);

    // Check-in/out times from houseRulesSections (use CLOCK icon to distinguish from "Self check-in")
    const ruleSections = policiesSection.houseRulesSections || [];
    for (const rs of ruleSections) {
      for (const item of (rs.items || [])) {
        const title = item.title || '';
        const icon = item.icon || '';
        if (title.toLowerCase().startsWith('check-in') && icon.includes('CLOCK')) {
          result.checkIn = title;
        } else if (title.toLowerCase().startsWith('checkout') && icon.includes('CLOCK')) {
          result.checkOut = title;
        }
      }
    }

    // Cancellation policy
    const cancellation = policiesSection.cancellationPolicyForDisplay;
    if (cancellation) {
      result.cancellationPolicy = cancellation.title || JSON.stringify(cancellation);
    }
  }

  // Highlights
  const highlightsSection = findSection(sections, 'HIGHLIGHTS_DEFAULT');
  if (highlightsSection) {
    result.highlights = (highlightsSection.highlights || [])
      .map((h: any) => {
        const title = h.title || '';
        const subtitle = h.subtitle || '';
        return subtitle ? `${title}: ${subtitle}` : title;
      })
      .filter(Boolean);
  }

  // Reviews
  const reviewsSection = findSection(sections, 'REVIEWS_DEFAULT');
  if (reviewsSection) {
    result.rating = reviewsSection.overallRating ?? null;
    result.reviewCount = reviewsSection.overallCount ?? null;
    const ratings = reviewsSection.ratings || [];
    if (ratings.length > 0) {
      const subRatings: Record<string, number> = {};
      for (const r of ratings) {
        const cat = r.label || r.categoryType || 'unknown';
        const val = parseFloat(r.localizedRating);
        if (!isNaN(val)) {
          subRatings[cat] = val;
        }
      }
      result.subRatings = subRatings;
    }
  }

  // Pricing (from BOOK_IT_SIDEBAR)
  const bookItSection = findSection(sections, 'BOOK_IT_SIDEBAR');
  if (bookItSection) {
    result.capacity = bookItSection.maxGuestCapacity ?? null;

    const displayPrice = bookItSection.structuredDisplayPrice;
    if (displayPrice) {
      const primaryLine = displayPrice.primaryLine;
      const secondaryLine = displayPrice.secondaryLine;
      const breakdown = displayPrice.explanationData?.priceDetails || [];

      const priceBreakdown: Record<string, string> = {};
      for (const detail of breakdown) {
        for (const item of (detail.items || [])) {
          if (item.description && item.priceString) {
            priceBreakdown[item.description] = item.priceString;
          }
        }
      }

      result.pricing = {
        nightlyPrice: primaryLine?.accessibilityLabel || primaryLine?.price || null,
        totalPrice: secondaryLine?.accessibilityLabel || secondaryLine?.price || null,
        priceBreakdown: Object.keys(priceBreakdown).length > 0 ? priceBreakdown : null,
      };
    }
  }

  // Sleeping arrangements
  const sleepingSection = findSection(sections, 'SLEEPING_ARRANGEMENT_DEFAULT');
  if (sleepingSection) {
    const details = sleepingSection.arrangementDetails || [];
    result.sleepingArrangements = details.map((d: any) => ({
      room: d.title || '',
      beds: d.subtitle ? [d.subtitle] : [],
    }));

    // Count beds/bedrooms from arrangements
    if (details.length > 0) {
      result.bedrooms = details.length;
      let totalBeds = 0;
      for (const d of details) {
        // Count icons as bed indicators
        totalBeds += (d.icons || []).length;
      }
      if (totalBeds > 0) result.beds = totalBeds;
    }
  }

  // Extract listing ID from metadata
  const loggingContext = metadata?.loggingContext?.eventDataLogging;
  if (loggingContext) {
    if (!result.propertyType && loggingContext.listingType) {
      result.propertyType = loggingContext.listingType;
    }
  }

  return result;
}

// --- Main API functions ---

export async function fetchListingDetails(
  apiKey: string,
  roomId: string,
  options?: { checkIn?: string; checkOut?: string; adults?: number }
): Promise<AirbnbListingDetails> {
  const globalId = Buffer.from(`StayListing:${roomId}`).toString('base64');

  const pdpSectionsRequest: any = {
    adults: String(options?.adults || 1),
    children: null,
    infants: null,
    pets: 0,
    layouts: ['SIDEBAR', 'SINGLE_COLUMN'],
  };

  if (options?.checkIn) pdpSectionsRequest.checkIn = options.checkIn;
  if (options?.checkOut) pdpSectionsRequest.checkOut = options.checkOut;

  const variables = { id: globalId, pdpSectionsRequest };

  const extensions = {
    persistedQuery: {
      version: 1,
      sha256Hash: '80c7889b4b0027d99ffea830f6c0d4911a6e863a957cbe1044823f0fc746bf1f',
    },
  };

  const queryParams = new URLSearchParams({
    operationName: 'StaysPdpSections',
    locale: 'en',
    currency: 'USD',
    variables: JSON.stringify(variables),
    extensions: JSON.stringify(extensions),
  });

  const url = `${SECTIONS_API_URL}?${queryParams.toString()}`;

  const response = await makeRequest(url, {
    headers: { ...API_HEADERS, 'X-Airbnb-Api-Key': apiKey },
  });

  const json = JSON.parse(response.data);

  if (json.errors) {
    throw new Error(`API error: ${json.errors[0]?.message || JSON.stringify(json.errors)}`);
  }

  const page = json?.data?.presentation?.stayProductDetailPage;
  if (!page) {
    throw new Error('No listing data in API response');
  }

  const sections = page.sections?.sections || [];
  const metadata = page.sections?.metadata || {};

  if (sections.length === 0) {
    throw new Error('No sections returned from API');
  }

  const parsed = parseSections(sections, metadata);

  return {
    id: roomId,
    url: `https://www.airbnb.com/rooms/${roomId}`,
    title: parsed.title || '',
    description: parsed.description || '',
    propertyType: parsed.propertyType || null,
    coordinates: parsed.coordinates || null,
    capacity: parsed.capacity || null,
    bedrooms: parsed.bedrooms || null,
    beds: parsed.beds || null,
    bathrooms: parsed.bathrooms || null,
    photos: parsed.photos || [],
    amenities: parsed.amenities || [],
    host: parsed.host || null,
    houseRules: parsed.houseRules || [],
    highlights: parsed.highlights || [],
    rating: parsed.rating ?? null,
    reviewCount: parsed.reviewCount ?? null,
    subRatings: parsed.subRatings || null,
    pricing: parsed.pricing || null,
    checkIn: parsed.checkIn || null,
    checkOut: parsed.checkOut || null,
    cancellationPolicy: parsed.cancellationPolicy || null,
    sleepingArrangements: parsed.sleepingArrangements || null,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Extract room ID and optional dates from an Airbnb URL
 */
export function parseAirbnbUrl(url: string): { roomId: string; checkIn?: string; checkOut?: string; adults?: number } {
  const roomMatch = url.match(/airbnb\.com\/rooms\/(\d+)/);
  if (!roomMatch) {
    throw new Error(`Could not extract room ID from URL: ${url}`);
  }

  const result: { roomId: string; checkIn?: string; checkOut?: string; adults?: number } = {
    roomId: roomMatch[1],
  };

  try {
    const parsed = new URL(url);
    const checkIn = parsed.searchParams.get('check_in');
    const checkOut = parsed.searchParams.get('check_out');
    const adults = parsed.searchParams.get('adults');
    if (checkIn) result.checkIn = checkIn;
    if (checkOut) result.checkOut = checkOut;
    if (adults) result.adults = parseInt(adults);
  } catch {
    // URL parsing failed, just use the room ID
  }

  return result;
}

/**
 * Scrape listing details from a URL (convenience wrapper)
 */
export async function scrapeListingDetails(
  url: string,
  options?: { checkIn?: string; checkOut?: string; adults?: number }
): Promise<AirbnbListingDetails> {
  const urlInfo = parseAirbnbUrl(url);

  // CLI options override URL params
  const finalOptions = {
    checkIn: options?.checkIn || urlInfo.checkIn,
    checkOut: options?.checkOut || urlInfo.checkOut,
    adults: options?.adults || urlInfo.adults,
  };

  const apiKey = await getApiKey();
  return fetchListingDetails(apiKey, urlInfo.roomId, finalOptions);
}

/**
 * Download all photos for a listing to a local directory
 */
export async function downloadPhotos(
  details: AirbnbListingDetails,
  outputDir?: string
): Promise<string> {
  const photosDir = path.join(outputDir || OUTPUT_DIR, `photos_${details.id}`);
  if (!fs.existsSync(photosDir)) {
    fs.mkdirSync(photosDir, { recursive: true });
  }

  const photos = details.photos;
  if (photos.length === 0) {
    console.log('No photos to download.');
    return photosDir;
  }

  console.log(`Downloading ${photos.length} photos to ${photosDir}...`);

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const ext = photo.url.match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpeg';
    const filename = `${String(i + 1).padStart(2, '0')}_${sanitizeFilename(photo.caption || 'photo')}.${ext}`;
    const filePath = path.join(photosDir, filename);

    try {
      const response = await makeRequest(photo.url, {});
      fs.writeFileSync(filePath, Buffer.from(response.data, 'binary'));
      process.stdout.write(`  [${i + 1}/${photos.length}] ${filename}\n`);
    } catch (error: any) {
      console.error(`  Failed to download photo ${i + 1}: ${error.message}`);
    }
  }

  console.log(`Downloaded ${photos.length} photos to ${photosDir}`);
  return photosDir;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50)
    .replace(/_+$/, '');
}

/**
 * Save listing details to JSON file
 */
export function saveListingDetails(
  details: AirbnbListingDetails | AirbnbListingDetails[],
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
const isDirectRun = process.argv[1]?.includes('airbnb/listing') || process.argv[1]?.includes('airbnb\\listing');
if (isDirectRun) {
  const url = process.argv[2] || 'https://www.airbnb.com/rooms/44129719';
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
