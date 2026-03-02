// Re-export and adapt types from the CLI for web usage
// These mirror src/search/types.ts but are self-contained for the web app

export interface BoundingBox {
  neLat: number;
  neLng: number;
  swLat: number;
  swLng: number;
}

export type Platform = 'airbnb' | 'booking';

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
  center: { lat: number; lng: number };
}

export interface QuickSearchRequest {
  platform: Platform;
  boundingBox: BoundingBox;
  checkin?: string;
  checkout?: string;
  adults?: number;
  currency?: string;
  priceMin?: number;
  priceMax?: number;
  minRating?: number;
  propertyType?: string;
  superhost?: boolean;
  instantBook?: boolean;
  stars?: number[];
  freeCancellation?: boolean;
}

export interface QuickSearchResponse {
  results: SearchResult[];
  totalResults: number;
  durationMs: number;
  truncated: boolean;
}
