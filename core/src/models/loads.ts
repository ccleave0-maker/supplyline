import { z } from 'zod';
import { idSchema, optionalText } from './common';

// ---------------------------------------------------------------------------
// Trailer library (stored in metres and kg; shown in ft/lb or m/kg)
// ---------------------------------------------------------------------------
export const TRAILER_KINDS = [
  // Typical BC/Alberta decks; a starting point the admin can change.
  { key: 'FLATDECK', label: 'Flat deck (highboy)', deckLengthM: 14.63, deckWidthM: 2.59, deckHeightM: 1.52, maxPayloadKg: 21_000 },
  { key: 'STEP_DECK', label: 'Step deck', deckLengthM: 14.63, deckWidthM: 2.59, deckHeightM: 1.0, maxPayloadKg: 20_000 },
  { key: 'DOUBLE_DROP', label: 'Double drop / RGN', deckLengthM: 8.84, deckWidthM: 2.59, deckHeightM: 0.6, maxPayloadKg: 32_000 },
  { key: 'LOWBOY', label: 'Lowboy', deckLengthM: 7.32, deckWidthM: 2.59, deckHeightM: 0.46, maxPayloadKg: 36_000 },
  { key: 'B_TRAIN', label: 'B-train flat deck', deckLengthM: 18.9, deckWidthM: 2.59, deckHeightM: 1.52, maxPayloadKg: 38_000 },
  { key: 'TRUCK_DECK', label: 'Deck truck (tandem)', deckLengthM: 7.32, deckWidthM: 2.44, deckHeightM: 1.3, maxPayloadKg: 9_000 },
  { key: 'PICKUP', label: 'Pickup / hotshot', deckLengthM: 2.44, deckWidthM: 1.6, deckHeightM: 0.9, maxPayloadKg: 1_200 },
  { key: 'OTHER', label: 'Other', deckLengthM: 12, deckWidthM: 2.59, deckHeightM: 1.4, maxPayloadKg: 18_000 },
] as const;
export type TrailerKind = (typeof TRAILER_KINDS)[number]['key'];
const KINDS = TRAILER_KINDS.map((k) => k.key) as [TrailerKind, ...TrailerKind[]];

/** Legal without a permit (BC): 2.6 m wide, 4.15 m high overall. */
export const LEGAL_WIDTH_M = 2.6;
export const LEGAL_HEIGHT_M = 4.15;
/** Rear overhang allowed past the deck before it's flagged. */
export const REAR_OVERHANG_M = 1.0;

const metres = z.number().positive('Must be more than 0').max(60);
export const trailerInput = z.object({
  name: z.string().trim().min(1, 'Name it (e.g. 53′ step deck)').max(80),
  kind: z.enum(KINDS),
  unitNumber: optionalText,
  carrierContactId: idSchema.nullable().optional(),
  deckLengthM: metres,
  deckWidthM: metres,
  deckHeightM: z.number().min(0).max(5),
  maxHeightM: metres.default(LEGAL_HEIGHT_M),
  maxWidthM: metres.default(LEGAL_WIDTH_M),
  maxPayloadKg: z.number().positive('Enter how much it can carry').max(200_000),
  notes: optionalText,
  active: z.boolean().optional(),
});
export type TrailerInput = z.infer<typeof trailerInput>;
export interface TrailerView extends Omit<TrailerInput, 'active' | 'maxHeightM' | 'maxWidthM'> {
  id: string;
  maxHeightM: number;
  maxWidthM: number;
  active: boolean;
  carrierName: string | null;
}

// ---------------------------------------------------------------------------
// Optional sizes and weights on order-list lines (per unit)
// ---------------------------------------------------------------------------
export const lineSizeInput = z.object({
  unitWeightKg: z.number().min(0).max(200_000).nullable(),
  lengthM: z.number().min(0).max(60).nullable(),
  widthM: z.number().min(0).max(20).nullable(),
  heightM: z.number().min(0).max(20).nullable(),
  stackable: z.boolean().default(true),
});
export type LineSizeInput = z.infer<typeof lineSizeInput>;

// ---------------------------------------------------------------------------
// Load builder
// ---------------------------------------------------------------------------
/** One thing to load: an inventory lot (or a line still on order) with its sizes. */
export interface LoadItem {
  key: string;
  lotId: string | null;
  /** null for equipment stock (no order-list line to size) */
  orderLineId: string | null;
  label: string;
  /** "JOB#2249 LIST#3 L4" */
  ref: string;
  uom: string;
  qty: number;
  unitWeightKg: number | null;
  lengthM: number | null;
  widthM: number | null;
  heightM: number | null;
  stackable: boolean;
  /** Where it is now (yard / location name), for picking */
  locationId: string | null;
  locationName: string | null;
  companyId: string;
  finalSiteId: string | null;
}

export type LoadFlag = 'OVERWEIGHT' | 'TOO_WIDE' | 'PERMIT_WIDTH' | 'TOO_TALL' | 'TOO_LONG' | 'OVERHANG' | 'NO_SIZE';
export const LOAD_FLAG_LABELS: Record<LoadFlag, string> = {
  OVERWEIGHT: 'Heavier than the trailer can carry',
  TOO_WIDE: 'Wider than the deck',
  PERMIT_WIDTH: 'Over 2.6 m wide — needs an oversize permit',
  TOO_TALL: 'Too tall on this trailer — over the legal height',
  TOO_LONG: 'Longer than the deck plus allowed overhang',
  OVERHANG: 'Hangs off the back — flag it',
  NO_SIZE: 'No size or weight given — not counted',
};

export interface PlannedLoadLine {
  key: string;
  qty: number;
  weightKg: number;
}
export interface PlannedLoad {
  no: number;
  lines: PlannedLoadLine[];
  weightKg: number;
  /** Share of payload / deck area used, 0–1+ */
  weightPct: number;
  areaPct: number;
  flags: LoadFlag[];
}
export interface LoadPlan {
  trailerId: string | null;
  loads: PlannedLoad[];
  /** Problems per item (key → flags) */
  itemFlags: Record<string, LoadFlag[]>;
  totalWeightKg: number;
  /** Items with no size/weight (put on load 1, not counted) */
  unsized: string[];
}

export const loadPlanInput = z.object({
  trailerId: idSchema,
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        qty: z.number().positive().max(1e9),
      }),
    )
    .min(1, 'Pick something to load')
    .max(500),
  /** Where the items come from: inventory lots at a location, or a job's whole yard stock */
  siteId: idSchema.optional(),
});

export const makeLoadsInput = z.object({
  trailerId: idSchema,
  companyId: idSchema,
  pickupLocationId: idSchema,
  dropLocationId: idSchema,
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  carrierContactId: idSchema.nullable().optional(),
  loads: z
    .array(z.array(z.object({ lotId: idSchema, qty: z.number().positive().max(1e9) })).min(1))
    .min(1)
    .max(50),
});
export type MakeLoadsInput = z.infer<typeof makeLoadsInput>;

// Unit display -------------------------------------------------------------
export type UnitSystem = 'imperial' | 'metric';
export const M_PER_FT = 0.3048;
export const KG_PER_LB = 0.45359237;
export const fmtLength = (m: number | null, u: UnitSystem) => {
  if (m == null) return '—';
  if (u === 'metric') return `${Math.round(m * 100) / 100} m`;
  const inches = Math.round(m / 0.0254);
  return `${Math.floor(inches / 12)}′${inches % 12 ? ` ${inches % 12}″` : ''}`;
};
export const fmtWeight = (kg: number | null, u: UnitSystem) => (kg == null ? '—' : u === 'metric' ? `${Math.round(kg).toLocaleString()} kg` : `${Math.round(kg / KG_PER_LB).toLocaleString()} lb`);
/** Typed value in the shown unit → metres / kg */
export const toMetres = (v: number, u: UnitSystem) => (u === 'metric' ? v : v * M_PER_FT);
export const toKg = (v: number, u: UnitSystem) => (u === 'metric' ? v : v * KG_PER_LB);
export const fromMetres = (m: number, u: UnitSystem) => (u === 'metric' ? m : m / M_PER_FT);
export const fromKg = (kg: number, u: UnitSystem) => (u === 'metric' ? kg : kg / KG_PER_LB);
