import type { Platform } from '@/types';

interface ListingLinkOptions {
  checkin?: string | null;
  checkout?: string | null;
  adults?: number | null;
}

export function buildListingUrl(
  baseUrl: string,
  platform: Platform,
  options: ListingLinkOptions = {},
): string {
  try {
    const url = new URL(baseUrl);

    if (platform === 'airbnb') {
      if (options.checkin) {
        url.searchParams.set('check_in', options.checkin);
      }
      if (options.checkout) {
        url.searchParams.set('check_out', options.checkout);
      }
      if (options.adults && options.adults > 0) {
        url.searchParams.set('adults', String(options.adults));
      }
      return url.toString();
    }

    if (options.checkin) {
      url.searchParams.set('checkin', options.checkin);
    }
    if (options.checkout) {
      url.searchParams.set('checkout', options.checkout);
    }
    if (options.adults && options.adults > 0) {
      url.searchParams.set('group_adults', String(options.adults));
      url.searchParams.set('no_rooms', '1');
    }

    return url.toString();
  } catch {
    return baseUrl;
  }
}
