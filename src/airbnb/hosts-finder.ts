// src/find-hosts.ts
// 
// Airbnb Host Finder Scraper
//
// This script takes a location query (e.g., "Gdansk, Poland") and performs an exhaustive
// search to find all hosts in that area. It identifies potential rental agencies
// based on the number of listings they manage.
//
// Architecture:
// 1. Fetches a dynamic API key from Airbnb's homepage.
// 2. Uses the OpenStreetMap Nominatim API to get the geographic boundaries of the target location.
// 3. Splits the location into a grid of smaller search areas using Turf.js.
// 4. For each area, it uses price pivoting to uncover the maximum number of listings.
// 5. Fetches details for each unique listing to get the host's ID.
// 6. Fetches the profile for each unique host to get their listing count and other details.
// 7. Saves the final list of hosts to a CSV file.
//
// All requests are routed through a proxy configured in the .env file.
//
// Usage:
//   npx tsx src/find-hosts.ts "Your City, Your Country"

import 'dotenv/config';
import fetch, { HeadersInit, RequestInit } from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as fs from 'fs';
import * as path from 'path';
import * as turf from '@turf/turf';

// --- Configuration ---
const AIRBNB_BASE_URL = 'https://www.airbnb.com';
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const OUTPUT_DIR = 'data/airbnb/output-hosts';
const AGENCY_THRESHOLD = 5; // Min listings to be considered an agency

// Debug mode - set to true to stop after finding a few listings for testing
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
const DEBUG_MAX_LISTINGS = 10; // Stop after finding this many listings in debug mode
const DEBUG_MAX_AGENCIES = 3; // Stop after finding this many agencies in debug mode
const DEBUG_LISTINGS_ONLY = process.env.DEBUG_LISTINGS_ONLY === 'true'; // Only fetch listings, skip host profiles

// --- Proxy Configuration from .env ---
const USE_PROXY = process.env.USE_PROXY !== 'false';
const PROXY_CONFIG = {
  host: process.env.PROXY_HOST || '',
  port: parseInt(process.env.PROXY_PORT || '0'),
  username: process.env.PROXY_USERNAME || '',
  password: process.env.PROXY_PASSWORD || ''
};
const proxyUrl = `http://${PROXY_CONFIG.username}:${PROXY_CONFIG.password}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`;

// --- Headers for Emulating a Browser ---
const BROWSER_HEADERS: HeadersInit = {
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

// --- Type Definitions ---
interface GeoPolygon {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

interface Host {
  id: string;
  name: string;
  listingCount: number;
  isAgency: boolean;
  rating: number | null;
  pictureUrl: string | null;
  profileUrl: string;
}

/**
 * A simple utility to sleep for a given duration.
 * @param ms - Milliseconds to sleep.
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Makes an HTTP request with retry logic, proxy support, and timeout.
 */
async function makeRequest(url: string, options: RequestInit = {}, maxRetries: number = 5): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30-second timeout

      const fetchOptions: RequestInit = {
        ...options,
        headers: { ...BROWSER_HEADERS, ...options.headers },
        signal: controller.signal,
      };

      if (USE_PROXY) {
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;
      if (error.name === 'AbortError') {
        console.log(`  ❌ Request timeout (attempt ${attempt}/${maxRetries})`);
      } else {
        console.log(`  ❌ Request failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
      }
      if (isLastAttempt) throw error;
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      console.log(`  ⏳ Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw new Error('This should never be reached');
}

/**
 * Fetches the dynamic API key from the Airbnb homepage.
 */
async function getApiKey(): Promise<string> {
  console.log('🔑 Fetching new AirBnB API key...');
  const response = await makeRequest(AIRBNB_BASE_URL, {
    headers: BROWSER_HEADERS
  });
  
  const regexApiKey = /"api_config":\{"key":"(.+?)"/;
  const match = regexApiKey.exec(response);
  
  if (!match) {
    throw new Error('API key not found in AirBnB homepage');
  }
  
  const apiKey = match[1];
  console.log(`✅ API key obtained: ${apiKey.substring(0, 10)}...`);
  return apiKey;
}

/**
 * Fetches the geographic polygon for a given location query.
 */
async function getGeoPolygon(locationQuery: string): Promise<GeoPolygon> {
    console.log(`🌍 Geocoding "${locationQuery}" using OpenStreetMap...`);
    const url = new URL(`${NOMINATIM_BASE_URL}/search`);
    url.searchParams.set('q', locationQuery);
    url.searchParams.set('polygon_geojson', '1');
    url.searchParams.set('format', 'json');

    const responseText = await makeRequest(url.toString(), {
        headers: { 'User-Agent': 'AirbnbHostScraper/1.0' } // OSM requires a specific user agent
    });

    const results = JSON.parse(responseText);
    const validPolygon = results.find((r: any) => r.geojson && (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon'));

    if (!validPolygon) {
        throw new Error(`Could not find a valid geographic polygon for "${locationQuery}".`);
    }
    console.log(`✅ Geocoding successful. Found polygon for: ${validPolygon.display_name}`);
    return validPolygon.geojson;
}

/**
 * Creates a smart search strategy with binary division.
 * Starts with larger areas and divides them if too many listings are found.
 */
function createSmartSearchStrategy(polygon: GeoPolygon): Array<{center: number[], radius: number, priceRanges: Array<{min: number, max: number}>}> {
    
    /**
     * Price pivoting algorithm from actor-airbnb-scraper
     * Creates optimal price ranges based on listing density
     */
    function createPricePivotingRanges(min: number, max: number): Array<{min: number, max: number}> {
        const HISTOGRAM_ITEMS_COUNT = 10; // Same as actor-airbnb-scraper
        const intervalSize = max / HISTOGRAM_ITEMS_COUNT;
        const ranges: Array<{min: number, max: number}> = [];
        
        let pivotStart = min;
        let pivotEnd = intervalSize + min;
        
        for (let i = 0; i < HISTOGRAM_ITEMS_COUNT; i++) {
            ranges.push({min: pivotStart, max: pivotEnd});
            pivotStart += intervalSize;
            pivotEnd += intervalSize;
            
            if (pivotEnd > max) {
                break;
            }
        }
        
        return ranges;
    }
    const searchArea = turf.polygon(polygon.type === 'Polygon' ? polygon.coordinates : polygon.coordinates[0]);
    const areaBbox = turf.bbox(searchArea);
    
    // Start with smaller areas (5km radius) for better coverage
    const initialRadius = 5; // km
    const grid = turf.pointGrid(areaBbox, initialRadius, { units: 'kilometers', mask: searchArea });
    
    const searchStrategy: Array<{center: number[], radius: number, priceRanges: Array<{min: number, max: number}>}> = [];
    
    // Price pivoting ranges - same as actor-airbnb-scraper
    const initialPriceRanges = createPricePivotingRanges(0, 1000000);
    
    for (const feature of grid.features) {
        const center = feature.geometry.coordinates;
        searchStrategy.push({
            center,
            radius: initialRadius,
            priceRanges: initialPriceRanges
        });
    }
    
    console.log(`🗺️  Created smart search strategy with ${searchStrategy.length} initial areas (${initialRadius}km radius each)`);
    return searchStrategy;
}

/**
 * The main scraping function that orchestrates the entire process.
 */
async function main() {
  console.log('🚀 Starting Airbnb Host Finder...');
  
  const locationQuery = process.argv[2];
  if (!locationQuery) {
    console.error('❌ Error: Please provide a location query as a command-line argument.');
    console.error('Usage: npx tsx src/find-hosts.ts "City, Country"');
    process.exit(1);
  }

  if (USE_PROXY) {
    console.log(`🔗 Proxy enabled: ${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`);
  } else {
    console.log('🚫 Proxy disabled.');
  }

  try {
    const apiKey = await getApiKey();
    const geoPolygon = await getGeoPolygon(locationQuery);
    const searchStrategy = createSmartSearchStrategy(geoPolygon);

    const discoveredListingIds = new Set<string>();
    const discoveredHostIds = new Set<string>();
    const finalHosts: Host[] = [];
    
    // Show debug mode status
    if (DEBUG_MODE) {
      console.log(`🐛 DEBUG MODE: Will stop after finding ${DEBUG_MAX_LISTINGS} listings`);
    }
    if (DEBUG_LISTINGS_ONLY) {
      console.log(`🔍 LISTINGS-ONLY MODE: Will only discover listings, skip host profiles`);
    }
    
    // --- Stage 1: Discover all Listing IDs with Smart Search ---
    console.log('\n--- Stage 1: Discovering Listings with Smart Search ---');
    
    let searchIndex = 0;
    let totalSearches = 0;
    
    // Function to search a specific area and price range
    async function searchArea(center: number[], radius: number, priceRanges: Array<{min: number, max: number}>, depth: number = 0): Promise<void> {
      const [lng, lat] = center;
      
      for (const range of priceRanges) {
        searchIndex++;
        totalSearches++;
        
        // Calculate bounding box based on radius (approximate)
        const latDelta = radius / 111; // 1 degree lat ≈ 111 km
        const lngDelta = radius / (111 * Math.cos(lat * Math.PI / 180)); // Adjust for longitude
        
        const ne_lat = lat + latDelta;
        const ne_lng = lng + lngDelta;
        const sw_lat = lat - latDelta;
        const sw_lng = lng - lngDelta;
        
        // No date filtering - search for ALL properties regardless of availability
        
        const searchUrl = new URL(`${AIRBNB_BASE_URL}/api/v2/explore_tabs`);
        searchUrl.searchParams.set('search_by_map', 'true');
        searchUrl.searchParams.set('ne_lat', String(ne_lat));
        searchUrl.searchParams.set('ne_lng', String(ne_lng));
        searchUrl.searchParams.set('sw_lat', String(sw_lat));
        searchUrl.searchParams.set('sw_lng', String(sw_lng));
        searchUrl.searchParams.set('items_per_grid', '50');
        searchUrl.searchParams.set('items_offset', '0');
        searchUrl.searchParams.set('refinement_paths[]', '/homes');
        searchUrl.searchParams.set('key', apiKey);
        searchUrl.searchParams.set('currency', 'USD');
        searchUrl.searchParams.set('price_min', String(range.min));
        if(range.max < 1000) searchUrl.searchParams.set('price_max', String(range.max));
        
        // No guest count filtering - let Airbnb use defaults

        try {
          const depthIndicator = depth > 0 ? ` (depth ${depth})` : '';
          console.log(`  [${searchIndex}] 🔍 Searching area [${lat.toFixed(3)}, ${lng.toFixed(3)}] radius:${radius}km${depthIndicator} | Price ${range.min}-${range.max}...`);
          
          // Get listings with pagination support
          let allListings: any[] = [];
          let offset = 0;
          const limit = 50;
          let hasNextPage = true;
          
          while (hasNextPage) {
            searchUrl.searchParams.set('items_offset', String(offset));
            const responseText = await makeRequest(searchUrl.toString(), { headers: { 'X-Airbnb-API-Key': apiKey }});
            const data = JSON.parse(responseText);
            
            // Debug: Check the structure of the response
            if (DEBUG_MODE && searchIndex <= 3 && offset === 0) {
              console.log(`    🔍 Debug: Response keys: ${Object.keys(data || {}).join(', ')}`);
              if (data?.explore_tabs) {
                console.log(`    🔍 Debug: explore_tabs length: ${data.explore_tabs.length}`);
                if (data.explore_tabs[0]?.sections) {
                  console.log(`    🔍 Debug: sections length: ${data.explore_tabs[0].sections.length}`);
                }
              }
            }
            
            const listings = data?.explore_tabs?.[0]?.sections?.find((s: any) => s.listings)?.listings || [];
            allListings.push(...listings);
            
            // Check if there are more pages
            const paginationMetadata = data?.explore_tabs?.[0]?.pagination_metadata;
            hasNextPage = paginationMetadata?.has_next_page && listings.length > 0;
            
            if (hasNextPage) {
              offset += limit;
              await sleep(250); // Be respectful between pagination requests
            }
          }
          
                      let foundCount = 0;
            for (const item of allListings) {
            const listingId = item?.listing?.id;
            if (listingId && !discoveredListingIds.has(listingId)) {
                discoveredListingIds.add(listingId);
                foundCount++;
                
                // Try to get host info directly from search results
                const hostId = item?.listing?.user?.id;
                if (hostId && !discoveredHostIds.has(hostId)) {
                    discoveredHostIds.add(hostId);
                    console.log(`    -> Found host directly from search: ${hostId}`);
                }
            }
          }
          
          if (foundCount > 0) {
            console.log(`    -> Found ${foundCount} new listings. Total unique: ${discoveredListingIds.size}`);
            
            // If we found many listings, this area might be dense - consider subdividing
            if (foundCount > 20 && depth < 2 && radius > 2) {
              console.log(`    📊 High density area detected (${foundCount} listings). Will subdivide in next iteration.`);
              
              // Create smaller search areas for high-density regions
              const subRadius = radius / 2;
              const subAreas = [
                { center: [lat + latDelta/2, lng + lngDelta/2], radius: subRadius },
                { center: [lat + latDelta/2, lng - lngDelta/2], radius: subRadius },
                { center: [lat - latDelta/2, lng + lngDelta/2], radius: subRadius },
                { center: [lat - latDelta/2, lng - lngDelta/2], radius: subRadius }
              ];
              
              // Add sub-areas to search queue (we'll implement this in the next iteration)
              console.log(`    🔄 Will subdivide into ${subAreas.length} smaller areas (${subRadius}km radius each)`);
            }
            
            // If we hit the limit (40 listings), this price range is too broad
            if (foundCount >= 40) {
              console.log(`    ⚠️  Hit listing limit (${foundCount}). This price range (${range.min}-${range.max}) is too broad.`);
              console.log(`    🔄 Will need to subdivide this price range in future iterations.`);
            }
            
            // Show optimization suggestions
            if (DEBUG_LISTINGS_ONLY) {
              console.log(`    💡 Optimization: Area [${lat.toFixed(3)}, ${lng.toFixed(3)}] radius:${radius}km | Price ${range.min}-${range.max} | Found: ${foundCount}`);
            }
          } else if (DEBUG_MODE && searchIndex <= 3) {
            console.log(`    🔍 Debug: No listings found in this area`);
          }
          
          // Check debug mode - stop if we have enough listings
          if (DEBUG_MODE && discoveredListingIds.size >= DEBUG_MAX_LISTINGS) {
            console.log(`🐛 DEBUG MODE: Reached ${discoveredListingIds.size} listings, stopping discovery phase`);
            return;
          }
        } catch (error) {
            console.log(`    -> Skipping area due to error.`);
        }
        await sleep(500); // Be respectful to the API
      }
    }
    
    // Process each search area
    for (const area of searchStrategy) {
      await searchArea(area.center, area.radius, area.priceRanges);
      
      // Check debug mode - break if we have enough listings
      if (DEBUG_MODE && discoveredListingIds.size >= DEBUG_MAX_LISTINGS) {
        break;
      }
    }
    
    // --- Stage 2: Skip listing details since we got host IDs from search ---
    console.log('\n--- Stage 2: Host IDs already found from search results ---');
    console.log(`✅ Discovered ${discoveredHostIds.size} unique hosts from search results.`);

    // --- Stage 3: Fetch Host Details ---
    if (DEBUG_LISTINGS_ONLY) {
      console.log('\n--- Stage 3: Skipped (DEBUG_LISTINGS_ONLY mode) ---');
      console.log(`📊 Summary: Found ${discoveredListingIds.size} unique listings and ${discoveredHostIds.size} unique hosts`);
      console.log(`🎉 Scraper finished!`);
      return;
    }
    console.log('\n--- Stage 3: Fetching Host Profiles ---');
    const hostIds = Array.from(discoveredHostIds);
    let hostIndex = 0;
    let agenciesFound = 0;
    let consecutiveHostErrors = 0;
    let currentHostApiKey = apiKey; // Start with original API key
    
    for (const hostId of hostIds) {
        hostIndex++;
        const hostUrl = `${AIRBNB_BASE_URL}/api/v2/users/${hostId}`;
        
        try {
            console.log(`  [${hostIndex}/${hostIds.length}] 👤 Fetching profile for host ${hostId}...`);
            const responseText = await makeRequest(hostUrl, { headers: { 'X-Airbnb-API-Key': currentHostApiKey }});
            const data = JSON.parse(responseText);
            
            // Debug: Check what we're getting from the API
            if (DEBUG_MODE && hostIndex <= 5) {
                console.log(`    🔍 Debug: Response keys: ${Object.keys(data || {}).join(', ')}`);
                if (data?.user) {
                    console.log(`    🔍 Debug: User keys: ${Object.keys(data.user).join(', ')}`);
                    console.log(`    🔍 Debug: User data:`, {
                        id: data.user.id,
                        host_name: data.user.host_name,
                        listings_count: data.user.listings_count,
                        first_name: data.user.first_name,
                        last_name: data.user.last_name,
                        full_name: data.user.full_name
                    });
                }
            }
            
            const user = data?.user;
            if (user) {
                const host: Host = {
                    id: user.id,
                    name: user.host_name || user.first_name || user.full_name || 'Unknown',
                    listingCount: user.listings_count,
                    isAgency: user.listings_count >= AGENCY_THRESHOLD,
                    rating: user.reviewee_rating || null,
                    pictureUrl: user.picture_url || null,
                    profileUrl: `${AIRBNB_BASE_URL}/users/show/${user.id}`
                };
                finalHosts.push(host);
                
                if (host.isAgency) {
                    agenciesFound++;
                    console.log(`    -> Found agency: ${host.name} (${host.listingCount} listings)`);
                    
                    // Stop after finding enough agencies in debug mode
                    if (DEBUG_MODE && agenciesFound >= DEBUG_MAX_AGENCIES) {
                        console.log(`🐛 DEBUG MODE: Reached ${agenciesFound} agencies, stopping host profile fetching`);
                        break;
                    }
                }
            }
            consecutiveHostErrors = 0; // Reset error counter on success
        } catch(error: any) {
            consecutiveHostErrors++;
            console.log(`    -> Error: ${error.message}`);
            
            // If we get multiple errors in a row, try refreshing the API key
            if (consecutiveHostErrors >= 3) {
                console.log(`    🔄 Refreshing API key after ${consecutiveHostErrors} consecutive errors...`);
                try {
                    console.log(`    🔑 Fetching new API key...`);
                    currentHostApiKey = await getApiKey();
                    consecutiveHostErrors = 0; // Reset after refreshing
                    console.log(`    ✅ API key refreshed: ${currentHostApiKey.substring(0, 10)}...`);
                } catch (refreshError) {
                    console.log(`    ❌ Failed to refresh API key: ${refreshError}`);
                }
            }
        }
        await sleep(250);
    }
    
    // --- Stage 4: Save to CSV ---
    console.log('\n--- Stage 4: Saving Results ---');
    if (finalHosts.length > 0) {
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }
        const safeLocationName = locationQuery.split(',')[0].replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const outputPath = path.join(OUTPUT_DIR, `${safeLocationName}_hosts.csv`);
        
        const headers = ['hostId', 'hostName', 'listingCount', 'isAgency', 'hostRating', 'hostPictureUrl', 'profileUrl'];
        const rows = finalHosts.map(h => [
            h.id,
            `"${h.name.replace(/"/g, '""')}"`,
            h.listingCount,
            h.isAgency,
            h.rating,
            h.pictureUrl,
            h.profileUrl
        ].join(','));

        const csvContent = [headers.join(','), ...rows].join('\n');
        fs.writeFileSync(outputPath, csvContent);

        const agencies = finalHosts.filter(h => h.isAgency);
        console.log(`✅ Success! Saved ${finalHosts.length} hosts to ${outputPath}`);
        console.log(`📈 Identified ${agencies.length} potential agencies (>= ${AGENCY_THRESHOLD} listings).`);
    } else {
        console.log('⚠️ No hosts were found.');
    }

  } catch (error) {
    console.error('\n❌ A fatal error occurred during the process:', error);
    process.exit(1);
  }

  console.log('\n🎉 Scraper finished!');
}

main();