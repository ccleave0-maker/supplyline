import type { GeocodeResult } from '@supplyline/core/models';
import { env } from '../lib/env';

interface NominatimItem {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
}

// OpenStreetMap Nominatim. Usage policy: ≤ 1 request/second, identify the app.
let lastCall = 0;

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'ca,us');
  url.searchParams.set('email', env().GEOCODER_CONTACT_EMAIL);

  const res = await fetch(url, { headers: { 'User-Agent': 'SupplyLine/0.1 (procurement app)' } });
  if (!res.ok) throw new Error(`Geocoder error ${res.status}`);
  const items = (await res.json()) as NominatimItem[];

  return items.map((i) => {
    const a = i.address ?? {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    return {
      label: i.display_name,
      lat: Number(i.lat),
      lng: Number(i.lon),
      address: street || null,
      city: a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null,
      province: a.state ?? null,
      postalCode: a.postcode ?? null,
    };
  });
}
