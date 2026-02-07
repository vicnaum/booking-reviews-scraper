// scraper.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as cheerio from 'cheerio';
import Papa from 'papaparse';

// Define the structure for our extracted data
interface ApartmentData {
  id: string | null;
  url: string | null;
  roomType: string | null;
  title: string | null;
  ratingScore: number | null;
  reviewCount: number;
  status: 'New' | 'Rated' | 'Unknown';
}

// Define paths to input and output directories
const inputDir = path.join(__dirname, '../../data/airbnb/input-host');
const outputDir = path.join(__dirname, '../../data/airbnb/output-host');

/**
 * Parses the HTML content to extract apartment data.
 * @param htmlContent The HTML content as a string.
 * @returns An array of apartment data objects.
 */
function parseHtmlForApartments(htmlContent: string): ApartmentData[] {
  const $ = cheerio.load(htmlContent);
  const apartments: ApartmentData[] = [];

  // Find each apartment card using the data-testid attribute
  $('div[data-testid="card-container"]').each((index, element) => {
    const card = $(element);

    // --- Extract URL and ID ---
    const rawUrl = card.find('a[href*="/rooms/"]').attr('href');
    const cleanUrl = rawUrl ? `https://www.airbnb.com${rawUrl.split('?')[0]}` : null;
    const id = cleanUrl ? cleanUrl.split('/').pop() || null : null;

    // --- Extract Room Type and Title ---
    const roomType = card.find('div[data-testid="listing-card-title"]').text().trim() || null;
    const title = card.find('div[data-testid="listing-card-subtitle"] span > span').first().text().trim() || null;

    // --- Extract Rating, Review Count, and Status ---
    let ratingScore: number | null = null;
    let reviewCount = 0;
    let status: ApartmentData['status'] = 'Unknown';

    const ratingLine = card.find('span.t1phmnpa'); // This span contains the rating info
    const ratingText = ratingLine.find('span.a8jt5op').text().trim();

    if (ratingText.includes('New place to stay')) {
      status = 'New';
    } else if (ratingText.includes('review')) {
      status = 'Rated';
      
      // Extract numeric rating score
      const scoreText = ratingLine.find('span[aria-hidden="true"]').last().text().trim();
      const score = parseFloat(scoreText);
      if (!isNaN(score)) {
        ratingScore = score;
      }

      // Extract review count using regex
      const reviewMatch = ratingText.match(/(\d+(,\d+)*)\s+review/);
      if (reviewMatch && reviewMatch[1]) {
        reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''), 10);
      }
    }

    apartments.push({
      id,
      url: cleanUrl,
      roomType,
      title,
      ratingScore,
      reviewCount,
      status,
    });
  });

  return apartments;
}

/**
 * Main function to run the scraper.
 */
async function main() {
  try {
    // Ensure the output directory exists, creating it if necessary
    await fs.mkdir(outputDir, { recursive: true });

    // Read all files from the input directory
    const files = await fs.readdir(inputDir);

    for (const file of files) {
      // Process only .html files
      if (path.extname(file) === '.html') {
        console.log(`Processing file: ${file}...`);

        const inputPath = path.join(inputDir, file);
        const htmlContent = await fs.readFile(inputPath, 'utf-8');

        // Parse the data from the HTML
        const apartmentData = parseHtmlForApartments(htmlContent);

        if (apartmentData.length > 0) {
          // Convert the JSON data to a CSV string
          const csvString = Papa.unparse(apartmentData, {
            header: true,
            columns: ['id', 'url', 'roomType', 'title', 'ratingScore', 'reviewCount', 'status']
          });

          // Define the output file path
          const outputFilename = file.replace(/\.html$/, '.csv');
          const outputPath = path.join(outputDir, outputFilename);

          // Write the CSV data to the output file
          await fs.writeFile(outputPath, csvString);
          console.log(`✅ Successfully created ${outputPath}`);
        } else {
          console.log(`⚠️ No apartment data found in ${file}.`);
        }
      }
    }
    console.log('\nAll files processed.');
  } catch (error) {
    console.error('An error occurred during scraping:', error);
  }
}

// Run the main function
main();