'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color?: string;
  onClick?: () => void;
}

/** A route drawn as a line through its stops (load board). */
export interface MapRoute {
  id: string;
  color: string;
  points: [number, number][];
  label?: string;
  dashed?: boolean;
}

const CANADA_CENTER: [number, number] = [53.5, -116];

function FitTo({ points, single }: { points: MapPoint[]; single?: boolean }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat},${p.lng}`).join('|');
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1 || single) {
      map.setView([points[0]!.lat, points[0]!.lng], Math.max(map.getZoom(), 13));
    } else {
      const bounds: LatLngBoundsExpression = points.map((p) => [p.lat, p.lng] as [number, number]);
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 13 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function MapInner({
  points,
  onPick,
  height = 280,
  label,
  routes = [],
}: {
  points: MapPoint[];
  onPick?: (lat: number, lng: number) => void;
  height?: number;
  label: string;
  routes?: MapRoute[];
}) {
  const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#1f4e79';
  return (
    <div role="region" aria-label={label} style={{ height }} className="overflow-hidden rounded-xl border border-line">
      <MapContainer center={CANADA_CENTER} zoom={4} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {routes.map((r) => (
          <Polyline key={r.id} positions={r.points} pathOptions={{ color: r.color, weight: 4, opacity: 0.8, dashArray: r.dashed ? '8 8' : undefined }}>
            {r.label && <Tooltip sticky>{r.label}</Tooltip>}
          </Polyline>
        ))}
        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={10}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: p.color ?? brand, fillOpacity: 1 }}
            eventHandlers={p.onClick ? { click: p.onClick } : undefined}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              {p.label}
            </Tooltip>
          </CircleMarker>
        ))}
        <FitTo points={points} single={!!onPick} />
        {onPick && <ClickToPlace onPick={onPick} />}
      </MapContainer>
    </div>
  );
}
