// Re-export and adapt types from the CLI for web usage
// These mirror src/search/types.ts but are self-contained for the web app

export interface BoundingBox {
  neLat: number;
  neLng: number;
  swLat: number;
  swLng: number;
}

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface CircleFilter {
  center: MapPoint;
  radiusMeters: number;
}

export type PriceDisplayMode = 'perNight' | 'total';

export type Platform = 'airbnb' | 'booking';

export type SearchPriceSource = 'upstream' | 'derived' | 'displayed';

export type SearchPriceBasis = 'night' | 'stay' | 'unknown';

export interface SearchPriceValue {
  amount: number;
  currency: string;
  source: SearchPriceSource;
}

export interface SearchDisplayPriceValue extends SearchPriceValue {
  basis: SearchPriceBasis;
}

export interface SearchPricing {
  nightly: SearchPriceValue | null;
  total: SearchPriceValue | null;
  display: SearchDisplayPriceValue | null;
}

export type SearchJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'partial';

export interface SearchResult {
  id: string;
  platform: Platform;
  name: string;
  url: string;
  rating: number | null;
  reviewCount: number;
  pricing: SearchPricing | null;
  coordinates: { lat: number; lng: number } | null;
  propertyType: string | null;
  photoUrl: string | null;
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  maxGuests?: number;
  superhost?: boolean;
  instantBook?: boolean;
  hostId?: string;
  stars?: number;
  freeCancellation?: boolean;
}

export interface GeocodeResult {
  boundingBox: BoundingBox;
  displayName: string;
  center: MapPoint;
}

export interface QuickSearchRequest {
  platform?: Platform;
  platforms?: Platform[];
  boundingBox: BoundingBox;
  circle?: CircleFilter;
  location?: string;
  checkin?: string;
  checkout?: string;
  adults?: number;
  currency?: string;
  priceDisplay?: PriceDisplayMode;
  priceMin?: number;
  priceMax?: number;
  minRating?: number;
  minBedrooms?: number;
  minBeds?: number;
  propertyType?: string;
  superhost?: boolean;
  instantBook?: boolean;
  stars?: number[];
  freeCancellation?: boolean;
}

export interface QuickSearchResponse {
  results: SearchResult[];
  totalResults: number;
  pagesScanned: number;
  durationMs: number;
  truncated: boolean;
  warnings?: string[];
}

export interface FullSearchRequest extends QuickSearchRequest {
  exhaustive?: boolean;
}

export interface CreateReviewJobRequest extends FullSearchRequest {
  mapBounds?: BoundingBox;
  mapCenter?: MapPoint;
  mapZoom?: number;
  searchAreaMode?: 'window' | 'rectangle' | 'circle';
  poi?: MapPoint;
  prompt?: string;
}

export interface CreateReviewJobResponse {
  jobId: string;
  status: SearchJobStatus;
}

export interface StartSearchResponse {
  jobId: string;
  status: SearchJobStatus;
}

export type CreateSearchJobResponse = StartSearchResponse;

export interface ExportSearchRequest {
  jobId: string;
}

export interface SearchJobState {
  id: string;
  status: SearchJobStatus;
  progress: number;
  totalResults: number;
  pagesScanned: number;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SearchJobResponse {
  job: SearchJobState;
  results: SearchResult[];
}

export interface ReviewJobEvent {
  id: string;
  phase: string;
  level: string;
  message: string;
  payload: Record<string, unknown> | null;
  listingId: string | null;
  listingPlatform: Platform | null;
  createdAt: string;
}

export interface ReviewJobListingAnalysis {
  id: string;
  status: PhaseStatus;
  currentPhase: string;
  errorMessage: string | null;
  detailsStatus: PhaseStatus;
  reviewsStatus: PhaseStatus;
  photosStatus: PhaseStatus;
  aiReviewsStatus: PhaseStatus;
  aiPhotosStatus: PhaseStatus;
  triageStatus: PhaseStatus;
  details: Record<string, unknown> | null;
  aiReviews: Record<string, unknown> | null;
  aiPhotos: Record<string, unknown> | null;
  triage: Record<string, unknown> | null;
  reviewCount: number | null;
  photoCount: number | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewJobListing extends SearchResult {
  selected: boolean;
  hidden: boolean;
  poiDistanceMeters: number | null;
  analysis: ReviewJobListingAnalysis | null;
}

export interface ReviewJobState {
  id: string;
  ownerKey: string | null;
  status: SearchJobStatus;
  currentPhase: string;
  analysisStatus: PhaseStatus;
  analysisCurrentPhase: string | null;
  location: string | null;
  prompt: string | null;
  boundingBox: BoundingBox | null;
  circle: CircleFilter | null;
  poi: MapPoint | null;
  mapBounds: BoundingBox | null;
  mapCenter: MapPoint | null;
  mapZoom: number | null;
  searchAreaMode: 'window' | 'rectangle' | 'circle';
  checkin: string | null;
  checkout: string | null;
  adults: number;
  currency: string;
  filters: Record<string, unknown> | null;
  totalResults: number;
  pagesScanned: number;
  progress: number;
  errorMessage: string | null;
  analysisProgress: number;
  analysisErrorMessage: string | null;
  analysisDurationMs: number | null;
  analysisStartedAt: string | null;
  analysisCompletedAt: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  reportReady: boolean;
  legacyReportAvailable: boolean;
  createdAt: string;
}

export interface ReviewJobResponse {
  job: ReviewJobState;
  listings: ReviewJobListing[];
  events: ReviewJobEvent[];
}

export interface ReviewJobListItem {
  id: string;
  location: string | null;
  status: SearchJobStatus;
  currentPhase: string;
  totalResults: number;
  searchAreaMode: 'window' | 'rectangle' | 'circle';
  createdAt: string;
  completedAt: string | null;
}
