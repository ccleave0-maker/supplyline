'use client';

// Google Maps view (used when the organization added a Google Maps key on the
// load board settings). Same points and routes as the OpenStreetMap view.
import { useEffect, useRef, useState } from 'react';
import type { MapPoint, MapRoute } from './map-inner';

type G = typeof globalThis & { google?: { maps: any } };
let loading: Promise<void> | null = null;

function loadGoogle(key: string): Promise<void> {
  const g = globalThis as G;
  if (g.google?.maps) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('Google Maps did not load. Check the key (Admin › Load board) or use OpenStreetMap.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export function GoogleMapView({ apiKey, points, routes = [], height = 420, label }: { apiKey: string; points: MapPoint[]; routes?: MapRoute[]; height?: number; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadGoogle(apiKey)
      .then(() => {
        if (!live || !el.current) return;
        const gm = (globalThis as G).google!.maps;
        map.current ??= new gm.Map(el.current, { center: { lat: 53.5, lng: -116 }, zoom: 4, mapTypeControl: false, streetViewControl: false });
        for (const d of drawn.current) d.setMap(null);
        drawn.current = [];
        const bounds = new gm.LatLngBounds();
        for (const r of routes) {
          drawn.current.push(new gm.Polyline({ map: map.current, path: r.points.map(([lat, lng]) => ({ lat, lng })), strokeColor: r.color, strokeWeight: 4, strokeOpacity: r.dashed ? 0 : 0.85, icons: r.dashed ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '14px' }] : undefined }));
        }
        for (const p of points) {
          const m = new gm.Marker({ map: map.current, position: { lat: p.lat, lng: p.lng }, title: p.label, icon: { path: gm.SymbolPath.CIRCLE, scale: 9, fillColor: p.color ?? '#1f4e79', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 } });
          if (p.onClick) m.addListener('click', p.onClick);
          drawn.current.push(m);
          bounds.extend({ lat: p.lat, lng: p.lng });
        }
        if (points.length > 1) map.current.fitBounds(bounds, 40);
        else if (points[0]) map.current.setCenter({ lat: points[0].lat, lng: points[0].lng });
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [apiKey, points, routes]);
  if (error) return <p className="rounded-xl border border-line p-3 text-sm text-danger">{error}</p>;
  return <div ref={el} role="region" aria-label={label} style={{ height }} className="overflow-hidden rounded-xl border border-line" />;
}
