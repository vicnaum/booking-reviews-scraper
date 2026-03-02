import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q');

  if (!q || q.trim().length === 0) {
    return NextResponse.json({ error: 'Missing query parameter "q"' }, { status: 400 });
  }

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q.trim());
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '0');

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'StayReviewr/1.0',
        'Accept-Language': 'en',
      },
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Geocoding service error' }, { status: 502 });
    }

    const data = await res.json();

    if (!data.length) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    const place = data[0];
    const [swLat, neLat, swLng, neLng] = place.boundingbox.map(Number);

    return NextResponse.json({
      boundingBox: { neLat, neLng, swLat, swLng },
      displayName: place.display_name,
      center: { lat: Number(place.lat), lng: Number(place.lon) },
    });
  } catch {
    return NextResponse.json({ error: 'Geocoding failed' }, { status: 500 });
  }
}
