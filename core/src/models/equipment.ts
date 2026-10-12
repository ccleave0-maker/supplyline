import { z } from 'zod';
import { idSchema, optionalText } from './common';

// ---------------------------------------------------------------------------
// Equipment register: units, where they are, every move, PST setup
// ---------------------------------------------------------------------------
export const equipmentInput = z.object({
  companyId: idSchema,
  unitNumber: z.string().trim().min(1, 'Unit # is required').max(40),
  description: z.string().trim().min(1, 'Describe the unit').max(200),
  make: optionalText,
  model: optionalText,
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  serial: optionalText,
  category: optionalText,
  notes: optionalText,
  pstExempt: z.boolean().optional(),
  pstExemptNumber: optionalText,
  active: z.boolean().optional(),
});
export type EquipmentInput = z.infer<typeof equipmentInput>;

export interface EquipmentItem {
  id: string;
  companyId: string;
  companyName: string;
  themeColor: string;
  unitNumber: string;
  description: string;
  make: string | null;
  model: string | null;
  year: number | null;
  serial: string | null;
  category: string | null;
  active: boolean;
  pstExempt: boolean;
  /** Where it is now */
  location: { id: string | null; name: string; siteId: string | null } | null;
  lat: number | null;
  lng: number | null;
  lastMovedAt: string | null;
}

export interface EquipmentMoveView {
  id: string;
  movedAt: string;
  fromName: string | null;
  toName: string | null;
  recordedByName: string;
  bolId: string | null;
  notes: string | null;
}

export interface EquipmentDetail extends EquipmentItem {
  notes: string | null;
  pstExemptNumber: string | null;
  pstExemptionFile: { id: string; url: string; fileName: string } | null;
  movements: EquipmentMoveView[];
  canEdit: boolean;
  canMove: boolean;
}

export const equipmentMoveInput = z
  .object({
    /** A location from the library (job, yard, laydown…) */
    toLocationId: idSchema.nullable().optional(),
    /** …or a free-text place ("Shop – Kamloops", "Vendor for repair") */
    toText: optionalText,
    movedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-20').optional(),
    notes: optionalText,
  })
  .refine((v) => !!v.toLocationId || !!v.toText, { message: 'Where did it go?', path: ['toLocationId'] });
export type EquipmentMoveInput = z.infer<typeof equipmentMoveInput>;

/** Columns a spreadsheet can be mapped onto when importing. */
export const EQUIPMENT_IMPORT_FIELDS = [
  { key: 'unitNumber', label: 'Unit #', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'year', label: 'Year' },
  { key: 'serial', label: 'Serial / VIN' },
  { key: 'category', label: 'Category / type' },
  { key: 'location', label: 'Current location' },
  { key: 'pstExempt', label: 'PST exempt (yes/no)' },
  { key: 'pstExemptNumber', label: 'PST exemption #' },
  { key: 'notes', label: 'Notes' },
] as const;
export type EquipmentImportField = (typeof EQUIPMENT_IMPORT_FIELDS)[number]['key'];

/** A spreadsheet read on the server, ready to be mapped. */
export interface SheetPreview {
  fileName: string;
  headers: string[];
  rows: string[][];
  /** Best guess: field → column index */
  suggested: Partial<Record<EquipmentImportField, number>>;
}

export const equipmentImportInput = z.object({
  companyId: idSchema,
  headers: z.array(z.string().max(200)).max(100),
  rows: z.array(z.array(z.string().max(2000)).max(100)).min(1, 'The sheet has no rows').max(5000),
  /** field → column index */
  mapping: z.record(z.string(), z.number().int().min(0).max(99)),
  /** Update units that already exist (matched by unit #) */
  updateExisting: z.boolean().default(true),
});
export type EquipmentImportInput = z.infer<typeof equipmentImportInput>;

export interface EquipmentImportResult {
  created: number;
  updated: number;
  skipped: { row: number; reason: string }[];
}
