#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';

interface Review {
  review_post_date: string;
  rating: number;
  full_review: string;
  owner_resp_text: string | null;
}

interface JsonData {
  reviews: Review[];
}

interface CsvRow {
  review_date: string;
  rating: number;
  title: string;
  liked: string;
  disliked: string;
  owner_response: string;
}

function parseFullReview(fullReview: string): { title: string; liked: string; disliked: string } {
  // Handle specific patterns we see in the data
  let title = '';
  let liked = '';
  let disliked = '';
  
  // Pattern 1: title + liked + disliked
  let match = fullReview.match(/^title: (.*?) liked: (.*?) disliked: (.*)$/);
  if (match) {
    return {
      title: match[1].replace(/[.!]$/, '').trim(),
      liked: match[2].replace(/[.]$/, '').trim(),
      disliked: match[3].replace(/[.]$/, '').trim()
    };
  }
  
  // Pattern 2: title + liked
  match = fullReview.match(/^title: (.*?) liked: (.*)$/);
  if (match) {
    return {
      title: match[1].replace(/[.!]$/, '').trim(),
      liked: match[2].replace(/[.]$/, '').trim(),
      disliked: ''
    };
  }
  
  // Pattern 3: liked + disliked
  match = fullReview.match(/^liked: (.*?) disliked: (.*)$/);
  if (match) {
    return {
      title: '',
      liked: match[1].replace(/[.]$/, '').trim(),
      disliked: match[2].replace(/[.]$/, '').trim()
    };
  }
  
  // Pattern 4: only liked
  match = fullReview.match(/^liked: (.*)$/);
  if (match) {
    return {
      title: '',
      liked: match[1].replace(/[.]$/, '').trim(),
      disliked: ''
    };
  }
  
  // Pattern 5: only title
  match = fullReview.match(/^title: (.*)$/);
  if (match) {
    return {
      title: match[1].replace(/[.!]$/, '').trim(),
      liked: '',
      disliked: ''
    };
  }
  
  throw new Error(`Failed to parse review format: "${fullReview}"`);
}

function escapeCsvField(field: string): string {
  // Escape CSV fields by wrapping in quotes and escaping internal quotes
  if (field.includes('"') || field.includes(',') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function transformJsonToCsv(jsonFilePath: string): { written: number; filtered: number; total: number } {
  console.log(`Processing: ${jsonFilePath}`);
  
  // Read and parse JSON
  const jsonData: JsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
  
  // Prepare CSV output
  const csvRows: string[] = ['review_date,rating,title,liked,disliked,owner_response'];
  let filteredCount = 0;
  
  for (const [index, review] of jsonData.reviews.entries()) {
    try {
      // Parse the full_review field
      const parsed = parseFullReview(review.full_review);
      
      // Filter out low-quality reviews: short titles with no liked/disliked content
      const titleLength = parsed.title.trim().length;
      const hasShortTitle = titleLength <= 15; // Character limit for generic titles
      const hasNoContent = !parsed.liked.trim() && !parsed.disliked.trim();
      
      if (hasShortTitle && hasNoContent) {
        filteredCount++;
        continue; // Skip this review
      }
      
      // Create CSV row
      const csvRow: CsvRow = {
        review_date: review.review_post_date,
        rating: review.rating,
        title: parsed.title,
        liked: parsed.liked,
        disliked: parsed.disliked,
        owner_response: review.owner_resp_text || ''
      };
      
      // Convert to CSV format with proper escaping
      const csvLine = [
        escapeCsvField(csvRow.review_date),
        csvRow.rating.toString(),
        escapeCsvField(csvRow.title),
        escapeCsvField(csvRow.liked),
        escapeCsvField(csvRow.disliked),
        escapeCsvField(csvRow.owner_response)
      ].join(',');
      
      csvRows.push(csvLine);
      
    } catch (error) {
      console.error(`Error processing review ${index + 1} in ${jsonFilePath}:`);
      console.error(`Review data:`, review);
      console.error(`Error:`, error);
      process.exit(1);
    }
  }
  
  // Write CSV file
  const outputDir = 'data/booking/output-csv';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const jsonFileName = path.basename(jsonFilePath, '.json');
  const csvFilePath = path.join(outputDir, `${jsonFileName}.csv`);
  
  fs.writeFileSync(csvFilePath, csvRows.join('\n'), 'utf-8');
  const reviewsWritten = csvRows.length - 1; // Subtract header row
  const totalReviews = jsonData.reviews.length;
  console.log(`✅ Created: ${csvFilePath} (${reviewsWritten} reviews, filtered out ${filteredCount} low-quality reviews from ${totalReviews} total)`);
  
  return { written: reviewsWritten, filtered: filteredCount, total: totalReviews };
}

function main(): void {
  const outputDir = 'data/booking/output';

  if (!fs.existsSync(outputDir)) {
    console.error(`Output directory '${outputDir}' does not exist!`);
    process.exit(1);
  }
  
  // Get all JSON files except example.json
  const files = fs.readdirSync(outputDir)
    .filter(file => file.endsWith('.json') && file !== 'example.json')
    .map(file => path.join(outputDir, file));
  
  if (files.length === 0) {
    console.log('No JSON files found to process (excluding example.json)');
    return;
  }
  
  console.log(`Found ${files.length} JSON files to process:`);
  files.forEach(file => console.log(`  - ${path.basename(file)}`));
  console.log('');
  
  // Process each file and collect statistics
  let totalWritten = 0;
  let totalFiltered = 0;
  let totalReviews = 0;
  
  for (const file of files) {
    try {
      const stats = transformJsonToCsv(file);
      totalWritten += stats.written;
      totalFiltered += stats.filtered;
      totalReviews += stats.total;
    } catch (error) {
      console.error(`Failed to process ${file}:`, error);
      process.exit(1);
    }
  }
  
  console.log('\n🎉 All files processed successfully!');
  console.log(`📊 Summary: ${totalWritten} reviews written, ${totalFiltered} low-quality reviews filtered out from ${totalReviews} total reviews`);
  console.log('📋 Low-quality reviews (titles ≤15 characters with no content) have been filtered out.');
}

// Run the script
main(); 