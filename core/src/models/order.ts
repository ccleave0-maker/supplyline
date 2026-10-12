import { z } from 'zod';
import type { LineShipment } from './schedule';
import type { LineStatus, OrderStatus } from '../domain/status';
import { idSchema } from './common';

export const UOM_SUGGESTIONS = [
  'EA', 'PC', 'SET', 'PAIR', 'LOT', 'BOX', 'BAG', 'ROLL', 'BUNDLE', 'SHEET', 'PALLET',
  'M', 'FT', 'LF', 'M2', 'SF', 'M3', 'YD3', 'L', 'GAL', 'KG', 'LB', 'TON', 'TONNE', 'HR', 'DAY',
] as const;

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-15')
  .nullable()
  .optional();

export const orderLineInput = z.object({
  description: z.string().trim().min(1, 'Description is required').max(500),
  quantity: z.number({ message: 'Enter a quantity' }).positive('Quantity must be more than 0').max(1e9),
  uom: z.string().trim().toUpperCase().min(1, 'Unit is required').max(20),
  costCode: z
    .string()
    .trim()
    .max(40)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  orderedByInitials: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,4}$/, 'Initials are 1–4 letters'),
  requiredOnSite: dateOnly,
});
export type OrderLineInput = z.infer<typeof orderLineInput>;

/** A grid row exactly as typed. Drafts may be incomplete; Submit checks them. */
export const draftRowSchema = z.object({
  description: z.string().max(500).default(''),
  quantity: z.string().max(30).default(''),
  uom: z.string().max(20).default(''),
  costCode: z.string().max(40).default(''),
  orderedByInitials: z.string().max(4).default(''),
  requiredOnSite: z.string().max(10).default(''),
});
export type DraftRow = z.infer<typeof draftRowSchema>;

export const emptyDraftRow = (initials = ''): DraftRow => ({
  description: '',
  quantity: '',
  uom: '',
  costCode: '',
  orderedByInitials: initials,
  requiredOnSite: '',
});

export const isBlankRow = (r: DraftRow) => !r.description.trim() && !r.quantity.trim() && !r.uom.trim() && !r.costCode.trim();

export const saveDraftInput = z.object({
  notes: z.string().trim().max(2000).nullable().optional(),
  rows: z.array(draftRowSchema).max(500, 'An order list can have up to 500 lines'),
});
export type SaveDraftInput = z.infer<typeof saveDraftInput>;

/** Problems found when submitting, keyed by row number (1-based) and field. */
export type RowErrors = Record<number, Partial<Record<keyof DraftRow, string>>>;

export const createOrderInput = z.object({ siteId: idSchema });

export const cancelLineInput = z.object({ reason: z.string().trim().max(300).nullable().optional() });

export interface OrderSummary {
  id: string;
  siteId: string;
  jobNumber: string;
  siteName: string;
  companyId: string;
  companyName: string;
  listNo: number | null;
  companySeq: number | null;
  /** "JOB#2249 LIST#1" or "JOB#2249 DRAFT" */
  label: string;
  status: OrderStatus;
  lineCount: number;
  createdAt: string;
  createdByName: string;
  submittedAt: string | null;
  submittedByName: string | null;
}

export interface OrderLineView {
  id: string;
  lineNo: number;
  description: string;
  quantity: number;
  uom: string;
  costCode: string | null;
  orderedByInitials: string;
  requiredOnSite: string | null;
  status: LineStatus;
  poNumbers: string[];
  /** Its POs to open / download — only for the job's PM and people who can see POs */
  poLinks: { id: string; poNumber: string }[] | null;
  /** Bought off-list on a PO: why */
  offListReason: string | null;
  vendorNames: string[];
  vendorEta: string | null;
  unitCost: number | null;
  extendedCost: number | null;
  /** Loads carrying this line: planned, on the way, delivered */
  shipments: LineShipment[];
  /** Shared custom column values, keyed by column id */
  custom: Record<string, string | number | boolean | null>;
}

export interface OrderEmailStatus {
  sent: number;
  failed: number;
  /** Plain-language warnings, e.g. no procurement email set up. */
  warnings: string[];
}

export interface OrderDetail extends OrderSummary {
  notes: string | null;
  /** Submitted lines (empty while DRAFT) */
  lines: OrderLineView[];
  /** Draft grid rows (only while DRAFT) */
  draftRows: DraftRow[];
  canEdit: boolean;
  canSubmit: boolean;
  canCancelLines: boolean;
  /** Procurement columns shared with the site (read-only for the site). */
  customColumns: { id: string; name: string; dataType: string }[];
  /** Valid cost codes for this job. Empty = free text allowed. */
  costCodes: { code: string; description: string | null }[];
  email: OrderEmailStatus | null;
  /** Earliest planned / on-the-way delivery for this list */
  nextDelivery: { date: string; time: string | null; bolId: string; bolLabel: string } | null;
}

export interface SubmitResult {
  order: OrderDetail;
  email: OrderEmailStatus;
}

export interface SiteInventoryRow {
  orderLineId: string;
  orderId: string;
  orderLabel: string;
  lineNo: number;
  description: string;
  uom: string;
  status: LineStatus;
  qtyOrdered: number;
  qtyShipped: number;
  leftToShip: number;
  qtyReceived: number;
  partiallyShipped: boolean;
  /** On a BOL that has left but not arrived yet */
  inTransit: number;
  /** Sitting at an in-between location, still owing a final leg */
  staged: number;
  /** At the job now (received minus returned) */
  onSite: number;
  qtyReturned: number;
  bolNumbers: number[];
  shipments: LineShipment[];
  poNumbers: { poNumber: string; purchaseOrderId: string }[];
}

export const costCodeInput = z.object({
  code: z.string().trim().min(1, 'Code is required').max(40),
  description: z.string().trim().max(200).nullable().optional(),
  siteId: idSchema.nullable().optional(),
});
export type CostCodeInput = z.infer<typeof costCodeInput>;

export interface CostCodeItem {
  id: string;
  code: string;
  description: string | null;
  siteId: string | null;
}

/** Pushed to every open app when data changes, so screens refresh instantly. */
export interface LiveEvent {
  type: 'order.changed';
  orderId: string;
  siteId: string;
  companyId: string;
}
