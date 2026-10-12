import { z } from 'zod';
import type { LoadFlag } from './loads';
import { idSchema, optionalText } from './common';

// ---------------------------------------------------------------------------
// Shipping locations library (yards, jobs, laydown areas, vendors' docks…)
// ---------------------------------------------------------------------------
export const locationInput = z.object({
  businessName: z.string().trim().min(1, 'Name the location').max(160),
  address: optionalText,
  city: optionalText,
  province: optionalText,
  postalCode: optionalText,
  phone: optionalText,
  cell: optionalText,
  notes: optionalText,
  companyId: idSchema.nullable().optional(),
  /** An extra ship-to for this job / project (set from the job page) */
  forSiteId: idSchema.nullable().optional(),
  active: z.boolean().optional(),
});
export type LocationInput = z.infer<typeof locationInput>;

export interface LocationItem {
  id: string;
  businessName: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
  cell: string | null;
  notes: string | null;
  companyId: string | null;
  /** Set when this location is a job or yard (those are managed from the job/yard profile). */
  siteId: string | null;
  siteType: 'JOB' | 'YARD' | null;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Inventory at a location
// ---------------------------------------------------------------------------
export type InventoryStatus = 'IN_STOCK' | 'STAGED' | 'DELIVERED';
export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = {
  IN_STOCK: 'In stock',
  STAGED: 'Staged',
  DELIVERED: 'Delivered',
};

export interface AvailableLot {
  lotId: string;
  companyId: string;
  locationId: string;
  status: InventoryStatus;
  /** null for equipment stock (oil, filters, parts) */
  orderId: string | null;
  orderLabel: string | null;
  lineNo: number | null;
  description: string;
  uom: string;
  qtyAvailable: number;
  finalSiteId: string | null;
  finalSiteLabel: string | null;
  /** Equipment stock: "Unit EX-101 · 320 excavator" */
  equipmentLabel: string | null;
  poNumber: string | null;
}

// ---------------------------------------------------------------------------
// Bills of lading (multi-stop)
// ---------------------------------------------------------------------------
export type BolStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
export const BOL_STATUS_LABELS: Record<BolStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'In transit',
  PARTIALLY_RECEIVED: 'Partly received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-20')
  .nullable()
  .optional();

/** Optional time of day, e.g. "07:30" */
const plannedTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 07:30')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

export const bolInput = z.object({
  companyId: idSchema,
  carrierContactId: idSchema.nullable().optional(),
  driverName: optionalText,
  truckUnit: optionalText,
  /** The trailer it goes on (checks weight and size) */
  trailerId: idSchema.nullable().optional(),
  /** Load board: urgency and a short name for posted loads */
  priority: z.enum(['EMERGENCY', 'HIGH', 'NORMAL', 'ANYTIME']).optional(),
  title: z.string().trim().max(120).nullable().optional(),
  /** Old single ship date; the first pickup's date is used when stops have dates. */
  scheduledDate: dateOnly,
  notes: optionalText,
  /** Stops in route order. `key` ties lines to stops before they have ids. */
  stops: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        kind: z.enum(['PICKUP', 'DROP']),
        locationId: idSchema,
        /** Pickup date (pickup stops) or delivery date (drop stops) */
        plannedDate: dateOnly,
        plannedTime: plannedTime,
      }),
    )
    .min(2, 'A BOL needs at least one pickup and one delivery')
    .max(20),
  lines: z
    .array(
      z
        .object({
          /** From inventory… */
          lotId: idSchema.optional(),
          /** …or typed in by hand (shipped and received, no stock moves) */
          manual: z.object({ description: z.string().trim().min(1, 'Describe the item').max(300), uom: z.string().trim().min(1).max(20), siteId: idSchema.nullable().optional() }).optional(),
          qty: z.number().positive('Quantity must be more than 0').max(1e9),
          pickupKey: z.string().min(1),
          dropKey: z.string().min(1),
        })
        .refine((l) => !!l.lotId !== !!l.manual, 'Each item is either from inventory or typed in'),
    )
    // A draft may have no items yet: a planned load that books the truck before the material is picked.
    .max(500),
});
export type BolInput = z.infer<typeof bolInput>;

export interface BolSummary {
  id: string;
  bolNumber: number | null;
  /** "BOL #12" or "Draft BOL" */
  label: string;
  direction: 'OUTBOUND' | 'RETURN';
  status: BolStatus;
  companyId: string;
  companyName: string;
  /** "Main Yard → JOB#2249 · Laydown 3" */
  route: string;
  lineCount: number;
  /** First pickup date */
  scheduledDate: string | null;
  /** Last delivery date */
  deliveryDate: string | null;
  issuedAt: string | null;
  createdAt: string;
}

export interface BolLineView {
  id: string;
  lineNo: number;
  /** null for items typed in by hand */
  lotId: string | null;
  orderId: string | null;
  orderLabel: string | null;
  orderLineNo: number | null;
  /** Typed in by hand (not from inventory) */
  manual: boolean;
  /** The job it's for (its section on the BOL) */
  finalSiteId: string | null;
  description: string;
  uom: string;
  qty: number;
  received: number;
  poNumber: string | null;
  pickupStopId: string;
  dropStopId: string;
  finalSiteLabel: string | null;
}

export interface BolStopView {
  id: string;
  seq: number;
  kind: 'PICKUP' | 'DROP';
  location: LocationItem;
  plannedDate: string | null;
  plannedTime: string | null;
  completedAt: string | null;
  /** You can receive here (drop stops on an issued BOL) */
  canReceive: boolean;
  receipts: { id: string; receivedAt: string; receivedByName: string; photoCount: number; problems: number }[];
}

export interface BolDetail extends BolSummary {
  carrier: { id: string; name: string; businessName: string | null; phone: string | null; cell: string | null; email: string | null } | null;
  driverName: string | null;
  truckUnit: string | null;
  notes: string | null;
  stops: BolStopView[];
  lines: BolLineView[];
  canEdit: boolean;
  canIssue: boolean;
  canCancel: boolean;
  /** When the shipper marked it as gone (the "shipped" notices went out) */
  shippedAt: string | null;
  canShip: boolean;
  trailer: { id: string; name: string; maxPayloadKg: number } | null;
  /** What's on it against the trailer (null with no trailer) */
  loadCheck: { weightKg: number; weightPct: number; loadsNeeded: number; flags: LoadFlag[]; unsized: number } | null;
}

export const receiveBolInput = z.object({
  stopId: idSchema,
  notes: optionalText,
  lines: z
    .array(
      z.object({
        bolLineId: idSchema,
        qtyReceived: z.number().min(0).max(1e9),
        damaged: z.boolean().default(false),
        note: z.string().trim().max(300).nullable().optional(),
      }),
    )
    .min(1, 'Nothing to receive'),
});
export type ReceiveBolInput = z.infer<typeof receiveBolInput>;

export const returnInput = z.object({
  siteId: idSchema,
  yardId: idSchema,
  pickupDate: dateOnly,
  deliveryDate: dateOnly,
  carrierContactId: idSchema.nullable().optional(),
  driverName: optionalText,
  notes: optionalText,
  lines: z.array(z.object({ lotId: idSchema, qty: z.number().positive().max(1e9) })).min(1, 'Pick at least one item to return'),
});
export type ReturnInput = z.infer<typeof returnInput>;

export interface SiteReceiptView {
  id: string;
  bolId: string;
  bolLabel: string;
  locationName: string;
  receivedAt: string;
  receivedByName: string;
  notes: string | null;
  lines: { description: string; uom: string; orderLabel: string; lineNo: number; expected: number; received: number; short: number; damaged: boolean; note: string | null }[];
  photos: { id: string; url: string; fileName: string }[];
}

// ---------------------------------------------------------------------------
// Photo scanning (receiving from a picture)
// ---------------------------------------------------------------------------
export interface DocumentScanResult {
  /** What we found on the paper, ready to open for receiving */
  match: { kind: 'PO' | 'ORDER' | 'BOL'; query: string; label: string; bolId?: string } | null;
  /** How it was found */
  method: 'qr' | 'text' | null;
  /** A little of the text read from the photo, to help if nothing matched */
  textSample: string;
  /** Quantities the AI read off the packing slip, per PO line (yard, when AI is on) */
  slip?: { poLineId: string; description: string; qty: number }[] | null;
}

// ---------------------------------------------------------------------------
// Recycle bin
// ---------------------------------------------------------------------------
export interface DeletedItem {
  id: string;
  entityType: string;
  label: string;
  deletedAt: string;
  deletedByName: string | null;
}

export const DELETED_TYPE_LABELS: Record<string, string> = {
  ORDER_DRAFT: 'Draft order list',
  PO_LINE: 'PO line',
  CUSTOM_COLUMN: 'Custom column',
  CONTACT: 'Contact',
  RENTAL: 'Rental',
  QC_DOC: 'QC document',
  SUBCONTRACT_DOC: 'Subcontract document',
  COMPLIANCE: 'WCB / insurance record',
  LOCATION: 'Shipping location',
  BOL_DRAFT: 'Draft BOL',
};

/** A purchase order seen from the BOL builder: where each line's material is. */
export interface PoForBol {
  po: { id: string; poNumber: string; vendorName: string; companyId: string; siteId: string | null; siteLabel: string | null };
  vendorLocationId: string | null;
  lines: {
    poLineId: string;
    lineNo: number | null;
    description: string;
    uom: string;
    ordered: number;
    linkedToOrderList: boolean;
    /** Received and sitting in a yard */
    inYards: { lotId: string; locationId: string; locationName: string; qtyAvailable: number }[];
    /** Already set up for pickup at the vendor */
    atVendor: { lotId: string; locationId: string; locationName: string; qtyAvailable: number }[];
    /** How much more can be picked up at the vendor (not received, not set up yet) */
    canPickUpAtVendor: number;
  }[];
}
