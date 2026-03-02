// src/search/types.ts
//
// Shared interfaces for the reviewr search command

export interface BoundingBox {
  neLat: number;
  neLng: number;
  swLat: number;
  swLng: number;
}

export interface SearchParams {
  platform: 'airbnb' | 'booking';
  location?: string;
  boundingBox?: BoundingBox;
  checkin?: string;
  checkout?: string;
  adults: number;
  children?: number;
  currency: string;
  minRating?: number;
  priceMin?: number;
  priceMax?: number;
  propertyType?: string;
  maxResults?: number;
  exhaustive?: boolean;
  outputDir?: string;
}

export interface AirbnbSearchParams extends SearchParams {
  platform: 'airbnb';
  superhost?: boolean;
  instantBook?: boolean;
  amenities?: number[];
}

export interface BookingSearchParams extends SearchParams {
  platform: 'booking';
  stars?: number[];
  freeCancellation?: boolean;
  destId?: string;
}

export interface SearchResult {
  id: string;
  platform: 'airbnb' | 'booking';
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
  // Airbnb-specific
  superhost?: boolean;
  instantBook?: boolean;
  amenityIds?: number[];
  hostId?: string;
  // Booking-specific
  stars?: number;
  freeCancellation?: boolean;
}

export interface SearchOutput {
  search: {
    platform: string;
    location: string | null;
    checkin: string | null;
    checkout: string | null;
    adults: number;
    filters: Record<string, unknown>;
    currency: string;
    totalResults: number;
    pagesScanned: number;
    searchedAt: string;
    mode: 'quick' | 'exhaustive';
    boundingBox: BoundingBox | null;
    durationMs: number;
  };
  results: SearchResult[];
}

export interface SearchPage {
  results: SearchResult[];
  hasNextPage: boolean;
  cursor?: string;
  pageIndex: number;
}

export type ProgressCallback = (page: SearchPage) => void;
