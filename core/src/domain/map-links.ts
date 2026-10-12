// Pins from anywhere: a Google Maps or Apple Maps link, a geo: link, or plain
// coordinates ("49.28, -123.12"). Anything else is treated as an address to look up.

export interface Pin {
  lat: number;
  lng: number;
  label: string | null;
}

const ok = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const pin = (lat: string | number, lng: string | number, label: string | null = null): Pin | null => {
  const a = Number(lat);
  const b = Number(lng);
  return ok(a, b) ? { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6, label } : null;
};
const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

export function parseMapLink(text: string): Pin | null {
  const t = text.trim();
  if (!t) return null;
  let m: RegExpMatchArray | null;
  // geo:49.28,-123.12?q=…
  if ((m = t.match(new RegExp(`^geo:${NUM},${NUM}`, 'i')))) return pin(m[1]!, m[2]!);
  // Google "place" data: !3d49.28!4d-123.12 (the exact pin, better than the map centre)
  if ((m = t.match(new RegExp(`!3d${NUM}!4d${NUM}`)))) return pin(m[1]!, m[2]!, googlePlaceName(t));
  // Google map centre: /@49.28,-123.12,15z
  if ((m = t.match(new RegExp(`@${NUM},${NUM}`)))) return pin(m[1]!, m[2]!, googlePlaceName(t));
  // ?q= / ll= / sll= / daddr= / destination= / query= with coordinates (Google and Apple)
  if ((m = t.match(new RegExp(`[?&](?:q|ll|sll|daddr|destination|query|center)=${NUM}(?:,|%2C)\\s*${NUM}`, 'i')))) return pin(m[1]!, m[2]!);
  // Plain "49.28, -123.12" (or with spaces)
  if ((m = t.match(new RegExp(`^${NUM}\\s*[, ]\\s*${NUM}$`)))) return pin(m[1]!, m[2]!);
  return null;
}

function googlePlaceName(url: string): string | null {
  const m = url.match(/\/place\/([^/@]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!.replace(/\+/g, ' ')).slice(0, 160);
  } catch {
    return null;
  }
}

/** Looks like a map link we can't read without following it (short links). */
export const isShortMapLink = (text: string) => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\.com\/p\/)/i.test(text.trim());

/** Directions through the stops, for Google Maps and Apple Maps. */
export function directionsLinks(points: { lat: number | null; lng: number | null }[]): { google: string; apple: string } | null {
  const p = points.filter((x): x is { lat: number; lng: number } => x.lat != null && x.lng != null);
  if (p.length < 2) return null;
  const s = (x: { lat: number; lng: number }) => `${x.lat},${x.lng}`;
  const mid = p.slice(1, -1).map(s).join('|');
  const google = `https://www.google.com/maps/dir/?api=1&origin=${s(p[0]!)}&destination=${s(p.at(-1)!)}${mid ? `&waypoints=${encodeURIComponent(mid)}` : ''}&travelmode=driving`;
  const apple = `https://maps.apple.com/?saddr=${s(p[0]!)}&daddr=${p.slice(1).map(s).join('+to:')}&dirflg=d`;
  return { google, apple };
}

/** Straight-line distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}
