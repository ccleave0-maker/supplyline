import { z } from 'zod';
import type { LineStatus } from '../domain/status';
import { idSchema } from './common';

// ---------------------------------------------------------------------------
// Yard stock check
// ---------------------------------------------------------------------------
export interface StockCheckOrder {
  orderId: string;
  label: string;
  siteName: string;
  companyId: string;
  companyName: string;
  submittedAt: string | null;
  lines: {
    lineId: string;
    lineNo: number;
    description: string;
    quantity: number;
    uom: string;
    status: LineStatus;
    /** null = not checked yet */
    yardQtyAvailable: number | null;
  }[];
  /** Yards (that you work at) which serve this order's company */
  yards: { id: string; name: string }[];
}

export const stockCheckInput = z.object({
  yardId: idSchema,
  lines: z
    .array(z.object({ lineId: idSchema, qtyAvailable: z.number().min(0).max(1e9) }))
    .min(1, 'Mark at least one line'),
});
export type StockCheckInput = z.infer<typeof stockCheckInput>;

// ---------------------------------------------------------------------------
// Incoming shipments (from PO lines + vendor ETAs)
// ---------------------------------------------------------------------------
export interface IncomingLine {
  poLineId: string;
  purchaseOrderId: string;
  poNumber: string;
  vendorName: string;
  vendorEta: string | null;
  yardId: string | null;
  yardName: string | null;
  /** null for equipment POs (no order list) */
  orderId: string | null;
  orderLabel: string;
  siteName: string;
  lineNo: number;
  description: string;
  uom: string;
  qtyOnPo: number;
  qtyReceived: number;
  qtyRemaining: number;
}

// ---------------------------------------------------------------------------
// Yard receiving
// ---------------------------------------------------------------------------
export interface ReceivableLine {
  poLineId: string;
  orderLineId: string | null;
  orderId: string | null;
  orderLabel: string;
  lineNo: number;
  description: string;
  uom: string;
  qtyOnPo: number;
  qtyReceived: number;
  qtyRemaining: number;
}

export interface ReceivingLookup {
  /** What the search matched */
  kind: 'PO' | 'ORDER';
  label: string;
  purchaseOrderId: string | null;
  orderId: string | null;
  vendorName: string | null;
  companyId: string;
  lines: ReceivableLine[];
  /** Yards you can receive at for this company */
  yards: { id: string; name: string }[];
  defaultYardId: string | null;
}

export const receiptInput = z.object({
  yardId: idSchema,
  purchaseOrderId: idSchema.nullable().optional(),
  orderId: idSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z
    .array(
      z.object({
        poLineId: idSchema,
        qtyReceived: z.number().min(0).max(1e9),
        problem: z.boolean().default(false),
        problemNote: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1, 'Nothing to receive'),
});
export type ReceiptInput = z.infer<typeof receiptInput>;

export interface ReceiptSummary {
  id: string;
  receivedAt: string;
  receivedByName: string;
  yardName: string;
  poNumbers: string[];
  orderLabels: string[];
  lineCount: number;
  problemCount: number;
  photoCount: number;
}

export interface ReceiptDetail extends ReceiptSummary {
  notes: string | null;
  lines: {
    lineNo: number;
    orderLabel: string;
    description: string;
    uom: string;
    poNumber: string | null;
    qtyExpected: number;
    qtyReceived: number;
    problem: boolean;
    problemNote: string | null;
  }[];
  photos: { id: string; url: string; fileName: string }[];
}

// ---------------------------------------------------------------------------
// Yard inventory
// ---------------------------------------------------------------------------
export interface YardInventoryRow {
  id: string;
  yardId: string;
  yardName: string;
  companyName: string;
  source: 'YARD_STOCK' | 'PO_RECEIPT' | 'RETURN' | 'TRANSFER' | 'VENDOR';
  description: string;
  uom: string;
  qtyAvailable: number;
  qtyIn: number;
  /** null for equipment stock */
  orderId: string | null;
  orderLabel: string | null;
  siteName: string | null;
  lineNo: number | null;
  /** Equipment stock: the unit it's for */
  equipmentLabel: string | null;
  poNumber: string | null;
  receivedAt: string;
}
