// src/analytics-airbnb.ts
// 
// AirBnB reviews analytics script
// Analyzes all JSON output files and generates comprehensive statistics in CSV format
// Filters out low-quality reviews (short reviews with low ratings) before analysis
//
// Usage:
//   tsx src/analytics-airbnb.ts [--12m]
//   
// Options:
//   --12m    Filter reviews to 12-month rolling period from latest review date

import * as fs from 'fs';
import * as path from 'path';

/**
 * Parse command line arguments
 */
function parseArguments(): { rolling12m: boolean } {
  const args = process.argv.slice(2);
  return {
    rolling12m: args.includes('--12m')
  };
}

/**
 * Filter reviews to Year-to-Date (12 months back from latest review)
 */
function filterYTDReviews(reviews: AirBnBReview[]): { filtered: AirBnBReview[]; cutoffDate: Date | null } {
  // Find the latest review date across all reviews
  const validDates = reviews
    .map(r => parseReviewDate(r.review_date))
    .filter(date => date !== null) as Date[];
  
  if (validDates.length === 0) {
    return { filtered: [], cutoffDate: null };
  }
  
  const latestDate = new Date(Math.max(...validDates.map(d => d.getTime())));
  
  // Calculate 12 months back from the latest date
  const cutoffDate = new Date(latestDate);
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  
  const filteredReviews = reviews.filter(review => {
    if (!review.review_date) return false;
    const reviewDate = parseReviewDate(review.review_date);
    return reviewDate && reviewDate >= cutoffDate && reviewDate <= latestDate;
  });
  
  return { filtered: filteredReviews, cutoffDate };
}

/**
 * Filter out low-quality reviews (very short reviews with low ratings)
 */
function filterHighQualityReviews(reviews: AirBnBReview[]): { filtered: AirBnBReview[]; removedCount: number } {
  const filtered: AirBnBReview[] = [];
  let removedCount = 0;
  
  for (const review of reviews) {
    // Filter criteria for AirBnB reviews:
    // 1. Very short review text (≤20 characters) with low rating (≤2)
    // 2. No review text at all
    const reviewText = review.review_text?.trim() || '';
    const reviewLength = reviewText.length;
    const rating = review.rating || 0;
    
    const isVeryShortWithLowRating = reviewLength <= 20 && rating <= 2;
    const hasNoText = reviewLength === 0;
    
    if (isVeryShortWithLowRating || hasNoText) {
      removedCount++;
      continue; // Skip this review
    }
    
    // Keep high-quality reviews
    filtered.push(review);
  }
  
  return { filtered, removedCount };
}

const OUTPUT_DIR = 'data/airbnb/output';

/**
 * Get output file names based on 12m flag
 */
function getOutputFileNames(rolling12m: boolean) {
  const suffix = rolling12m ? '_12m' : '';
  return {
    analytics: `data/airbnb/analytics_results${suffix}.csv`,
    rawData: `data/airbnb/raw_reviews_data${suffix}.csv`
  };
}

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

interface AirBnBOutputData {
  input_file: string;
  scraped_at: string;
  total_reviews: number;
  properties_processed: string[];
  reviews: AirBnBReview[];
}

interface PropertyStats {
  property_id: string;
  property_title: string;
  review_count: number;
  avg_rating: number;
  oldest_review_date: Date | null;
  newest_review_date: Date | null;
  years_covered: number;
  reviews_per_year: number;
  low_rating_count: number; // ≤2 stars
  high_rating_count: number; // ≥4 stars
  languages_represented: string[];
  avg_review_length: number;
  host_response_count: number;
  host_response_rate: number;
}

interface FileStats {
  file_name: string;
  company_name: string;
  total_reviews: number;
  total_properties: number;
  avg_reviews_per_property: number;
  median_reviews_per_property: number;
  min_reviews_per_property: number;
  max_reviews_per_property: number;
  avg_reviews_per_year_per_property: number;
  overall_avg_rating: number;
  low_rating_percentage: number; // ≤2 stars
  high_rating_percentage: number; // ≥4 stars
  mid_rating_percentage: number; // 3 stars
  portfolio_stability_score: number;
  host_engagement_score: number;
  market_activity_score: number;
  outlier_property_impact: number;
  worst_property_name: string;
  worst_property_rating: number;
  oldest_review_date: string;
  newest_review_date: string;
  years_covered: number;
  overall_reviews_per_year: number;
  languages_count: number;
  top_languages: string;
  avg_review_length: number;
  overall_host_response_rate: number;
  properties_with_low_ratings: number;
  properties_with_low_ratings_percentage: number;
  properties_with_perfect_ratings: number;
  rating_distribution: string;
  review_length_distribution: string;
  verification_levels: string;
}

/**
 * Parse date string to Date object
 */
function parseReviewDate(dateString: string | null): Date | null {
  if (!dateString) return null;
  try {
    return new Date(dateString);
  } catch (error) {
    return null;
  }
}

/**
 * Calculate years between two dates
 */
function calculateYearsBetween(start: Date, end: Date): number {
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(diffYears, 0.1); // Minimum 0.1 years to avoid division by zero
}

/**
 * Analyze a single property's reviews
 */
function analyzePropertyReviews(reviews: AirBnBReview[], propertyId: string, fixedYearsPeriod?: number): PropertyStats {
  const propertyReviews = reviews.filter(r => r.property_id === propertyId);
  
  if (propertyReviews.length === 0) {
    return {
      property_id: propertyId,
      property_title: '',
      review_count: 0,
      avg_rating: 0,
      oldest_review_date: null,
      newest_review_date: null,
      years_covered: 0,
      reviews_per_year: 0,
      low_rating_count: 0,
      high_rating_count: 0,
      languages_represented: [],
      avg_review_length: 0,
      host_response_count: 0,
      host_response_rate: 0
    };
  }

  const propertyTitle = propertyReviews[0].property_title;

  // Calculate rating statistics
  const validRatings = propertyReviews.filter(r => r.rating !== null).map(r => r.rating!);
  const avgRating = validRatings.length > 0 ? validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length : 0;
  
  // Count low vs high ratings (assuming 1-5 scale)
  const lowRatings = validRatings.filter(rating => rating <= 2).length;
  const highRatings = validRatings.filter(rating => rating >= 4).length;

  // Calculate review length statistics
  const reviewTexts = propertyReviews.filter(r => r.review_text).map(r => r.review_text!);
  const avgReviewLength = reviewTexts.length > 0 ? 
    reviewTexts.reduce((sum, text) => sum + text.length, 0) / reviewTexts.length : 0;

  // Analyze dates
  const validDates = propertyReviews
    .map(r => parseReviewDate(r.review_date))
    .filter(date => date !== null) as Date[];
  
  let oldestDate: Date | null = null;
  let newestDate: Date | null = null;
  let yearsCovered = 0;
  let reviewsPerYear = 0;

  if (validDates.length > 0) {
    oldestDate = new Date(Math.min(...validDates.map(d => d.getTime())));
    newestDate = new Date(Math.max(...validDates.map(d => d.getTime())));
    
    // Use fixed period if provided (for consistent 12-month calculations), otherwise use actual date range
    if (fixedYearsPeriod !== undefined) {
      yearsCovered = fixedYearsPeriod;
      reviewsPerYear = propertyReviews.length / fixedYearsPeriod;
    } else {
      yearsCovered = calculateYearsBetween(oldestDate, newestDate);
      reviewsPerYear = propertyReviews.length / yearsCovered;
    }
  }

  // Analyze languages
  const languages = Array.from(new Set(propertyReviews
    .map(r => r.language)
    .filter(lang => lang !== null && lang.trim() !== ''))) as string[];

  // Analyze host responses
  const hostResponseCount = propertyReviews.filter(r => r.response_text && r.response_text.trim() !== '').length;
  const hostResponseRate = propertyReviews.length > 0 ? (hostResponseCount / propertyReviews.length) * 100 : 0;

  return {
    property_id: propertyId,
    property_title: propertyTitle,
    review_count: propertyReviews.length,
    avg_rating: avgRating,
    oldest_review_date: oldestDate,
    newest_review_date: newestDate,
    years_covered: yearsCovered,
    reviews_per_year: reviewsPerYear,
    low_rating_count: lowRatings,
    high_rating_count: highRatings,
    languages_represented: languages,
    avg_review_length: avgReviewLength,
    host_response_count: hostResponseCount,
    host_response_rate: hostResponseRate
  };
}

/**
 * Analyze a complete output file
 */
function analyzeOutputFile(filePath: string, rolling12m: boolean = false): FileStats | null {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const data: AirBnBOutputData = JSON.parse(fileContent);
    
    if (!data.reviews || data.reviews.length === 0) {
      console.log(`⚠️  No reviews found in ${path.basename(filePath)}`);
      return null;
    }

    // Filter out low-quality reviews before analysis
    const originalReviewCount = data.reviews.length;
    const filterResult = filterHighQualityReviews(data.reviews);
    const highQualityReviews = filterResult.filtered;
    const filteredOutCount = filterResult.removedCount;
    
    // Apply 12m filtering if requested
    let finalReviews = highQualityReviews;
    let ytdFilteredCount = 0;
    
    if (rolling12m) {
      const result12m = filterYTDReviews(highQualityReviews);
      ytdFilteredCount = highQualityReviews.length - result12m.filtered.length;
      finalReviews = result12m.filtered;
      
      console.log(`  🔍 Filtered: ${originalReviewCount} → ${highQualityReviews.length} high-quality → ${finalReviews.length} 12-month reviews (removed ${filteredOutCount} low-quality, ${ytdFilteredCount} non-12m)`);
    } else {
      console.log(`  🔍 Filtered: ${originalReviewCount} → ${finalReviews.length} reviews (removed ${filteredOutCount} low-quality)`);
    }

    if (finalReviews.length === 0) {
      const filterType = rolling12m ? '12-month ' : '';
      console.log(`⚠️  No ${filterType}high-quality reviews found in ${path.basename(filePath)} after filtering`);
      return null;
    }

    // Update data object to use filtered reviews for analysis
    data.reviews = finalReviews;

    const fileName = path.basename(filePath, '.json');
    const companyName = fileName.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    // For 12-month mode, use exactly 1.0 years for all calculations
    let fixedYearsPeriod: number | undefined = undefined;
    if (rolling12m) {
      fixedYearsPeriod = 1.0; // Always use exactly 1 year for 12-month mode
    }

    // Analyze each property
    const propertyStats: PropertyStats[] = [];
    
    // Get all unique property IDs from the reviews
    const propertyIds = new Set<string>();
    for (const review of data.reviews) {
      propertyIds.add(review.property_id);
    }

    // Analyze each property
    for (const propertyId of Array.from(propertyIds)) {
      const stats = analyzePropertyReviews(data.reviews, propertyId, fixedYearsPeriod);
      propertyStats.push(stats);
    }

    // Calculate file-level statistics
    const totalReviews = data.reviews.length;
    const totalProperties = propertyStats.length;
    
    // Property review counts
    const reviewCounts = propertyStats.map(p => p.review_count);
    const avgReviewsPerProperty = reviewCounts.length > 0 ? reviewCounts.reduce((sum, count) => sum + count, 0) / reviewCounts.length : 0;
    const sortedCounts = [...reviewCounts].sort((a, b) => a - b);
    const medianReviewsPerProperty = sortedCounts.length > 0 ? 
      (sortedCounts.length % 2 === 0 ? 
        (sortedCounts[sortedCounts.length / 2 - 1] + sortedCounts[sortedCounts.length / 2]) / 2 : 
        sortedCounts[Math.floor(sortedCounts.length / 2)]) : 0;
    
    // Reviews per year per property
    const reviewsPerYearValues = propertyStats.filter(p => p.reviews_per_year > 0).map(p => p.reviews_per_year);
    const avgReviewsPerYearPerProperty = reviewsPerYearValues.length > 0 ? 
      reviewsPerYearValues.reduce((sum, val) => sum + val, 0) / reviewsPerYearValues.length : 0;

    // Overall ratings (assuming 1-5 scale for AirBnB)
    const validRatings = data.reviews.filter(r => r.rating !== null).map(r => r.rating!);
    const overallAvgRating = validRatings.length > 0 ? validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length : 0;
    
    // Rating percentages (adjusted for 1-5 scale)
    const lowRatingCount = validRatings.filter(rating => rating <= 2).length;
    const highRatingCount = validRatings.filter(rating => rating >= 4).length;
    const midRatingCount = validRatings.filter(rating => rating === 3).length;
    const lowRatingPercentage = validRatings.length > 0 ? (lowRatingCount / validRatings.length) * 100 : 0;
    const highRatingPercentage = validRatings.length > 0 ? (highRatingCount / validRatings.length) * 100 : 0;
    const midRatingPercentage = validRatings.length > 0 ? (midRatingCount / validRatings.length) * 100 : 0;

    // Date analysis
    const allDates = data.reviews
      .map(r => parseReviewDate(r.review_date))
      .filter(date => date !== null) as Date[];
    
    let oldestDate = '';
    let newestDate = '';
    let yearsCovered = 0;
    let overallReviewsPerYear = 0;

    if (allDates.length > 0) {
      const oldest = new Date(Math.min(...allDates.map(d => d.getTime())));
      const newest = new Date(Math.max(...allDates.map(d => d.getTime())));
      oldestDate = oldest.toISOString().split('T')[0];
      newestDate = newest.toISOString().split('T')[0];
      yearsCovered = calculateYearsBetween(oldest, newest);
      
      // Use fixed period for consistent calculations in 12-month mode
      const yearsForCalculation = fixedYearsPeriod !== undefined ? fixedYearsPeriod : yearsCovered;
      overallReviewsPerYear = totalReviews / yearsForCalculation;
    }

    // Language analysis
    const languages = Array.from(new Set(data.reviews
      .map(r => r.language)
      .filter(lang => lang !== null && lang.trim() !== ''))) as string[];

    // Language frequency for top languages
    const langFreq = new Map<string, number>();
    data.reviews.forEach(r => {
      if (r.language) {
        langFreq.set(r.language, (langFreq.get(r.language) || 0) + 1);
      }
    });
    const topLanguages = Array.from(langFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([lang, count]) => `${lang}(${count})`)
      .join('; ');

    // Review length analysis
    const reviewTexts = data.reviews.filter(r => r.review_text).map(r => r.review_text!);
    const avgReviewLength = reviewTexts.length > 0 ? 
      reviewTexts.reduce((sum, text) => sum + text.length, 0) / reviewTexts.length : 0;

    // Host response analysis
    const reviewsWithResponse = data.reviews.filter(r => r.response_text !== null && r.response_text.trim() !== '').length;
    const overallHostResponseRate = totalReviews > 0 ? (reviewsWithResponse / totalReviews) * 100 : 0;

    // Property-level insights
    const propertiesWithLowRatings = propertyStats.filter(p => p.low_rating_count > 0).length;
    const propertiesWithLowRatingsPercentage = totalProperties > 0 ? (propertiesWithLowRatings / totalProperties) * 100 : 0;
    const propertiesWithPerfectRatings = propertyStats.filter(p => p.avg_rating === 5).length;

    // Rating distribution (1-5 scale)
    const ratingBuckets = [0, 0, 0, 0, 0]; // 1, 2, 3, 4, 5
    validRatings.forEach(rating => {
      if (rating >= 1 && rating <= 5) {
        ratingBuckets[Math.round(rating) - 1]++;
      }
    });
    const ratingDistribution = ratingBuckets.map((count, i) => {
      const percentage = validRatings.length > 0 ? ((count / validRatings.length) * 100).toFixed(1) : '0.0';
      return `${i + 1}:${percentage}%`;
    }).join('; ');

    // Review length distribution
    const lengthBuckets = [0, 0, 0, 0]; // <50, 50-150, 150-500, >500
    reviewTexts.forEach(text => {
      const length = text.length;
      if (length < 50) lengthBuckets[0]++;
      else if (length < 150) lengthBuckets[1]++;
      else if (length < 500) lengthBuckets[2]++;
      else lengthBuckets[3]++;
    });
    const reviewLengthDistribution = lengthBuckets.map((count, i) => {
      const ranges = ['<50', '50-150', '150-500', '>500'];
      const percentage = reviewTexts.length > 0 ? ((count / reviewTexts.length) * 100).toFixed(1) : '0.0';
      return `${ranges[i]}:${percentage}%`;
    }).join('; ');

    // Verification levels analysis
    const verificationLevels = new Map<string, number>();
    data.reviews.forEach(r => {
      if (r.reviewer_verification_level) {
        verificationLevels.set(r.reviewer_verification_level, (verificationLevels.get(r.reviewer_verification_level) || 0) + 1);
      }
    });
    const topVerificationLevels = Array.from(verificationLevels.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([level, count]) => `${level}(${count})`)
      .join('; ');

    // Advanced Business Intelligence Metrics

    // 1. Portfolio Stability Score (Standard Deviation of Ratings) - Consistency indicator
    let portfolioStabilityScore = 0;
    if (validRatings.length > 1) {
      const mean = overallAvgRating;
      const variance = validRatings.reduce((sum, rating) => sum + Math.pow(rating - mean, 2), 0) / validRatings.length;
      portfolioStabilityScore = Math.sqrt(variance);
    }

    // 2. Host Engagement Score (Response Rate to Low Ratings ≤2)
    const lowRatingReviews = data.reviews.filter(r => r.rating !== null && r.rating <= 2);
    const lowRatingReviewsWithResponse = lowRatingReviews.filter(r => r.response_text !== null && r.response_text.trim() !== '');
    const hostEngagementScore = lowRatingReviews.length > 0 ? (lowRatingReviewsWithResponse.length / lowRatingReviews.length) * 100 : 0;

    // 3. Market Activity Score (Reviews per Year per Property / Average Rating) - Activity indicator
    const marketActivityScore = overallAvgRating > 0 ? avgReviewsPerYearPerProperty / overallAvgRating : 0;

    // 4. Outlier Property Impact - How much the worst property drags down the average
    let outlierPropertyImpact = 0;
    let worstPropertyName = '';
    let worstPropertyRating = 5;
    
    if (propertyStats.length > 1) {
      // Find the worst-performing property
      const worstProperty = propertyStats.reduce((worst, property) => 
        property.avg_rating < worst.avg_rating && property.review_count >= 3 ? property : worst
      );
      
      worstPropertyName = worstProperty.property_title;
      worstPropertyRating = worstProperty.avg_rating;
      
      // Calculate average without the worst property
      const otherProperties = propertyStats.filter(p => p.property_id !== worstProperty.property_id);
      if (otherProperties.length > 0) {
        const otherPropertyReviews = data.reviews.filter(r => r.property_id !== worstProperty.property_id);
        const otherValidRatings = otherPropertyReviews.filter(r => r.rating !== null).map(r => r.rating!);
        const avgWithoutWorst = otherValidRatings.length > 0 ? 
          otherValidRatings.reduce((sum, rating) => sum + rating, 0) / otherValidRatings.length : overallAvgRating;
        
        outlierPropertyImpact = avgWithoutWorst - overallAvgRating;
      }
    } else if (propertyStats.length === 1) {
      worstPropertyName = propertyStats[0].property_title;
      worstPropertyRating = propertyStats[0].avg_rating;
      outlierPropertyImpact = 0; // No impact if only one property
    }

    return {
      file_name: fileName,
      company_name: companyName,
      total_reviews: totalReviews,
      total_properties: totalProperties,
      avg_reviews_per_property: Number(avgReviewsPerProperty.toFixed(1)),
      median_reviews_per_property: Number(medianReviewsPerProperty.toFixed(1)),
      min_reviews_per_property: Math.min(...reviewCounts),
      max_reviews_per_property: Math.max(...reviewCounts),
      avg_reviews_per_year_per_property: Number(avgReviewsPerYearPerProperty.toFixed(1)),
      overall_avg_rating: Number(overallAvgRating.toFixed(2)),
      low_rating_percentage: Number(lowRatingPercentage.toFixed(1)),
      high_rating_percentage: Number(highRatingPercentage.toFixed(1)),
      mid_rating_percentage: Number(midRatingPercentage.toFixed(1)),
      portfolio_stability_score: Number(portfolioStabilityScore.toFixed(2)),
      host_engagement_score: Number(hostEngagementScore.toFixed(1)),
      market_activity_score: Number(marketActivityScore.toFixed(1)),
      outlier_property_impact: Number(outlierPropertyImpact.toFixed(2)),
      worst_property_name: worstPropertyName,
      worst_property_rating: Number(worstPropertyRating.toFixed(2)),
      oldest_review_date: oldestDate,
      newest_review_date: newestDate,
      years_covered: Number(yearsCovered.toFixed(1)),
      overall_reviews_per_year: Number(overallReviewsPerYear.toFixed(1)),
      languages_count: languages.length,
      top_languages: topLanguages,
      avg_review_length: Number(avgReviewLength.toFixed(0)),
      overall_host_response_rate: Number(overallHostResponseRate.toFixed(1)),
      properties_with_low_ratings: propertiesWithLowRatings,
      properties_with_low_ratings_percentage: Number(propertiesWithLowRatingsPercentage.toFixed(1)),
      properties_with_perfect_ratings: propertiesWithPerfectRatings,
      rating_distribution: ratingDistribution,
      review_length_distribution: reviewLengthDistribution,
      verification_levels: topVerificationLevels
    };

  } catch (error) {
    console.error(`❌ Error analyzing file ${filePath}:`, error);
    return null;
  }
}

/**
 * Generate raw CSV data from all reviews with processed fields
 */
function generateRawCSV(allFileStats: FileStats[], outputDir: string, rolling12m: boolean = false, outputFileName: string): void {
  const modeText = rolling12m ? '12-month ' : '';
  console.log(`📋 Generating ${modeText}raw CSV data...`);
  
  // CSV headers for raw data
  const headers = [
    'file_name',
    'property_id',
    'property_title',
    'review_date',
    'rating',
    'review_text_length',
    'review_text',
    'language',
    'has_host_response',
    'reviewer_verification_level',
    'can_be_translated'
  ];

  const allRows: string[] = [headers.join(',')];

  // Process each JSON file
  const jsonFiles = fs.readdirSync(outputDir)
    .filter(file => file.endsWith('.json'))
    .filter(file => !file.toLowerCase().includes('example'))
    .map(file => path.join(outputDir, file))
    .sort();

  for (const filePath of jsonFiles) {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const data: AirBnBOutputData = JSON.parse(fileContent);
      const fileName = path.basename(filePath, '.json');
      
      // Filter high-quality reviews
      const filterResult = filterHighQualityReviews(data.reviews);
      let reviewsToProcess = filterResult.filtered;
      
      // Apply 12-month filtering if requested
      if (rolling12m) {
        const result12m = filterYTDReviews(reviewsToProcess);
        reviewsToProcess = result12m.filtered;
      }
      
      for (const review of reviewsToProcess) {
        const reviewText = review.review_text || '';
        const reviewTextLength = reviewText.length;
        const hasHostResponse = review.response_text && review.response_text.trim() !== '' ? 'Yes' : 'No';
        
        // Escape CSV fields
        const csvRow = [
          fileName,
          `"${review.property_id}"`,
          `"${review.property_title}"`,
          review.review_date || '',
          review.rating || '',
          reviewTextLength,
          `"${reviewText.replace(/"/g, '""')}"`,
          `"${review.language || ''}"`,
          hasHostResponse,
          `"${review.reviewer_verification_level || ''}"`,
          review.can_be_translated ? 'Yes' : 'No'
        ].join(',');
        
        allRows.push(csvRow);
      }
    } catch (error) {
      console.error(`❌ Error processing ${filePath}:`, error);
    }
  }

  // Write raw CSV file
  fs.writeFileSync(outputFileName, allRows.join('\n'));
  const reviewCount = allRows.length - 1; // Subtract header row
  console.log(`✅ Raw CSV data saved to: ${outputFileName} (${reviewCount} reviews)`);
}

/**
 * Generate CSV content from file statistics
 */
function generateCSV(fileStats: FileStats[]): string {
  if (fileStats.length === 0) {
    return 'No data to generate CSV';
  }

  // CSV headers
  const headers = [
    'file_name',
    'company_name',
    'total_reviews',
    'total_properties',
    'avg_reviews_per_property',
    'median_reviews_per_property',
    'min_reviews_per_property',
    'max_reviews_per_property',
    'avg_reviews_per_year_per_property',
    'overall_avg_rating',
    'low_rating_percentage',
    'high_rating_percentage',
    'mid_rating_percentage',
    'portfolio_stability_score',
    'host_engagement_score',
    'market_activity_score',
    'outlier_property_impact',
    'worst_property_name',
    'worst_property_rating',
    'oldest_review_date',
    'newest_review_date',
    'years_covered',
    'overall_reviews_per_year',
    'languages_count',
    'top_languages',
    'avg_review_length',
    'overall_host_response_rate',
    'properties_with_low_ratings',
    'properties_with_low_ratings_percentage',
    'properties_with_perfect_ratings',
    'rating_distribution',
    'review_length_distribution',
    'verification_levels'
  ];

  // CSV rows
  const rows = fileStats.map(stats => [
    stats.file_name,
    `"${stats.company_name}"`,
    stats.total_reviews,
    stats.total_properties,
    stats.avg_reviews_per_property,
    stats.median_reviews_per_property,
    stats.min_reviews_per_property,
    stats.max_reviews_per_property,
    stats.avg_reviews_per_year_per_property,
    stats.overall_avg_rating,
    stats.low_rating_percentage,
    stats.high_rating_percentage,
    stats.mid_rating_percentage,
    stats.portfolio_stability_score,
    stats.host_engagement_score,
    stats.market_activity_score,
    stats.outlier_property_impact,
    `"${stats.worst_property_name}"`,
    stats.worst_property_rating,
    stats.oldest_review_date,
    stats.newest_review_date,
    stats.years_covered,
    stats.overall_reviews_per_year,
    stats.languages_count,
    `"${stats.top_languages}"`,
    stats.avg_review_length,
    stats.overall_host_response_rate,
    stats.properties_with_low_ratings,
    stats.properties_with_low_ratings_percentage,
    stats.properties_with_perfect_ratings,
    `"${stats.rating_distribution}"`,
    `"${stats.review_length_distribution}"`,
    `"${stats.verification_levels}"`
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

export { analyzeOutputFile, generateCSV, generateRawCSV };

export interface RunAnalyticsOptions {
  rolling12m?: boolean;
  outputDir?: string;
}

/**
 * Run analytics (importable wrapper for CLI)
 */
export async function runAnalytics(options: RunAnalyticsOptions = {}): Promise<void> {
  const rolling12m = options.rolling12m ?? false;
  const outputDir = options.outputDir ?? OUTPUT_DIR;
  const outputFiles = getOutputFileNames(rolling12m);

  const modeText = rolling12m ? '12-month rolling ' : '';
  console.log(`Starting ${modeText}AirBnB reviews analytics...`);

  if (!fs.existsSync(outputDir)) {
    console.error(`Output directory not found: ${outputDir}`);
    process.exit(1);
  }

  const jsonFiles = fs.readdirSync(outputDir)
    .filter(file => file.endsWith('.json'))
    .filter(file => !file.toLowerCase().includes('example'))
    .map(file => path.join(outputDir, file))
    .sort();

  if (jsonFiles.length === 0) {
    console.log(`No JSON files found in ${outputDir} directory`);
    return;
  }

  console.log(`Found ${jsonFiles.length} JSON files to analyze`);

  const allFileStats: FileStats[] = [];

  for (const filePath of jsonFiles) {
    const fileName = path.basename(filePath);
    console.log(`Analyzing: ${fileName}`);
    const stats = analyzeOutputFile(filePath, rolling12m);
    if (stats) {
      allFileStats.push(stats);
      console.log(`  ${stats.total_reviews} high-quality reviews from ${stats.total_properties} properties`);
    }
  }

  if (allFileStats.length === 0) {
    console.log('No valid statistics generated');
    return;
  }

  const csvContent = generateCSV(allFileStats);
  fs.writeFileSync(outputFiles.analytics, csvContent);
  console.log(`Analytics saved to: ${outputFiles.analytics}`);

  generateRawCSV(allFileStats, outputDir, rolling12m, outputFiles.rawData);
  console.log(`Analytics completed!`);
}

/**
 * Main analytics function
 */
async function main(): Promise<void> {
  const { rolling12m } = parseArguments();
  const outputFiles = getOutputFileNames(rolling12m);
  
  const modeText = rolling12m ? '12-month rolling ' : '';
  console.log(`🔍 Starting ${modeText}AirBnB reviews analytics...`);

  // Check if output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    console.error(`❌ Output directory not found: ${OUTPUT_DIR}`);
    process.exit(1);
  }

  // Get all JSON files from output directory, excluding example files
  const jsonFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(file => file.endsWith('.json'))
    .filter(file => !file.toLowerCase().includes('example'))
    .map(file => path.join(OUTPUT_DIR, file))
    .sort();

  if (jsonFiles.length === 0) {
    console.log(`⚠️  No JSON files found in ${OUTPUT_DIR} directory`);
    process.exit(0);
  }

  console.log(`📂 Found ${jsonFiles.length} JSON files to analyze`);

  // Calculate 12-month date range if needed
  let dateRange12m = '';
  if (rolling12m) {
    console.log(`📅 Calculating 12-month date range...`);
    
    // Collect all reviews from all files to find the global latest date
    const allReviews: AirBnBReview[] = [];
    for (const filePath of jsonFiles) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const data: AirBnBOutputData = JSON.parse(fileContent);
        allReviews.push(...data.reviews);
      } catch (error) {
        // Ignore errors for date calculation
      }
    }
    
    const result12m = filterYTDReviews(allReviews);
    if (result12m.cutoffDate) {
      const cutoffDateStr = result12m.cutoffDate.toISOString().split('T')[0];
      const latestDate = new Date(Math.max(...allReviews
        .map(r => parseReviewDate(r.review_date))
        .filter(d => d !== null)
        .map(d => d!.getTime())));
      const latestDateStr = latestDate.toISOString().split('T')[0];
      dateRange12m = `${cutoffDateStr} to ${latestDateStr}`;
      console.log(`📅 12-month range: ${dateRange12m}`);
    }
  }

  // Analyze each file
  const allFileStats: FileStats[] = [];
  let totalOriginalReviews = 0;
  let totalFilteredReviews = 0;
  
  for (const filePath of jsonFiles) {
    const fileName = path.basename(filePath);
    console.log(`📊 Analyzing: ${fileName}`);
    
    // Get original review count for summary
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(fileContent);
      totalOriginalReviews += data.reviews?.length || 0;
    } catch (error) {
      // Ignore error for summary
    }
    
    const stats = analyzeOutputFile(filePath, rolling12m);
    if (stats) {
      allFileStats.push(stats);
      totalFilteredReviews += stats.total_reviews;
      console.log(`  ✅ ${stats.total_reviews} high-quality reviews from ${stats.total_properties} properties`);
    }
  }

  if (allFileStats.length === 0) {
    console.log('❌ No valid statistics generated');
    process.exit(1);
  }

  // Generate both CSV files
  console.log('\n📈 Generating analytics CSV...');
  const csvContent = generateCSV(allFileStats);
  
  // Save analytics CSV file
  fs.writeFileSync(outputFiles.analytics, csvContent);
  console.log(`✅ Analytics saved to: ${outputFiles.analytics}`);

  // Generate raw CSV data
  generateRawCSV(allFileStats, OUTPUT_DIR, rolling12m, outputFiles.rawData);

  // Print summary
  const totalRemovedReviews = totalOriginalReviews - totalFilteredReviews;
  const filteringPercentage = totalOriginalReviews > 0 ? ((totalRemovedReviews / totalOriginalReviews) * 100).toFixed(1) : '0.0';
  const totalProperties = allFileStats.reduce((sum, stats) => sum + stats.total_properties, 0);
  
  const summaryTitle = rolling12m ? '12-Month AirBnB Analytics Summary:' : 'AirBnB Analytics Summary:';
  console.log(`\n📋 ${summaryTitle}`);
  if (rolling12m && dateRange12m) {
    console.log(`  📅 12-Month Period: ${dateRange12m} (rolling window)`);
  }
  console.log(`  📁 Files analyzed: ${allFileStats.length}`);
  console.log(`  📊 Original reviews: ${totalOriginalReviews}`);
  console.log(`  ✨ High-quality reviews: ${totalFilteredReviews}`);
  console.log(`  🗑️  Low-quality filtered out: ${totalRemovedReviews} (${filteringPercentage}%)`);
  console.log(`  🏠 Total properties: ${totalProperties}`);
  const avgReviewLength = allFileStats.reduce((sum, stats) => sum + (stats.avg_review_length * stats.total_reviews), 0) / allFileStats.reduce((sum, stats) => sum + stats.total_reviews, 0);
  console.log(`  📝 Average review length: ${avgReviewLength.toFixed(0)} characters`);
  console.log(`  ⭐ Average rating across all: ${(allFileStats.reduce((sum, stats) => sum + (stats.overall_avg_rating * stats.total_reviews), 0) / allFileStats.reduce((sum, stats) => sum + stats.total_reviews, 0)).toFixed(2)}`);
  const overallHostResponseRate = allFileStats.reduce((sum, stats) => sum + (stats.overall_host_response_rate * stats.total_reviews), 0) / allFileStats.reduce((sum, stats) => sum + stats.total_reviews, 0);
  console.log(`  💬 Overall host response rate: ${overallHostResponseRate.toFixed(1)}%`);
  
  const completionText = rolling12m ? '12-month AirBnB analytics completed!' : 'AirBnB analytics completed!';
  console.log(`\n🎉 ${completionText} (Based on high-quality reviews only)`);
}

// Run the analytics (only when executed directly)
const isDirectRun = process.argv[1]?.includes('airbnb/analytics') || process.argv[1]?.includes('airbnb\\analytics');
if (isDirectRun) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
} 