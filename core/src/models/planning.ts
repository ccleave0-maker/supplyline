import { z } from 'zod';
import { idSchema } from './common';

// ---------------------------------------------------------------------------
// Yard inventory by job: where each job's material is
// ---------------------------------------------------------------------------
export interface JobMaterialRow {
  orderLineId: string;
  orderId: string;
  /** "JOB#2249 LIST#3 L4" */
  ref: string;
  description: string;
  uom: string;
  ordered: number;
  /** Not in a yard or on a truck yet (on order / to buy) */
  outstanding: number;
  inYard: number;
  /** Staged (laydown) or on a planned load, waiting to ship */
  stagedToShip: number;
  inTransit: number;
  receivedAtSite: number;
  requiredOnSite: string | null;
}
export interface JobMaterialSummary {
  siteId: string;
  siteLabel: string;
  rows: JobMaterialRow[];
  totals: { lines: number; outstanding: number; inYard: number; stagedToShip: number; inTransit: number; receivedAtSite: number; complete: number };
}

// ---------------------------------------------------------------------------
// Pre-job equipment planning
// ---------------------------------------------------------------------------
export const EQUIPMENT_COVERAGE = [
  { key: 'NEEDED', label: 'Not covered yet' },
  { key: 'OWN', label: 'Our unit' },
  { key: 'RENT', label: 'Rent' },
  { key: 'BUY', label: 'Buy' },
] as const;
export type EquipmentCoverage = (typeof EQUIPMENT_COVERAGE)[number]['key'];

export const equipmentNeedInput = z
  .object({
    siteId: idSchema,
    description: z.string().trim().min(1, 'What’s needed?').max(160),
    category: z.string().trim().max(80).nullable().optional(),
    qty: z.number().int().min(1).max(50).default(1),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the start date'),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the end date'),
    equipmentId: idSchema.nullable().optional(),
    coverage: z.enum(['NEEDED', 'OWN', 'RENT', 'BUY']).default('NEEDED'),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => v.toDate >= v.fromDate, { path: ['toDate'], message: 'The end date is before the start' });
export type EquipmentNeedInput = z.infer<typeof equipmentNeedInput>;

export interface EquipmentNeedView {
  id: string;
  siteId: string;
  siteLabel: string;
  /** Lower goes first when jobs want the same equipment */
  jobPriority: number;
  description: string;
  category: string | null;
  qty: number;
  fromDate: string;
  toDate: string;
  coverage: EquipmentCoverage;
  equipment: { id: string; unitNumber: string; description: string } | null;
  notes: string | null;
  /** Our units of this kind that are free for these dates */
  freeUnits: { id: string; unitNumber: string; description: string }[];
  /** Other jobs that want the same unit / kind at the same time */
  competing: { needId: string; siteLabel: string; jobPriority: number; fromDate: string; toDate: string; equipmentId: string | null }[];
  /** OK, a free unit can cover it, short (rent / buy), or two jobs on one unit */
  status: 'COVERED' | 'CAN_COVER' | 'SHORT' | 'CONFLICT';
  /** e.g. "JOB#2250 goes first (priority 1) — rent one for this job" */
  advice: string | null;
}
