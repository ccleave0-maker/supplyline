import { z } from 'zod';
import { idSchema } from './common';

// ---------------------------------------------------------------------------
// Load board
// ---------------------------------------------------------------------------
export const LOAD_PRIORITIES = [
  { key: 'EMERGENCY', label: 'Emergency', color: '#DC2626' },
  { key: 'HIGH', label: 'High', color: '#EA580C' },
  { key: 'NORMAL', label: 'Normal', color: '#2563EB' },
  { key: 'ANYTIME', label: 'Good to go anytime', color: '#16A34A' },
] as const;
export type LoadPriority = (typeof LOAD_PRIORITIES)[number]['key'];
const PRIORITY_KEYS = LOAD_PRIORITIES.map((p) => p.key) as [LoadPriority, ...LoadPriority[]];

export const boardSettingsInput = z.object({
  /** Companies whose loads show on the board (null = all companies) */
  companyIds: z.array(idSchema).max(50).nullable(),
  /** Map: OpenStreetMap (no account), or Google Maps when a key is added */
  mapProvider: z.enum(['osm', 'google']),
  /** Google Maps JavaScript API key (restrict it to your Bowron address in Google Cloud) */
  googleMapsKey: z.string().trim().max(200).nullable(),
});
export type BoardSettings = z.infer<typeof boardSettingsInput>;
export const DEFAULT_BOARD: BoardSettings = { companyIds: null, mapProvider: 'osm', googleMapsKey: null };

export interface BoardStop {
  kind: 'PICKUP' | 'DROP';
  name: string;
  lat: number | null;
  lng: number | null;
  date: string | null;
  time: string | null;
  siteId: string | null;
}
export interface BoardLoad {
  id: string;
  label: string;
  title: string | null;
  status: string;
  priority: LoadPriority;
  companyId: string;
  companyName: string;
  companyColor: string;
  stops: BoardStop[];
  lineCount: number;
  weightKg: number | null;
  trailerName: string | null;
  carrierName: string | null;
  /** No truck booked yet */
  needsTruck: boolean;
  /** Earliest required-on-site date of what's on it */
  needBy: string | null;
  directions: { google: string; apple: string } | null;
  canEdit: boolean;
}

/** "New load available": post a one-off load with priority and dates. */
export const postLoadInput = z.object({
  companyId: idSchema,
  title: z.string().trim().min(1, 'Say what it is').max(120),
  priority: z.enum(PRIORITY_KEYS),
  pickupLocationId: idSchema,
  dropLocationId: idSchema,
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type PostLoadInput = z.infer<typeof postLoadInput>;

export const pinInput = z.object({
  /** A Google / Apple Maps link, geo: link, "lat, lng", or an address */
  text: z.string().trim().min(3).max(2000),
});

// ---------------------------------------------------------------------------
// Optimizer: everything that needs moving, suggested as combined loads
// ---------------------------------------------------------------------------
export const optimizeInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  companyIds: z.array(idSchema).max(50).optional(),
  trailerIds: z.array(idSchema).max(30).optional(),
  /** Jobs within this many km of each other can share a truck (milk run) */
  combineKm: z.number().min(0).max(1000).default(60),
  /** …and if their required dates are this close */
  combineDays: z.number().int().min(0).max(30).default(3),
});
export type OptimizeInput = z.infer<typeof optimizeInput>;

export interface SuggestedRun {
  key: string;
  companyId: string;
  companyName: string;
  pickup: { locationId: string; name: string };
  /** Drop-offs in driving order */
  drops: { siteId: string; locationId: string; name: string; needBy: string | null; items: { lotId: string; label: string; qty: number; uom: string }[] }[];
  trailerId: string | null;
  trailerName: string | null;
  loads: number;
  weightKg: number;
  /** Ship on (needed-by minus a day), and the earliest needed-by */
  shipOn: string | null;
  needBy: string | null;
  distanceKm: number | null;
  flags: string[];
  reasons: string[];
  /** The loads split by the trailer: lot → qty per load */
  plan: { lotId: string; qty: number }[][];
}
