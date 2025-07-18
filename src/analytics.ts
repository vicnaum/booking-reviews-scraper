// src/analytics.ts
// 
// Hotel reviews analytics script
// Analyzes all JSON output files and generates comprehensive statistics in CSV format
// Filters out low-quality reviews (titles ≤15 characters with no content) before analysis
//
// Usage:
//   tsx src/analytics.ts [--ytd]
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
function filterYTDReviews(reviews: Review[]): { filtered: Review[]; cutoffDate: Date | null } {
  // Find the latest review date across all reviews
  const validDates = reviews
    .map(r => parseReviewDate(r.review_post_date))
    .filter(date => date !== null) as Date[];
  
  if (validDates.length === 0) {
    return { filtered: [], cutoffDate: null };
  }
  
  const latestDate = new Date(Math.max(...validDates.map(d => d.getTime())));
  
  // Calculate 12 months back from the latest date
  const cutoffDate = new Date(latestDate);
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  
  const filteredReviews = reviews.filter(review => {
    if (!review.review_post_date) return false;
    const reviewDate = parseReviewDate(review.review_post_date);
    return reviewDate && reviewDate >= cutoffDate && reviewDate <= latestDate;
  });
  
  return { filtered: filteredReviews, cutoffDate };
}

/**
 * Parse stay_duration field to extract number of nights
 */
function parseStayDuration(stayDuration: string | null): number | null {
  if (!stayDuration) return null;
  
  // Try regex approach first: match digit(s) + space + "night"
  const match = stayDuration.match(/^(\d+)\s+nights?/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  
  // Fallback: split by space and parse first part
  const parts = stayDuration.trim().split(/\s+/);
  if (parts.length > 0) {
    const parsed = parseInt(parts[0], 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  
  return null;
}

/**
 * Get apartment identifier from hotel_name and room_view
 */
function getApartmentId(hotelName: string, roomView: string | null): string {
  if (!roomView || roomView.trim() === '') {
    return hotelName; // Default room if no room_view specified
  }
  return `${hotelName} | ${roomView}`;
}

/**
 * Parse full_review field to extract title, liked, and disliked sections
 */
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
  
  // Fallback: return empty values if no pattern matches
  return { title: '', liked: '', disliked: '' };
}

/**
 * Filter out low-quality reviews (short titles with no content)
 */
function filterHighQualityReviews(reviews: Review[]): { filtered: Review[]; removedCount: number } {
  const filtered: Review[] = [];
  let removedCount = 0;
  
  for (const review of reviews) {
    if (!review.full_review) {
      // Keep reviews without full_review field
      filtered.push(review);
      continue;
    }
    
    try {
      // Parse the full_review field
      const parsed = parseFullReview(review.full_review);
      
      // Filter out low-quality reviews: short titles with no liked/disliked content
      const titleLength = parsed.title.trim().length;
      const hasShortTitle = titleLength <= 15; // Character limit for generic titles
      const hasNoContent = !parsed.liked.trim() && !parsed.disliked.trim();
      
      if (hasShortTitle && hasNoContent) {
        removedCount++;
        continue; // Skip this review
      }
      
      // Keep high-quality reviews
      filtered.push(review);
      
    } catch (error) {
      // If parsing fails, keep the review to avoid losing data
      filtered.push(review);
    }
  }
  
  return { filtered, removedCount };
}

const OUTPUT_DIR = 'output';

/**
 * Get output file names based on YTD flag
 */
function getOutputFileNames(rolling12m: boolean) {
  const suffix = rolling12m ? '_12m' : '';
  return {
    analytics: `analytics_results${suffix}.csv`,
    rawData: `raw_reviews_data${suffix}.csv`
  };
}

interface Review {
  hotel_name: string;
  username: string | null;
  user_country: string | null;
  room_view: string | null;
  stay_duration: string | null;
  stay_type: string | null;
  review_post_date: string | null;
  review_title: string | null;
  rating: number | null;
  original_lang: string | null;
  review_text_liked: string | null;
  review_text_disliked: string | null;
  full_review: string | null;
  en_full_review: string | null;
  found_helpful: number;
  found_unhelpful: number;
  owner_resp_text: string | null;
}

interface OutputData {
  input_file: string;
  scraped_at: string;
  total_reviews: number;
  hotels_processed: string[];
  reviews: Review[];
}

interface ApartmentStats {
  apartment_id: string;
  hotel_name: string;
  room_view: string;
  review_count: number;
  avg_rating: number;
  oldest_review_date: Date | null;
  newest_review_date: Date | null;
  years_covered: number;
  reviews_per_year: number;
  negative_review_count: number;
  positive_review_count: number;
  countries_represented: string[];
  total_nights: number;
  avg_nights_per_review: number;
  nights_per_year: number;
}

interface FileStats {
  file_name: string;
  company_name: string;
  total_reviews: number;
  total_hotels: number;
  total_apartments: number;
  avg_reviews_per_apartment: number;
  median_reviews_per_apartment: number;
  min_reviews_per_apartment: number;
  max_reviews_per_apartment: number;
  avg_reviews_per_year_per_apartment: number;
  total_nights: number;
  avg_nights_per_apartment: number;
  avg_nights_per_year_per_apartment: number;
  overall_avg_rating: number;
  negative_review_percentage: number;
  positive_review_percentage: number;
  true_problem_rate: number;
  portfolio_stability_score: number;
  host_engagement_score: number;
  market_fit_score: number;
  outlier_property_impact: number;
  worst_property_name: string;
  worst_property_rating: number;
  oldest_review_date: string;
  newest_review_date: string;
  years_covered: number;
  overall_reviews_per_year: number;
  countries_count: number;
  top_countries: string;
  languages_count: number;
  top_languages: string;
  avg_helpful_votes: number;
  owner_response_rate: number;
  apartments_with_negative_reviews: number;
  apartments_with_negative_reviews_percentage: number;
  apartments_with_perfect_ratings: number;
  rating_distribution: string;
}

/**
 * Parse date string to Date object
 */
function parseReviewDate(dateString: string | null): Date | null {
  if (!dateString) return null;
  try {
    // Handle both "YYYY-MM-DD HH:mm:ss" and "YYYY-MM-DDTHH:mm:ss.sssZ" formats
    const cleanDate = dateString.replace(' ', 'T');
    return new Date(cleanDate);
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
 * Analyze a single apartment's reviews
 */
function analyzeApartmentReviews(reviews: Review[], apartmentId: string, hotelName: string, roomView: string, fixedYearsPeriod?: number): ApartmentStats {
  const apartmentReviews = reviews.filter(r => getApartmentId(r.hotel_name, r.room_view) === apartmentId);
  
  if (apartmentReviews.length === 0) {
    return {
      apartment_id: apartmentId,
      hotel_name: hotelName,
      room_view: roomView,
      review_count: 0,
      avg_rating: 0,
      oldest_review_date: null,
      newest_review_date: null,
      years_covered: 0,
      reviews_per_year: 0,
      negative_review_count: 0,
      positive_review_count: 0,
      countries_represented: [],
      total_nights: 0,
      avg_nights_per_review: 0,
      nights_per_year: 0
    };
  }

  // Calculate rating statistics
  const validRatings = apartmentReviews.filter(r => r.rating !== null).map(r => r.rating!);
  const avgRating = validRatings.length > 0 ? validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length : 0;
  
  // Count negative vs positive reviews
  const negativeReviews = validRatings.filter(rating => rating <= 5).length;
  const positiveReviews = validRatings.filter(rating => rating > 5).length;

  // Calculate nights statistics
  const validNights = apartmentReviews
    .map(r => parseStayDuration(r.stay_duration))
    .filter(nights => nights !== null) as number[];
  const totalNights = validNights.reduce((sum, nights) => sum + nights, 0);
  const avgNightsPerReview = validNights.length > 0 ? totalNights / validNights.length : 0;

  // Analyze dates
  const validDates = apartmentReviews
    .map(r => parseReviewDate(r.review_post_date))
    .filter(date => date !== null) as Date[];
  
  let oldestDate: Date | null = null;
  let newestDate: Date | null = null;
  let yearsCovered = 0;
  let reviewsPerYear = 0;
  let nightsPerYear = 0;

  if (validDates.length > 0) {
    oldestDate = new Date(Math.min(...validDates.map(d => d.getTime())));
    newestDate = new Date(Math.max(...validDates.map(d => d.getTime())));
    
    // Use fixed period if provided (for consistent 12-month calculations), otherwise use actual date range
    if (fixedYearsPeriod !== undefined) {
      yearsCovered = fixedYearsPeriod;
      reviewsPerYear = apartmentReviews.length / fixedYearsPeriod;
      nightsPerYear = totalNights / fixedYearsPeriod;
    } else {
      yearsCovered = calculateYearsBetween(oldestDate, newestDate);
      reviewsPerYear = apartmentReviews.length / yearsCovered;
      nightsPerYear = totalNights / yearsCovered;
    }
  }

  // Analyze countries
  const countries = [...new Set(apartmentReviews
    .map(r => r.user_country)
    .filter(country => country !== null && country.trim() !== ''))] as string[];

  return {
    apartment_id: apartmentId,
    hotel_name: hotelName,
    room_view: roomView,
    review_count: apartmentReviews.length,
    avg_rating: avgRating,
    oldest_review_date: oldestDate,
    newest_review_date: newestDate,
    years_covered: yearsCovered,
    reviews_per_year: reviewsPerYear,
    negative_review_count: negativeReviews,
    positive_review_count: positiveReviews,
    countries_represented: countries,
    total_nights: totalNights,
    avg_nights_per_review: avgNightsPerReview,
    nights_per_year: nightsPerYear
  };
}

/**
 * Analyze a complete output file
 */
function analyzeOutputFile(filePath: string, rolling12m: boolean = false): FileStats | null {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const data: OutputData = JSON.parse(fileContent);
    
    if (!data.reviews || data.reviews.length === 0) {
      console.log(`⚠️  No reviews found in ${path.basename(filePath)}`);
      return null;
    }

    // Filter out low-quality reviews before analysis
    const originalReviewCount = data.reviews.length;
    const filterResult = filterHighQualityReviews(data.reviews);
    const highQualityReviews = filterResult.filtered;
    const filteredOutCount = filterResult.removedCount;
    
    // Apply YTD filtering if requested
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

    // Analyze each apartment
    const apartmentStats: ApartmentStats[] = [];
    
    // Get all unique apartment IDs from the reviews
    const apartmentIds = new Set<string>();
    for (const review of data.reviews) {
      apartmentIds.add(getApartmentId(review.hotel_name, review.room_view));
    }

    // Analyze each apartment
    for (const apartmentId of apartmentIds) {
      // Parse apartment ID to get hotel name and room view
      const parts = apartmentId.split(' | ');
      const hotelName = parts[0];
      const roomView = parts.length > 1 ? parts[1] : '';
      
      const stats = analyzeApartmentReviews(data.reviews, apartmentId, hotelName, roomView, fixedYearsPeriod);
      apartmentStats.push(stats);
    }

    // Calculate file-level statistics
    const totalReviews = data.reviews.length;
    const totalHotels = data.hotels_processed.length;
    const totalApartments = apartmentStats.length;
    
    // Apartment review counts
    const reviewCounts = apartmentStats.map(h => h.review_count);
    const avgReviewsPerApartment = reviewCounts.length > 0 ? reviewCounts.reduce((sum, count) => sum + count, 0) / reviewCounts.length : 0;
    const sortedCounts = [...reviewCounts].sort((a, b) => a - b);
    const medianReviewsPerApartment = sortedCounts.length > 0 ? 
      (sortedCounts.length % 2 === 0 ? 
        (sortedCounts[sortedCounts.length / 2 - 1] + sortedCounts[sortedCounts.length / 2]) / 2 : 
        sortedCounts[Math.floor(sortedCounts.length / 2)]) : 0;
    
    // Reviews per year per apartment
    const reviewsPerYearValues = apartmentStats.filter(h => h.reviews_per_year > 0).map(h => h.reviews_per_year);
    const avgReviewsPerYearPerApartment = reviewsPerYearValues.length > 0 ? 
      reviewsPerYearValues.reduce((sum, val) => sum + val, 0) / reviewsPerYearValues.length : 0;
    
    // Nights statistics
    const nightsCounts = apartmentStats.map(h => h.total_nights);
    const totalNightsOverall = nightsCounts.reduce((sum, nights) => sum + nights, 0);
    const avgNightsPerApartment = nightsCounts.length > 0 ? totalNightsOverall / totalApartments : 0;
    const nightsPerYearValues = apartmentStats.filter(h => h.nights_per_year > 0).map(h => h.nights_per_year);
    const avgNightsPerYearPerApartment = nightsPerYearValues.length > 0 ? 
      nightsPerYearValues.reduce((sum, val) => sum + val, 0) / nightsPerYearValues.length : 0;

    // Overall ratings
    const validRatings = data.reviews.filter(r => r.rating !== null).map(r => r.rating!);
    const overallAvgRating = validRatings.length > 0 ? validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length : 0;
    
    // Negative/positive percentages
    const negativeCount = validRatings.filter(rating => rating <= 5).length;
    const positiveCount = validRatings.filter(rating => rating > 5).length;
    const negativePercentage = validRatings.length > 0 ? (negativeCount / validRatings.length) * 100 : 0;
    const positivePercentage = validRatings.length > 0 ? (positiveCount / validRatings.length) * 100 : 0;

    // Date analysis
    const allDates = data.reviews
      .map(r => parseReviewDate(r.review_post_date))
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

  // Overall nights per year calculation - use fixed period if available
  const yearsForNightsCalculation = fixedYearsPeriod !== undefined ? fixedYearsPeriod : yearsCovered;
  const overallNightsPerYear = yearsForNightsCalculation > 0 ? totalNightsOverall / yearsForNightsCalculation : 0;

    // Country and language analysis
    const countries = [...new Set(data.reviews
      .map(r => r.user_country)
      .filter(country => country !== null && country.trim() !== ''))] as string[];
    
    const languages = [...new Set(data.reviews
      .map(r => r.original_lang)
      .filter(lang => lang !== null && lang.trim() !== ''))] as string[];

    // Country frequency for top countries
    const countryFreq = new Map<string, number>();
    data.reviews.forEach(r => {
      if (r.user_country) {
        countryFreq.set(r.user_country, (countryFreq.get(r.user_country) || 0) + 1);
      }
    });
    const topCountries = Array.from(countryFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([country, count]) => `${country}(${count})`)
      .join('; ');

    // Language frequency for top languages
    const langFreq = new Map<string, number>();
    data.reviews.forEach(r => {
      if (r.original_lang) {
        langFreq.set(r.original_lang, (langFreq.get(r.original_lang) || 0) + 1);
      }
    });
    const topLanguages = Array.from(langFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([lang, count]) => `${lang}(${count})`)
      .join('; ');

    // Helpful votes
    const avgHelpfulVotes = data.reviews.length > 0 ? 
      data.reviews.reduce((sum, r) => sum + r.found_helpful, 0) / data.reviews.length : 0;

    // Owner response rate
    const reviewsWithResponse = data.reviews.filter(r => r.owner_resp_text !== null && r.owner_resp_text.trim() !== '').length;
    const ownerResponseRate = totalReviews > 0 ? (reviewsWithResponse / totalReviews) * 100 : 0;

    // Apartment-level insights
    const apartmentsWithNegativeReviews = apartmentStats.filter(h => h.negative_review_count > 0).length;
    const apartmentsWithNegativeReviewsPercentage = totalApartments > 0 ? (apartmentsWithNegativeReviews / totalApartments) * 100 : 0;
    const apartmentsWithPerfectRatings = apartmentStats.filter(h => h.avg_rating === 10).length;

    // Rating distribution
    const ratingBuckets = [0, 0, 0, 0, 0]; // 1-2, 3-4, 5-6, 7-8, 9-10
    validRatings.forEach(rating => {
      if (rating <= 2) ratingBuckets[0]++;
      else if (rating <= 4) ratingBuckets[1]++;
      else if (rating <= 6) ratingBuckets[2]++;
      else if (rating <= 8) ratingBuckets[3]++;
      else ratingBuckets[4]++;
    });
    const ratingDistribution = ratingBuckets.map((count, i) => {
      const ranges = ['1-2', '3-4', '5-6', '7-8', '9-10'];
      const percentage = validRatings.length > 0 ? ((count / validRatings.length) * 100).toFixed(1) : '0.0';
      return `${ranges[i]}:${percentage}%`;
    }).join('; ');

    // Advanced Business Intelligence Metrics

    // 1. "True" Problem Rate (Rating ≤ 7) - More realistic view of problematic stays
    const problemReviews = validRatings.filter(rating => rating <= 7).length;
    const trueProblemRate = validRatings.length > 0 ? (problemReviews / validRatings.length) * 100 : 0;

    // 2. Portfolio Stability Score (Standard Deviation of Ratings) - Consistency indicator
    let portfolioStabilityScore = 0;
    if (validRatings.length > 1) {
      const mean = overallAvgRating;
      const variance = validRatings.reduce((sum, rating) => sum + Math.pow(rating - mean, 2), 0) / validRatings.length;
      portfolioStabilityScore = Math.sqrt(variance);
    }

    // 3. Host Engagement Score (Owner Response Rate to Negative Reviews ≤ 7)
    const negativeReviews = data.reviews.filter(r => r.rating !== null && r.rating <= 7);
    const negativeReviewsWithResponse = negativeReviews.filter(r => r.owner_resp_text !== null && r.owner_resp_text.trim() !== '');
    const hostEngagementScore = negativeReviews.length > 0 ? (negativeReviewsWithResponse.length / negativeReviews.length) * 100 : 0;

    // 4. Market Fit Score (Nights per Year per Apartment / Average Rating) - Individual Apartment Performance
    const marketFitScore = overallAvgRating > 0 ? avgNightsPerYearPerApartment / overallAvgRating : 0;

    // 5. Outlier Property Impact - How much the worst apartment drags down the average
    let outlierPropertyImpact = 0;
    let worstPropertyName = '';
    let worstPropertyRating = 10;
    
    if (apartmentStats.length > 1) {
      // Find the worst-performing apartment
      const worstApartment = apartmentStats.reduce((worst, apartment) => 
        apartment.avg_rating < worst.avg_rating && apartment.review_count >= 3 ? apartment : worst
      );
      
      worstPropertyName = worstApartment.apartment_id;
      worstPropertyRating = worstApartment.avg_rating;
      
      // Calculate average without the worst apartment
      const otherApartments = apartmentStats.filter(h => h.apartment_id !== worstApartment.apartment_id);
      if (otherApartments.length > 0) {
        const otherApartmentReviews = data.reviews.filter(r => getApartmentId(r.hotel_name, r.room_view) !== worstApartment.apartment_id);
        const otherValidRatings = otherApartmentReviews.filter(r => r.rating !== null).map(r => r.rating!);
        const avgWithoutWorst = otherValidRatings.length > 0 ? 
          otherValidRatings.reduce((sum, rating) => sum + rating, 0) / otherValidRatings.length : overallAvgRating;
        
        outlierPropertyImpact = avgWithoutWorst - overallAvgRating;
      }
    } else if (apartmentStats.length === 1) {
      worstPropertyName = apartmentStats[0].apartment_id;
      worstPropertyRating = apartmentStats[0].avg_rating;
      outlierPropertyImpact = 0; // No impact if only one property
    }

    return {
      file_name: fileName,
      company_name: companyName,
      total_reviews: totalReviews,
      total_hotels: totalHotels,
      total_apartments: totalApartments,
      avg_reviews_per_apartment: Number(avgReviewsPerApartment.toFixed(1)),
      median_reviews_per_apartment: Number(medianReviewsPerApartment.toFixed(1)),
      min_reviews_per_apartment: Math.min(...reviewCounts),
      max_reviews_per_apartment: Math.max(...reviewCounts),
      avg_reviews_per_year_per_apartment: Number(avgReviewsPerYearPerApartment.toFixed(1)),
      total_nights: totalNightsOverall,
      avg_nights_per_apartment: Number(avgNightsPerApartment.toFixed(1)),
      avg_nights_per_year_per_apartment: Number(avgNightsPerYearPerApartment.toFixed(1)),
      overall_avg_rating: Number(overallAvgRating.toFixed(2)),
      negative_review_percentage: Number(negativePercentage.toFixed(1)),
      positive_review_percentage: Number(positivePercentage.toFixed(1)),
      true_problem_rate: Number(trueProblemRate.toFixed(1)),
      portfolio_stability_score: Number(portfolioStabilityScore.toFixed(2)),
      host_engagement_score: Number(hostEngagementScore.toFixed(1)),
      market_fit_score: Number(marketFitScore.toFixed(1)),
      outlier_property_impact: Number(outlierPropertyImpact.toFixed(2)),
      worst_property_name: worstPropertyName,
      worst_property_rating: Number(worstPropertyRating.toFixed(2)),
      oldest_review_date: oldestDate,
      newest_review_date: newestDate,
      years_covered: Number(yearsCovered.toFixed(1)),
      overall_reviews_per_year: Number(overallReviewsPerYear.toFixed(1)),
      countries_count: countries.length,
      top_countries: topCountries,
      languages_count: languages.length,
      top_languages: topLanguages,
      avg_helpful_votes: Number(avgHelpfulVotes.toFixed(1)),
      owner_response_rate: Number(ownerResponseRate.toFixed(1)),
      apartments_with_negative_reviews: apartmentsWithNegativeReviews,
      apartments_with_negative_reviews_percentage: Number(apartmentsWithNegativeReviewsPercentage.toFixed(1)),
      apartments_with_perfect_ratings: apartmentsWithPerfectRatings,
      rating_distribution: ratingDistribution
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
    'apartment_id',
    'hotel_name',
    'room_view',
    'review_date',
    'rating',
    'nights',
    'title',
    'liked',
    'disliked',
    'owner_response',
    'user_country',
    'stay_type',
    'original_lang',
    'found_helpful',
    'found_unhelpful'
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
      const data: OutputData = JSON.parse(fileContent);
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
        // Parse full_review field
        let title = '';
        let liked = '';
        let disliked = '';
        
        if (review.full_review) {
          try {
            const parsed = parseFullReview(review.full_review);
            title = parsed.title;
            liked = parsed.liked;
            disliked = parsed.disliked;
          } catch (error) {
            // Skip if parsing fails
            continue;
          }
        }
        
        // Parse nights
        const nights = parseStayDuration(review.stay_duration) || 0;
        
        // Get apartment ID
        const apartmentId = getApartmentId(review.hotel_name, review.room_view);
        
        // Escape CSV fields
        const csvRow = [
          fileName,
          `"${apartmentId}"`,
          `"${review.hotel_name}"`,
          `"${review.room_view || ''}"`,
          review.review_post_date || '',
          review.rating || '',
          nights,
          `"${title.replace(/"/g, '""')}"`,
          `"${liked.replace(/"/g, '""')}"`,
          `"${disliked.replace(/"/g, '""')}"`,
          `"${(review.owner_resp_text || '').replace(/"/g, '""')}"`,
          `"${review.user_country || ''}"`,
          `"${review.stay_type || ''}"`,
          `"${review.original_lang || ''}"`,
          review.found_helpful,
          review.found_unhelpful
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
    'total_hotels',
    'total_apartments',
    'avg_reviews_per_apartment',
    'median_reviews_per_apartment',
    'min_reviews_per_apartment',
    'max_reviews_per_apartment',
    'avg_reviews_per_year_per_apartment',
    'total_nights',
    'avg_nights_per_apartment',
    'avg_nights_per_year_per_apartment',
    'overall_avg_rating',
    'negative_review_percentage',
    'positive_review_percentage',
    'true_problem_rate',
    'portfolio_stability_score',
    'host_engagement_score',
    'market_fit_score',
    'outlier_property_impact',
    'worst_property_name',
    'worst_property_rating',
    'oldest_review_date',
    'newest_review_date',
    'years_covered',
    'overall_reviews_per_year',
    'countries_count',
    'top_countries',
    'languages_count',
    'top_languages',
    'avg_helpful_votes',
    'owner_response_rate',
    'apartments_with_negative_reviews',
    'apartments_with_negative_reviews_percentage',
    'apartments_with_perfect_ratings',
    'rating_distribution'
  ];

  // CSV rows
  const rows = fileStats.map(stats => [
    stats.file_name,
    `"${stats.company_name}"`,
    stats.total_reviews,
    stats.total_hotels,
    stats.total_apartments,
    stats.avg_reviews_per_apartment,
    stats.median_reviews_per_apartment,
    stats.min_reviews_per_apartment,
    stats.max_reviews_per_apartment,
    stats.avg_reviews_per_year_per_apartment,
    stats.total_nights,
    stats.avg_nights_per_apartment,
    stats.avg_nights_per_year_per_apartment,
    stats.overall_avg_rating,
    stats.negative_review_percentage,
    stats.positive_review_percentage,
    stats.true_problem_rate,
    stats.portfolio_stability_score,
    stats.host_engagement_score,
    stats.market_fit_score,
    stats.outlier_property_impact,
    `"${stats.worst_property_name}"`,
    stats.worst_property_rating,
    stats.oldest_review_date,
    stats.newest_review_date,
    stats.years_covered,
    stats.overall_reviews_per_year,
    stats.countries_count,
    `"${stats.top_countries}"`,
    stats.languages_count,
    `"${stats.top_languages}"`,
    stats.avg_helpful_votes,
    stats.owner_response_rate,
    stats.apartments_with_negative_reviews,
    stats.apartments_with_negative_reviews_percentage,
    stats.apartments_with_perfect_ratings,
    `"${stats.rating_distribution}"`
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

/**
 * Main analytics function
 */
async function main(): Promise<void> {
  const { rolling12m } = parseArguments();
  const outputFiles = getOutputFileNames(rolling12m);
  
  const modeText = rolling12m ? '12-month rolling ' : '';
  console.log(`🔍 Starting ${modeText}hotel reviews analytics...`);

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
    const allReviews: Review[] = [];
    for (const filePath of jsonFiles) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const data: OutputData = JSON.parse(fileContent);
        allReviews.push(...data.reviews);
      } catch (error) {
        // Ignore errors for date calculation
      }
    }
    
    const result12m = filterYTDReviews(allReviews);
    if (result12m.cutoffDate) {
      const cutoffDateStr = result12m.cutoffDate.toISOString().split('T')[0];
      const latestDate = new Date(Math.max(...allReviews
        .map(r => parseReviewDate(r.review_post_date))
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
      console.log(`  ✅ ${stats.total_reviews} high-quality reviews from ${stats.total_hotels} hotels`);
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
  const totalApartments = allFileStats.reduce((sum, stats) => sum + stats.total_apartments, 0);
  const totalNights = allFileStats.reduce((sum, stats) => sum + stats.total_nights, 0);
  
  const summaryTitle = rolling12m ? '12-Month Analytics Summary:' : 'Analytics Summary:';
  console.log(`\n📋 ${summaryTitle}`);
  if (rolling12m && dateRange12m) {
    console.log(`  📅 12-Month Period: ${dateRange12m} (rolling window)`);
  }
  console.log(`  📁 Files analyzed: ${allFileStats.length}`);
  console.log(`  📊 Original reviews: ${totalOriginalReviews}`);
  console.log(`  ✨ High-quality reviews: ${totalFilteredReviews}`);
  console.log(`  🗑️  Low-quality filtered out: ${totalRemovedReviews} (${filteringPercentage}%)`);
  console.log(`  🏨 Total hotels: ${allFileStats.reduce((sum, stats) => sum + stats.total_hotels, 0)}`);
  console.log(`  🏠 Total apartments: ${totalApartments}`);
  console.log(`  🌙 Total nights: ${totalNights}`);
  console.log(`  📊 Avg nights per apartment: ${totalApartments > 0 ? (totalNights / totalApartments).toFixed(1) : '0.0'}`);
  console.log(`  ⭐ Average rating across all: ${(allFileStats.reduce((sum, stats) => sum + (stats.overall_avg_rating * stats.total_reviews), 0) / allFileStats.reduce((sum, stats) => sum + stats.total_reviews, 0)).toFixed(2)}`);
  
  const completionText = rolling12m ? '12-month analytics completed!' : 'Analytics completed!';
  console.log(`\n🎉 ${completionText} (Based on high-quality reviews only)`);
}

// Run the analytics
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
}); 