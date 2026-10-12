'use client';

import dynamic from 'next/dynamic';

export type { MapPoint, MapRoute } from './map-inner';

// Leaflet needs the browser, so the map loads only on the client.
export const MapView = dynamic(() => import('./map-inner'), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-xl border border-line bg-surface-2" aria-hidden="true" />,
});
