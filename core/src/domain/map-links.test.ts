import { describe, expect, it } from 'vitest';
import { directionsLinks, distanceKm, parseMapLink } from './map-links';

describe('map links', () => {
  it('reads pins from Google, Apple, geo: and plain coordinates', () => {
    expect(parseMapLink('https://www.google.com/maps/place/Red+Knife+Yard/@49.2827,-123.1207,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d49.28301!4d-123.11934')).toEqual({ lat: 49.28301, lng: -123.11934, label: 'Red Knife Yard' });
    expect(parseMapLink('https://www.google.com/maps/@49.1913,-122.849,14z')).toEqual({ lat: 49.1913, lng: -122.849, label: null });
    expect(parseMapLink('https://maps.google.com/?q=49.1,-122.8')).toMatchObject({ lat: 49.1, lng: -122.8 });
    expect(parseMapLink('https://maps.apple.com/?ll=48.4284,-123.3656&q=Site')).toMatchObject({ lat: 48.4284, lng: -123.3656 });
    expect(parseMapLink('geo:50.67,-120.33?q=Kamloops')).toMatchObject({ lat: 50.67, lng: -120.33 });
    expect(parseMapLink('  49.28, -123.12 ')).toMatchObject({ lat: 49.28, lng: -123.12 });
    expect(parseMapLink('1200 Industrial Way, Surrey BC')).toBeNull();
    expect(parseMapLink('0,0')).toBeNull();
  });
  it('makes directions links and distances', () => {
    const d = directionsLinks([{ lat: 49.19, lng: -122.85 }, { lat: 49.28, lng: -123.12 }, { lat: 48.43, lng: -123.37 }])!;
    expect(d.google).toContain('origin=49.19,-122.85');
    expect(d.google).toContain('destination=48.43,-123.37');
    expect(d.google).toContain('waypoints=49.28%2C-123.12');
    expect(d.apple).toBe('https://maps.apple.com/?saddr=49.19,-122.85&daddr=49.28,-123.12+to:48.43,-123.37&dirflg=d');
    expect(directionsLinks([{ lat: 1, lng: 1 }, { lat: null, lng: null }])).toBeNull();
    expect(Math.round(distanceKm({ lat: 49.2827, lng: -123.1207 }, { lat: 48.4284, lng: -123.3656 }))).toBe(97);
  });
});
