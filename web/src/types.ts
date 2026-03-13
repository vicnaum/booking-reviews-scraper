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

export type SearchJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SearchResult {
  id: string;
  platform: Platform;
  name: string;
  url: string;
  rating: number | null;
  reviewCount: number;
  price: { amount: number; currency: string; period: 'night' } | null;
  totalPrice: { amount: number; currency: string } | null;
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
  platform: Platform;
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
}

export interface FullSearchRequest extends QuickSearchRequest {
  exhaustive?: boolean;
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
